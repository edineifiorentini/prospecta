import { fold } from "../../lib/normalize.ts";
import type { DataEnrichmentSettings } from "../orgs/settings.ts";
import { CancelledError, econodataSearchSchema, type AdapterContext, type DiscoveredCompany, type EconodataSearchOptions, type SearchParams } from "../sources/types.ts";
import { cnpjDigits, formatCnpj } from "./cnpj.ts";
import { isEstimate, type EconodataBucket, type EconodataFilters } from "./econodata/client.ts";
import { normalizeEconodata, type EconodataCompany } from "./econodata/normalize.ts";
import { call, credentialInfo, dataSettingsOf, limitReason, providerFor, simulationActive, usageToday } from "./service.ts";
import { ProviderError, type BusinessProfile } from "./types.ts";

/**
 * Busca de empresas na Econodata (POST /v4/companies/search_list), como uma fonte da tela de busca ao lado do
 * Google Maps. Cada empresa trazida é cobrada em tokens; por isso:
 * - prévia antes de buscar: contagem (calc_list) + custo da 1ª página com X-Estimate-Only (não cobra);
 * - a busca para no limite de empresas pedido (e no limite da conta) e nos limites diários de consumo;
 * - cada página fica registrada em data_provider_calls, como as consultas da ficha.
 * O perfil normalizado de cada empresa já entra como dado empresarial (não precisa consultar de novo).
 */

const PAGE_MAX = 200;

const UF_BY_NAME: Record<string, string> = {
  acre: "AC", alagoas: "AL", amapa: "AP", amazonas: "AM", bahia: "BA", ceara: "CE", "distrito federal": "DF", "espirito santo": "ES", goias: "GO", maranhao: "MA", "mato grosso": "MT", "mato grosso do sul": "MS", "minas gerais": "MG", para: "PA", paraiba: "PB", parana: "PR", pernambuco: "PE", piaui: "PI", "rio de janeiro": "RJ", "rio grande do norte": "RN", "rio grande do sul": "RS", rondonia: "RO", roraima: "RR", "santa catarina": "SC", "sao paulo": "SP", sergipe: "SE", tocantins: "TO",
};

/** "Paraná", "parana" ou "PR" → "PR" */
export function ufOf(state: string | null | undefined): string | null {
  const t = (state ?? "").trim();
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  return UF_BY_NAME[fold(t)] ?? null;
}

export const econodataOptions = (p: SearchParams): EconodataSearchOptions => p.econodata ?? econodataSearchSchema.parse({});

/** Parâmetros da tela de busca → filtros da segmentação da Econodata (só filtros do contrato público). */
export function econodataFilters(p: SearchParams): EconodataFilters {
  const e = econodataOptions(p);
  const uf = ufOf(p.state);
  return {
    ...(e.activeOnly ? { situacao: ["ATIVA"] } : {}),
    ...(uf ? { uf: [uf] } : {}),
    cidade: [p.city.trim()],
    ...(e.cnaes.length ? { cnaePrimario: e.cnaes.map((c) => c.toUpperCase()) } : {}),
    ...(e.sizes.length ? { porte: e.sizes } : {}),
    palavrasChave: { incluir: [p.keyword.trim()], em: e.keywordScope },
    ...(e.onlyWithPhone ? { comTelefones: true } : {}),
  };
}

/** Blocos pedidos, conferidos contra o que a conta liberou (contatos são dado pessoal: só com o bloco liberado). */
export function searchBuckets(settings: DataEnrichmentSettings, e: EconodataSearchOptions): EconodataBucket[] {
  const blocked = e.buckets.filter((b) => !settings.buckets.includes(b));
  if (blocked.length) throw new ProviderError("FORBIDDEN", `Bloco(s) não liberado(s) nesta conta: ${blocked.join(", ")} (Configurações › Dados empresariais).`);
  return e.buckets;
}

/** Empresa da Econodata → registro de descoberta (o que não veio fica vazio, nunca inventado). */
export function toDiscovered(e: EconodataCompany, profile: BusinessProfile): DiscoveredCompany {
  const cad = e.cadastro ?? {};
  const best = (cad as { melhorNomeInferido?: string | null }).melhorNomeInferido;
  const end = cad.endereco ?? null;
  const contacts = e.contatosBasicos ?? null;
  const emails = [...(contacts?.emailsPublicos ?? []).map((x) => x.email ?? ""), ...(contacts?.emailsValidadosSetores ?? [])].filter(Boolean);
  return {
    name: (best || cad.nomeFantasia || cad.razaoSocial || formatCnpj(e.cnpj) || e.cnpj).trim(),
    legalName: cad.razaoSocial ?? null,
    cnpj: cnpjDigits(e.cnpj) || null,
    category: cad.cnaePrimario?.descricao ?? null,
    categories: cad.setores ?? [],
    phones: (contacts?.telefones ?? []).map((t) => t.numero ?? "").filter(Boolean),
    emails: [...new Set(emails)],
    address: end?.logradouro ?? null,
    neighborhood: end?.bairro ?? null,
    city: end?.cidade ?? cad.cidade ?? null,
    state: end?.uf ?? cad.uf ?? null,
    postalCode: end?.cep ?? null,
    country: "BR",
    // o restante fica no perfil empresarial, com procedência; nada de contato no registro bruto
    raw: { provider: profile.provider, cnpj: cnpjDigits(e.cnpj) },
    businessProfile: profile,
  };
}

