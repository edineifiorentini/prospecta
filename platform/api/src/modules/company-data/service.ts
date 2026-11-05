import { env, isProd, isTest } from "../../config/env.ts";
import { Prisma, prisma } from "../../lib/prisma.ts";
import { redis } from "../../lib/redis.ts";
import { decryptSecret } from "../../lib/crypto.ts";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.ts";
import { logger } from "../../lib/logger.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { QUEUES, queue } from "../../queues/index.ts";
import { readOrgSettings, type DataEnrichmentSettings } from "../orgs/settings.ts";
import { startOfDayBR } from "../search/quota.ts";
import { cnpjDigits, isValidCnpj } from "./cnpj.ts";
import { createEconodataClient, isEstimate, withRetry, type CallResult, type EconodataClient } from "./econodata/client.ts";
import { createEconodataMock } from "./econodata/mock.ts";
import { normalizeEconodata } from "./econodata/normalize.ts";
import { decideMatch, locationWarnings } from "./matching.ts";
import { ProviderError, type BusinessProfile, type MatchCandidate } from "./types.ts";

/**
 * Enriquecimento empresarial pago (Econodata API v4). Fluxo, do mais barato ao mais caro:
 * coleta gratuita → identificação (CNPJ já validado ou /match) → validação → consulta por CNPJ.
 * Antes de cada chamada paga: prévia de custo (X-Estimate-Only, grátis) e limites da conta.
 * Nada roda sozinho: o automático fica desligado e, quando ligado, só pega empresas com CNPJ ou site.
 */

export const CREDENTIAL_PROVIDER = "econodata";
const RATE_PER_MINUTE = 50; // o fornecedor aceita 60/min por chave; sobra margem para a tela

export type CompanyDataJobData = { organizationId: string; companyId: string; userId: string | null };

/** Modo simulado: dados sintéticos, sem chave e sem rede. Nunca em produção. */
export const simulationActive = () => env.ECONODATA_MOCK_MODE && !isProd;

let mock: ReturnType<typeof createEconodataMock> | null = null;
let fetchOverride: typeof fetch | null = null;

/** Somente testes: troca o transporte HTTP (ex.: falhas específicas). */
export function setDataProviderFetchForTests(f: typeof fetch | null) {
  if (!isTest) throw new Error("setDataProviderFetchForTests só pode ser usado em testes");
  fetchOverride = f;
}

export async function dataSettingsOf(organizationId: string): Promise<DataEnrichmentSettings> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
  return readOrgSettings(org.settings).dataEnrichment;
}

export async function credentialInfo(organizationId: string) {
  const row = await prisma.aiCredential.findUnique({ where: { organizationId_provider: { organizationId, provider: CREDENTIAL_PROVIDER } }, select: { keyHint: true, updatedAt: true } });
  return { hasKey: !!row, keyHint: row?.keyHint ?? null, updatedAt: row?.updatedAt ?? null };
}

async function apiKeyOf(organizationId: string): Promise<string> {
  const row = await prisma.aiCredential.findUnique({ where: { organizationId_provider: { organizationId, provider: CREDENTIAL_PROVIDER } }, select: { encryptedKey: true } });
  if (!row) return "";
  try {
    return decryptSecret(row.encryptedKey);
  } catch {
    logger.warn({ organizationId }, "chave da Econodata não pôde ser decifrada; cadastre de novo");
    return "";
  }
}

/** Cliente com a chave da própria conta (ou o simulado, fora de produção). */
export async function providerFor(organizationId: string, apiKeyOverride?: string): Promise<{ client: EconodataClient; provider: string; simulated: boolean }> {
  const simulated = simulationActive();
  const key = apiKeyOverride ?? (await apiKeyOf(organizationId));
  if (!simulated && !key) throw new ProviderError("NOT_CONFIGURED");
  const transport = fetchOverride ?? (simulated ? (mock ??= createEconodataMock()) : undefined);
  return { client: createEconodataClient({ apiKey: key || "ek_simulado_sem_chave", baseUrl: env.ECONODATA_BASE_URL, fetch: transport }), provider: simulated ? "econodata-mock" : "econodata", simulated };
}

export async function usageToday(organizationId: string) {
  const since = startOfDayBR();
  const agg = await prisma.dataProviderCall.aggregate({ where: { organizationId, createdAt: { gte: since }, estimateOnly: false, operation: { not: "balance" } }, _count: true, _sum: { tokensCharged: true } });
  return { requests: agg._count, tokens: agg._sum.tokensCharged ?? 0, since };
}

type Usage = Awaited<ReturnType<typeof usageToday>>;

/** Motivo para NÃO fazer a chamada paga, ou null se está dentro dos limites da conta. */
export function limitReason(s: DataEnrichmentSettings, usage: Usage, estimated: number | null): string | null {
  if (usage.requests >= s.maxDailyRequests) return `Limite diário de ${s.maxDailyRequests} consultas atingido. Libera de novo à 0h (horário de Brasília).`;
  if (estimated == null) return null;
  if (estimated > s.maxTokensPerCall) return `Custo estimado de ${estimated} tokens acima do limite por consulta (${s.maxTokensPerCall}).`;
  if (usage.tokens + estimated > s.maxDailyTokens) return `O custo estimado (${estimated} tokens) passaria do limite diário: ${usage.tokens} de ${s.maxDailyTokens} já usados hoje.`;
  return null;
}

/** Limite por minuto do nosso lado, por conta (o fornecedor responde 429 acima de 60/min por chave). */
async function rateLimit(organizationId: string) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `cdata:rl:${organizationId}:${minute}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 70);
  if (n > RATE_PER_MINUTE) throw new ProviderError("RATE_LIMIT", "Limite por minuto desta conta atingido.", null, (minute + 1) * 60_000 - Date.now());
}

type Ctx = { organizationId: string; companyId: string | null; userId: string | null; provider: string };

/** Chamada ao fornecedor com ritmo controlado, novas tentativas para erros temporários e registro de consumo. */
async function call<T>(ctx: Ctx, operation: "match" | "lookup" | "balance", estimateOnly: boolean, fn: () => Promise<CallResult<T>>): Promise<CallResult<T>> {
  await rateLimit(ctx.organizationId);
  const started = Date.now();
  const base = { organizationId: ctx.organizationId, companyId: ctx.companyId, requestedById: ctx.userId, provider: ctx.provider, operation, estimateOnly };
  try {
    const r = await withRetry(fn, { onRetry: (e, attempt) => logger.info({ organizationId: ctx.organizationId, operation, code: e.code, attempt }, "dados empresariais: nova tentativa") });
    await prisma.dataProviderCall.create({
      data: { ...base, ok: true, httpStatus: r.meta.httpStatus, tokensCharged: estimateOnly ? 0 : r.meta.tokensCharged, tokensEstimated: estimateOnly && isEstimate(r.data) ? r.data.tokensEstimados : null, durationMs: Date.now() - started },
    });
    return r;
  } catch (err) {
    const e = err instanceof ProviderError ? err : new ProviderError("UNAVAILABLE");
    await prisma.dataProviderCall.create({ data: { ...base, ok: false, httpStatus: e.httpStatus, errorCode: e.code, durationMs: Date.now() - started } });
    throw e;
  }
}

const estimated = (r: CallResult<unknown>) => (isEstimate(r.data) ? r.data.tokensEstimados : null);

/** Erros que não mudam o estado da empresa: viram resposta HTTP direta. */
function asHttpError(e: ProviderError): AppError {
  if (e.code === "LIMIT_EXCEEDED") return new AppError(429, "DATA_LIMIT", e.detail ?? e.message);
  if (e.code === "RATE_LIMIT") return new AppError(429, "DATA_RATE_LIMIT", e.detail ?? e.message);
  return new AppError(422, `DATA_${e.code}`, e.detail ? `${e.message} ${e.detail}` : e.message);
}

type ProfileRow = Prisma.CompanyDataProfileGetPayload<object>;

export function profileDto(row: ProfileRow | null, extra: { cached?: boolean } = {}) {
  if (!row) return null;
  return {
    provider: row.provider,
    simulated: row.provider.endsWith("-mock"),
    status: row.status as "MATCHED" | "CANDIDATES" | "NOT_FOUND" | "FAILED",
    cnpj: row.cnpj,
    matchConfidence: row.matchConfidence,
    matchedBy: row.matchedBy,
    identifiedBy: row.identifiedBy,
    profile: (row.profile as BusinessProfile | null) ?? null,
    candidates: (row.candidates as MatchCandidate[]) ?? [],
    warnings: row.warnings,
    buckets: row.buckets,
    tokensCharged: row.tokensCharged,
    errorCode: row.errorCode,
    error: row.error,
    fetchedAt: row.fetchedAt,
    updatedAt: row.updatedAt,
    cached: extra.cached ?? false,
  };
}

async function loadCompany(organizationId: string, companyId: string) {
  const c = await prisma.company.findFirst({
    where: { id: companyId, organizationId },
    select: { id: true, name: true, cnpj: true, legalName: true, city: true, state: true, website: true, normDomain: true, primaryPhone: true, primaryEmail: true },
  });
  if (!c) throw notFound("Empresa não encontrada.");
  return c;
}

/** Perfil mais recente da empresa (real ou simulado, conforme o modo atual). */
export async function currentProfile(organizationId: string, companyId: string) {
  const provider = simulationActive() ? "econodata-mock" : "econodata";
  return prisma.companyDataProfile.findUnique({ where: { organizationId_companyId_provider: { organizationId, companyId, provider } } });
}

/** O que vai acontecer e quanto deve custar, sem consumir tokens. */
export async function estimateEnrichment(organizationId: string, companyId: string, userId: string | null) {
  const s = await dataSettingsOf(organizationId);
  const c = await loadCompany(organizationId, companyId);
  const usage = await usageToday(organizationId);
  try {
    const { client, provider, simulated } = await providerFor(organizationId);
    const ctx: Ctx = { organizationId, companyId, userId, provider };
    if (isValidCnpj(c.cnpj)) {
      const r = await call(ctx, "lookup", true, () => client.lookup(cnpjDigits(c.cnpj), { buckets: s.buckets, estimateOnly: true }));
      const tokens = estimated(r);
      return { enabled: s.enabled, simulated, path: "cnpj_known" as const, steps: [{ operation: "lookup", tokens }], tokens, blocked: s.enabled ? limitReason(s, usage, tokens) : "Dados empresariais desativados nesta conta.", usage, note: null };
    }
    const criteria = matchCriteriaOf(c);
    const r = await call(ctx, "match", true, () => client.match(criteria, { buckets: ["cadastro"], estimateOnly: true }));
    const tokens = estimated(r);
    return {
      enabled: s.enabled,
      simulated,
      path: "match" as const,
      steps: [{ operation: "match", tokens }],
      tokens,
      blocked: s.enabled ? limitReason(s, usage, tokens) : "Dados empresariais desativados nesta conta.",
      usage,
      note: "Sem CNPJ validado: primeiro a empresa é identificada; a consulta completa por CNPJ tem custo próprio, conferido de novo antes de ser feita.",
    };
  } catch (err) {
    if (err instanceof ProviderError) throw asHttpError(err);
    throw err;
  }
}

function matchCriteriaOf(c: Awaited<ReturnType<typeof loadCompany>>) {
  return { name: c.name, state: c.state ?? undefined, site: c.normDomain ?? undefined, phone: c.primaryPhone ?? undefined, email: c.primaryEmail ?? undefined };
}

const fresh = (d: Date | null, days: number) => !!d && days > 0 && Date.now() - d.getTime() < days * 86_400_000;
const sameBuckets = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

type EnrichInput = { organizationId: string; companyId: string; userId: string | null; force?: boolean; chosenCnpj?: string; source?: "manual" | "batch" | "auto" };

export async function enrichCompany(input: EnrichInput) {
  const s = await dataSettingsOf(input.organizationId);
  if (!s.enabled) throw badRequest("Os dados empresariais estão desativados. Um administrador pode ativá-los em Configurações › Dados empresariais.");
  const c = await loadCompany(input.organizationId, input.companyId);
  let provider: Awaited<ReturnType<typeof providerFor>>;
  try {
    provider = await providerFor(input.organizationId);
  } catch (err) {
    throw err instanceof ProviderError ? asHttpError(err) : err;
  }
  const where = { organizationId_companyId_provider: { organizationId: input.organizationId, companyId: c.id, provider: provider.provider } };
  const existing = await prisma.companyDataProfile.findUnique({ where });

  // cache: mesmos blocos dentro do prazo da conta = nada de nova cobrança
  if (!input.force && !input.chosenCnpj && existing && ["MATCHED", "NOT_FOUND", "CANDIDATES"].includes(existing.status) && fresh(existing.updatedAt, s.cacheDays) && (existing.status !== "MATCHED" || sameBuckets(existing.buckets, s.buckets))) {
    return profileDto(existing, { cached: true });
  }

  // uma consulta por empresa de cada vez: evita cobrança dupla com clique repetido ou lote simultâneo
  const lockKey = `cdata:lock:${input.organizationId}:${c.id}`;
  if ((await redis.set(lockKey, "1", "EX", 180, "NX")) !== "OK") throw conflict("Já existe uma consulta de dados empresariais em andamento para esta empresa.");
  const ctx: Ctx = { organizationId: input.organizationId, companyId: c.id, userId: input.userId, provider: provider.provider };
  const { client, simulated } = provider;
  let tokens = 0;
  const save = (data: Omit<Prisma.CompanyDataProfileUncheckedCreateInput, "organizationId" | "companyId" | "provider">) =>
    prisma.companyDataProfile.upsert({ where, create: { organizationId: input.organizationId, companyId: c.id, provider: provider.provider, ...data }, update: data });

  try {
    let cnpj: string;
    let identifiedBy: string;
    let matchConfidence: number | null = null;
    let matchedBy: string[] = [];
    const warnings: string[] = [];

    if (input.chosenCnpj) {
      const chosen = cnpjDigits(input.chosenCnpj);
      const candidate = ((existing?.candidates as MatchCandidate[] | undefined) ?? []).find((x) => x.cnpj === chosen);
      if (!candidate) throw badRequest("Escolha um dos candidatos encontrados para esta empresa.");
      cnpj = chosen;
      identifiedBy = "manual_choice";
      matchConfidence = candidate.confidence;
      matchedBy = candidate.matchedBy;
    } else if (isValidCnpj(c.cnpj)) {
      cnpj = cnpjDigits(c.cnpj);
      identifiedBy = "cnpj_known";
      matchedBy = ["cnpj"];
    } else {
      // identificação: só o cadastro (para validar UF/cidade); a consulta completa vem depois, por CNPJ
      const criteria = matchCriteriaOf(c);
      const est = await call(ctx, "match", true, () => client.match(criteria, { buckets: ["cadastro"], estimateOnly: true }));
      const reason = limitReason(s, await usageToday(input.organizationId), estimated(est));
      if (reason) throw new ProviderError("LIMIT_EXCEEDED", reason);
      const r = await call(ctx, "match", false, () => client.match(criteria, { buckets: ["cadastro"] }));
      tokens += r.meta.tokensCharged;
      const items = isEstimate(r.data) ? [] : r.data.correspondencias;
      const decision = decideMatch({ city: c.city, state: c.state }, items, s.minMatchConfidence);
      if (decision.action === "NOT_FOUND") {
        const row = await save({ status: "NOT_FOUND", cnpj: null, matchConfidence: null, matchedBy: [], identifiedBy: null, profile: Prisma.DbNull, candidates: [], warnings: ["O fornecedor não encontrou empresa com esses dados (consulta sem custo)."], buckets: [], tokensCharged: tokens, errorCode: null, error: null, fetchedAt: new Date() });
        return profileDto(row);
      }
      if (decision.action === "ASK") {
        const row = await save({ status: "CANDIDATES", cnpj: null, matchConfidence: decision.candidates[0]?.confidence ?? null, matchedBy: decision.candidates[0]?.matchedBy ?? [], identifiedBy: null, profile: Prisma.DbNull, candidates: decision.candidates as unknown as Prisma.InputJsonValue, warnings: [decision.reason], buckets: [], tokensCharged: tokens, errorCode: null, error: null, fetchedAt: new Date() });
        return profileDto(row);
      }
      cnpj = decision.cnpj;
      identifiedBy = "match";
      matchConfidence = decision.confidence;
      matchedBy = decision.matchedBy;
    }

    // consulta completa por CNPJ (reconsultar a mesma empresa em 24h não recobra no fornecedor)
    const est = await call(ctx, "lookup", true, () => client.lookup(cnpj, { buckets: s.buckets, estimateOnly: true }));
    const reason = limitReason(s, await usageToday(input.organizationId), estimated(est));
    if (reason) throw new ProviderError("LIMIT_EXCEEDED", reason);
    const l = await call(ctx, "lookup", false, () => client.lookup(cnpj, { buckets: s.buckets }));
    tokens += l.meta.tokensCharged;
    if (isEstimate(l.data)) throw new ProviderError("INVALID_REQUEST", "O fornecedor devolveu uma prévia em vez dos dados.");
    const fetchedAt = new Date();
    const profile = normalizeEconodata(l.data.empresa, { provider: provider.provider, simulated, fetchedAt: fetchedAt.toISOString(), buckets: s.buckets });
    if (identifiedBy !== "match") warnings.push(...locationWarnings({ city: c.city, state: c.state }, profile.address ? { city: profile.address.value.city, state: profile.address.value.state } : null));
    if (profile.registrationStatus && profile.registrationStatus.value !== "ATIVA") warnings.push(`Situação do CNPJ na Receita: ${profile.registrationStatus.value}.`);
    const row = await save({ status: "MATCHED", cnpj, matchConfidence, matchedBy, identifiedBy, profile: profile as unknown as Prisma.InputJsonValue, candidates: [], warnings, buckets: s.buckets, tokensCharged: tokens, errorCode: null, error: null, fetchedAt });
    if (!simulated) await writeBack(input.organizationId, c, profile, identifiedBy, matchConfidence);
    await writeAudit(null, { action: "company.data_enriched", organizationId: input.organizationId, userId: input.userId, entityType: "company", entityId: c.id, metadata: { provider: provider.provider, identifiedBy, tokens, source: input.source ?? "manual" } });
    return profileDto(row);
  } catch (err) {
    if (!(err instanceof ProviderError)) throw err;
    if (["LIMIT_EXCEEDED", "RATE_LIMIT", "NOT_CONFIGURED"].includes(err.code)) throw asHttpError(err);
    // falha do fornecedor: fica registrada; um perfil bom anterior é mantido
    const message = err.detail ? `${err.message} ${err.detail}` : err.message;
    if (err.code === "NOT_FOUND" && existing?.status !== "MATCHED") {
      const row = await save({ status: "NOT_FOUND", cnpj: input.chosenCnpj ? cnpjDigits(input.chosenCnpj) : cnpjDigits(c.cnpj) || null, warnings: ["O fornecedor não encontrou o CNPJ informado."], candidates: (existing?.candidates ?? []) as Prisma.InputJsonValue, buckets: [], tokensCharged: tokens, errorCode: null, error: null, fetchedAt: new Date() });
      return profileDto(row);
    }
    const row =
      existing?.status === "MATCHED"
        ? await prisma.companyDataProfile.update({ where, data: { errorCode: err.code, error: message } })
        : await save({ status: "FAILED", cnpj: null, warnings: [], candidates: (existing?.candidates ?? []) as Prisma.InputJsonValue, buckets: [], tokensCharged: tokens, errorCode: err.code, error: message, fetchedAt: null });
    return profileDto(row);
  } finally {
    await redis.del(lockKey);
  }
}

/**
 * Registra na empresa o que é oficial e seguro: CNPJ (quando ela não tinha) e razão social, com procedência.
 * Nada que a empresa já tenha é sobrescrito; divergências aparecem como contradição nas fontes.
 */
async function writeBack(organizationId: string, c: Awaited<ReturnType<typeof loadCompany>>, p: BusinessProfile, identifiedBy: string, confidence: number | null) {
  const conf = identifiedBy === "cnpj_known" ? 0.95 : Math.min(0.95, confidence ?? 0.85);
  const data: Prisma.CompanyUpdateInput = {};
  if (!isValidCnpj(c.cnpj)) data.cnpj = p.cnpj;
  if (!c.legalName && p.legalName) data.legalName = p.legalName.value;
  const sources: Prisma.CompanyFieldSourceCreateManyInput[] = [
    { organizationId, companyId: c.id, field: "cnpj", value: p.cnpj, source: "ECONODATA", sourceRef: `Econodata (${identifiedBy})`, status: "VERIFIED", confidence: conf },
    ...(p.legalName ? [{ organizationId, companyId: c.id, field: "legalName", value: p.legalName.value, source: "ECONODATA" as const, sourceRef: "Econodata · cadastro", status: "VERIFIED" as const, confidence: conf }] : []),
    ...(p.address?.value.city ? [{ organizationId, companyId: c.id, field: "city", value: p.address.value.city, source: "ECONODATA" as const, sourceRef: "Econodata · cadastro", status: "VERIFIED" as const, confidence: conf }] : []),
  ];
  await prisma.$transaction([...(Object.keys(data).length ? [prisma.company.update({ where: { id: c.id }, data })] : []), prisma.companyFieldSource.createMany({ data: sources })]);
}

/** Saldo de tokens no fornecedor (consulta gratuita). */
export async function providerBalance(organizationId: string, userId: string | null, apiKeyOverride?: string) {
  const { client, provider, simulated } = await providerFor(organizationId, apiKeyOverride);
  const r = await call({ organizationId, companyId: null, userId, provider }, "balance", false, () => client.balance());
  return { tokens: r.data.saldoTokens, simulated };
}

/** Lote: vai para a fila (ritmo controlado no worker); empresas repetidas ou de outra conta são ignoradas. */
export async function enqueueBatch(organizationId: string, companyIds: string[], userId: string | null) {
  const s = await dataSettingsOf(organizationId);
  if (!s.enabled) throw badRequest("Os dados empresariais estão desativados nesta conta.");
  const ids = [...new Set(companyIds)];
  if (ids.length > s.maxBatchSize) throw badRequest(`O lote pode ter até ${s.maxBatchSize} empresas (configuração da conta).`);
  const usage = await usageToday(organizationId);
  if (usage.requests >= s.maxDailyRequests) throw new AppError(429, "DATA_LIMIT", `Limite diário de ${s.maxDailyRequests} consultas atingido.`);
  const valid = await prisma.company.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } });
  for (const { id } of valid) {
    await queue(QUEUES.companyData).add("company-data.enrich", { organizationId, companyId: id, userId } satisfies CompanyDataJobData, { jobId: `cdata-${organizationId}-${id}`, attempts: 1, removeOnComplete: true, removeOnFail: true });
  }
  return { queued: valid.length, ignored: ids.length - valid.length };
}

export async function processCompanyDataJob(job: { data: CompanyDataJobData }) {
  try {
    await enrichCompany({ ...job.data, source: "batch" });
  } catch (err) {
    logger.warn({ organizationId: job.data.organizationId, companyId: job.data.companyId, err: (err as Error).message }, "dados empresariais em lote: empresa não enriquecida");
  }
}

/** Depois de uma busca, se a conta ligou o automático: só empresas novas com CNPJ ou site, até o limite por busca. */
export async function autoEnrichAfterSearch(organizationId: string, searchJobId: string) {
  const s = await dataSettingsOf(organizationId);
  if (!s.enabled || !s.autoEnrich) return 0;
  const rows = await prisma.searchResult.findMany({
    where: { searchJobId, isNew: true, company: { OR: [{ cnpj: { not: null } }, { normDomain: { not: null } }], dataProfiles: { none: {} } } },
    select: { companyId: true },
    take: s.autoEnrichMaxPerSearch,
  });
  const ids = rows.map((r) => r.companyId).filter((x): x is string => !!x);
  if (!ids.length) return 0;
  return (await enqueueBatch(organizationId, ids.slice(0, s.maxBatchSize), null)).queued;
}

export async function dataSettingsView(organizationId: string) {
  const [settings, credential, usage] = await Promise.all([dataSettingsOf(organizationId), credentialInfo(organizationId), usageToday(organizationId)]);
  const simulated = simulationActive();
  return { settings, credential, simulated, configured: simulated || credential.hasKey, usage: { requests: usage.requests, tokens: usage.tokens }, provider: { id: "econodata", label: "Econodata", docs: "https://econodata-tecnologia.github.io/api-v4-docs/" } };
}