const providerMessage = (err: unknown) => (err instanceof ProviderError ? `${err.message}${err.detail ? ` ${err.detail}` : ""}` : (err as Error).message);

/** Prévia gratuita: quantas empresas a busca acha e quanto custaria (não traz empresa nem cobra por empresa). */
export async function previewEconodataSearch(organizationId: string, userId: string | null, params: SearchParams) {
  const settings = await dataSettingsOf(organizationId);
  const simulated = simulationActive();
  const cred = await credentialInfo(organizationId);
  const base = { enabled: settings.enabled, configured: simulated || cred.hasKey, simulated };
  if (!settings.enabled || !base.configured) return { ...base, total: null, willFetch: 0, pages: 0, tokensPerPage: null, tokensEstimated: null, buckets: [], blocked: settings.enabled ? "Cadastre a chave da Econodata em Configurações › Dados empresariais." : "Dados empresariais desativados nesta conta.", usage: null };
  const e = econodataOptions(params);
  const buckets = searchBuckets(settings, e);
  const filtros = econodataFilters(params);
  const { client, provider } = await providerFor(organizationId);
  const ctx = { organizationId, companyId: null, userId, provider };
  try {
    const calc = await call(ctx, "calc_list", false, () => client.calcList(filtros));
    const total = calc.data.totalRegistros;
    const willFetch = Math.min(total, params.limit);
    const pageSize = Math.min(PAGE_MAX, params.limit);
    const pages = Math.ceil(willFetch / pageSize);
    let tokensPerPage: number | null = null;
    if (willFetch > 0) {
      const est = await call(ctx, "search_list", true, () => client.searchList({ filtros, pagina: { tamanho: Math.min(pageSize, willFetch) }, incluir: buckets }, { estimateOnly: true }));
      tokensPerPage = isEstimate(est.data) ? est.data.tokensEstimados : null;
    }
    const usage = await usageToday(organizationId);
    return {
      ...base,
      total,
      willFetch,
      pages,
      tokensPerPage,
      // a última página é menor: o total real fica no máximo nisso
      tokensEstimated: tokensPerPage != null ? tokensPerPage * pages : null,
      countTokensCharged: calc.meta.tokensCharged,
      buckets,
      blocked: willFetch > 0 ? limitReason(settings, usage, tokensPerPage) : null,
      usage: { requests: usage.requests, tokens: usage.tokens, maxDailyRequests: settings.maxDailyRequests, maxDailyTokens: settings.maxDailyTokens, maxTokensPerCall: settings.maxTokensPerCall },
    };
  } catch (err) {
    throw new Error(providerMessage(err));
  }
}

/** Execução da busca (chamada pelo processador de buscas, na fila). */
export async function runEconodataSearch(ctx: AdapterContext): Promise<DiscoveredCompany[]> {
  const { organizationId, userId, params } = ctx;
  const settings = await dataSettingsOf(organizationId);
  if (!settings.enabled) throw new Error("Dados empresariais desativados nesta conta (Configurações › Dados empresariais).");
  try {
    const buckets = searchBuckets(settings, econodataOptions(params));
    const filtros = econodataFilters(params);
    const { client, provider, simulated } = await providerFor(organizationId);
    const callCtx = { organizationId, companyId: null, userId, provider };
    const limit = Math.max(1, Math.min(params.limit, ctx.maxResults));
    const pageSize = Math.min(PAGE_MAX, limit);
    const est = await call(callCtx, "search_list", true, () => client.searchList({ filtros, pagina: { tamanho: pageSize }, incluir: buckets }, { estimateOnly: true }));
    const perPage = isEstimate(est.data) ? est.data.tokensEstimados : null;
    const first = limitReason(settings, await usageToday(organizationId), perPage);
    if (first) throw new Error(first);
    await ctx.progress({ phase: "running", message: `Consultando a Econodata${perPage != null ? ` (até ${perPage} tokens por página)` : ""}…` });

    const out: DiscoveredCompany[] = [];
    const fetchedAt = new Date().toISOString();
    let cursor: string | null = null;
    let total: number | null = null;
    while (out.length < limit) {
      if (await ctx.isCancelled()) throw new CancelledError();
      const reason = limitReason(settings, await usageToday(organizationId), perPage);
      if (reason) {
        // o que já foi pago é aproveitado; a busca para aqui
        await ctx.progress({ phase: "running", message: `Busca interrompida pelo limite da conta: ${reason}` });
        break;
      }
      const r = await call(callCtx, "search_list", false, () => client.searchList({ filtros, pagina: { tamanho: Math.min(pageSize, limit - out.length), cursor }, incluir: buckets }));
      if (isEstimate(r.data)) break;
      total ??= r.data.totalRegistros;
      for (const emp of r.data.resultados) {
        if (out.length >= limit) break;
        out.push(toDiscovered(emp, normalizeEconodata(emp, { provider, simulated, fetchedAt, buckets })));
      }
      await ctx.progress({ phase: "running", message: `${out.length} de ${Math.min(total, limit)} empresas recebidas da Econodata.`, found: out.length });
      cursor = r.data.pagina.cursorProximo ?? null;
      if (!cursor || !r.data.resultados.length) break;
    }
    ctx.log("busca na Econodata concluída", { found: out.length, total });
    return out;
  } catch (err) {
    if (err instanceof CancelledError) throw err;
    throw new Error(providerMessage(err));
  }
}
