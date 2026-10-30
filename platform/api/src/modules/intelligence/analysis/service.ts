import { prisma, type Prisma } from "../../../lib/prisma.ts";
import { redis } from "../../../lib/redis.ts";
import { sha256 } from "../../../lib/crypto.ts";
import { badRequest, conflict, unprocessable } from "../../../lib/errors.ts";
import { adaptersFor } from "../../ai/credentials.ts";
import { AiError } from "../../ai/errors.ts";
import { costOf, estimateCost } from "../../ai/pricing.ts";
import { defaultModel, getAdapter, type AdapterLookup } from "../../ai/registry.ts";
import { AiRunError, runStructured, type Attempt, type PlanStep } from "../../ai/router.ts";
import { PROVIDER_LABEL, type AiProviderId } from "../../ai/types.ts";
import { readOrgSettings, type AiSettings } from "../../orgs/settings.ts";
import { computeIntelligence } from "../service.ts";
import { buildEvidenceIndex, buildPrompt, type EvidenceRef } from "./prompt.ts";
import { AI_OUTPUT_JSON_SCHEMA, enforceEvidence, parseAiOutput, PROMPT_VERSION, type AiOutput } from "./schema.ts";

export type AnalysisChoice = { provider?: AiProviderId; model?: string };

export async function aiSettingsOf(organizationId: string): Promise<AiSettings> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
  return readOrgSettings(org.settings).ai;
}

const modelFor = (s: AiSettings, provider: AiProviderId) => s.models[provider] ?? defaultModel(provider);

/**
 * Plano de provedores. Escolha explícita na tela = só aquele provedor (sem alternância).
 * Sem escolha: provedor principal e, no modo automático, as alternativas autorizadas.
 * `get` traz os adaptadores com as chaves da conta (alternativa sem chave sai do plano).
 */
export function buildPlan(s: AiSettings, choice: AnalysisChoice, inputChars: number, get: AdapterLookup = (id) => getAdapter(id)): PlanStep[] {
  if (choice.provider) return [{ provider: choice.provider, model: choice.model?.trim() || modelFor(s, choice.provider) }];
  if (!s.primaryProvider) throw badRequest("Escolha um provedor de IA principal em Configurações › Inteligência artificial.");
  const ids: AiProviderId[] = s.mode === "auto" ? [s.primaryProvider, ...s.fallbackProviders.filter((p) => p !== s.primaryProvider)] : [s.primaryProvider];
  let steps = ids.map((provider) => ({ provider, model: modelFor(s, provider) }));
  if (s.mode === "auto") steps = steps.filter((st, i) => i === 0 || get(st.provider).isConfigured());
  if (s.mode === "auto" && s.autoPolicy === "lowest_cost") {
    const cost = (st: PlanStep) => estimateCost(st.provider, st.model, inputChars, s.maxOutputTokens).usd ?? Number.POSITIVE_INFINITY;
    steps = [...steps].sort((a, b) => cost(a) - cost(b));
  }
  return steps;
}

/** Barreira de custo antes de cada provedor. */
function costGuard(s: AiSettings, inputChars: number, get: AdapterLookup) {
  return (step: PlanStep): AiError | null => {
    if (!get(step.provider).isConfigured()) return new AiError("NOT_CONFIGURED", step.provider);
    const est = estimateCost(step.provider, step.model, inputChars, s.maxOutputTokens);
    if (!est.known && !s.allowUnknownCost) return new AiError("COST_LIMIT", step.provider, `Preço de ${step.model} desconhecido; libere "permitir custo desconhecido" para usar este modelo.`);
    if (est.usd != null && est.usd > s.maxCostUsdPerAnalysis) return new AiError("COST_LIMIT", step.provider, `Estimativa de pior caso US$ ${est.usd.toFixed(4)} acima do limite de US$ ${s.maxCostUsdPerAnalysis.toFixed(2)}.`);
    return null;
  };
}

async function prepare(organizationId: string, companyId: string, settings: AiSettings) {
  const intel = await computeIntelligence(organizationId, companyId);
  const evidence = buildEvidenceIndex(intel.facts);
  const prompt = buildPrompt({ company: intel.snapshot, facts: intel.facts, intelligence: intel.result, offering: settings.offering, evidence });
  return { intel, evidence, prompt, inputChars: prompt.system.length + prompt.user.length + JSON.stringify(AI_OUTPUT_JSON_SCHEMA).length };
}

const hashFor = (step: PlanStep, prompt: { system: string; user: string }) => sha256(JSON.stringify({ v: PROMPT_VERSION, p: step.provider, m: step.model, s: prompt.system, u: prompt.user }));

export async function estimateAnalysis(organizationId: string, companyId: string, choice: AnalysisChoice) {
  const settings = await aiSettingsOf(organizationId);
  const { inputChars } = await prepare(organizationId, companyId, settings);
  const get = await adaptersFor(organizationId);
  const plan = buildPlan(settings, choice, inputChars, get);
  const guard = costGuard(settings, inputChars, get);
  return {
    limitUsd: settings.maxCostUsdPerAnalysis,
    steps: plan.map((st) => {
      const blocked = guard(st);
      return { provider: st.provider, label: PROVIDER_LABEL[st.provider], model: st.model, configured: get(st.provider).isConfigured(), estimate: estimateCost(st.provider, st.model, inputChars, settings.maxOutputTokens), blocked: blocked ? { code: blocked.code, message: blocked.detail ?? blocked.message } : null };
    }),
  };
}

type StoredResult = { output: AiOutput; evidence: EvidenceRef[]; serverWarnings: string[]; notes: string[]; priority: string; composite: number | null };

export function toDto(a: Prisma.AiAnalysisGetPayload<object>, cached = false) {
  const r = a.result as StoredResult | null;
  const byId = new Map((r?.evidence ?? []).map((e) => [e.id, e]));
  return {
    id: a.id,
    companyId: a.companyId,
    status: a.status,
    provider: a.provider,
    providerLabel: a.provider ? PROVIDER_LABEL[a.provider as AiProviderId] ?? a.provider : null,
    model: a.model,
    requestedModel: a.requestedModel,
    generatedAt: a.createdAt,
    promptVersion: a.promptVersion,
    summary: r?.output.summary ?? null,
    verifiedFacts: (r?.output.verifiedFacts ?? []).map((f) => ({ fact: f.fact, evidence: f.evidenceIds.map((id) => byId.get(id)).filter(Boolean) })),
    evidenceSources: r?.evidence ?? [],
    opportunityHypotheses: (r?.output.opportunityHypotheses ?? []).map((h) => ({ ...h, evidence: h.evidenceIds.map((id) => byId.get(id)).filter(Boolean) })),
    confidence: r?.output.confidence ?? null,
    diagnosticQuestions: r?.output.diagnosticQuestions ?? [],
    personalizedMessage: r?.output.personalizedMessage ?? null,
    editedMessage: a.editedMessage,
    editedAt: a.editedAt,
    possibleObjections: r?.output.possibleObjections ?? [],
    recommendedNextAction: r?.output.recommendedNextAction ?? null,
    limitations: [...(r?.output.limitations ?? []), ...(r?.serverWarnings ?? []).map((w) => `Verificação do servidor: ${w}`)],
    notes: r?.notes ?? [],
    priorityAtGeneration: r?.priority ?? null,
    tokenUsage: { input: a.inputTokens, output: a.outputTokens, reasoning: a.reasoningTokens },
    estimatedCost: { usd: a.costUsd, known: a.costUsd != null, basis: a.costBasis },
    attempts: a.attempts as Attempt[],
    durationMs: a.durationMs,
    errorCode: a.errorCode,
    error: a.error,
    cached,
  };
}

export async function generateAnalysis(input: { organizationId: string; companyId: string; userId: string; choice: AnalysisChoice; force: boolean; signal: AbortSignal }) {
  const settings = await aiSettingsOf(input.organizationId);
  if (!settings.enabled) throw badRequest("A análise com IA está desativada. Um administrador pode ativá-la em Configurações › Inteligência artificial.");
  const { intel, evidence, prompt, inputChars } = await prepare(input.organizationId, input.companyId, settings);
  // só as chaves desta conta: nenhuma análise usa chave de outra conta
  const get = await adaptersFor(input.organizationId);
  const plan = buildPlan(settings, input.choice, inputChars, get);
  const guard = costGuard(settings, inputChars, get);
  const blocked = plan.map(guard);
  // nenhum provedor pode ser chamado: explica antes, sem registrar tentativa nem gastar nada
  if (blocked.every(Boolean)) throw unprocessable(blocked.map((b, i) => `${PROVIDER_LABEL[plan[i]!.provider]}: ${b!.detail ?? b!.message}`).join(" "));

  // cache: mesmos dados + mesmo provedor/modelo + mesma versão do prompt = mesma análise
  if (!input.force && settings.cacheDays > 0) {
    const since = new Date(Date.now() - settings.cacheDays * 86_400_000);
    // vale qualquer passo do plano: uma análise feita pela alternativa autorizada também serve
    const hit = await prisma.aiAnalysis.findFirst({ where: { organizationId: input.organizationId, companyId: input.companyId, status: "SUCCEEDED", inputHash: { in: plan.map((st) => hashFor(st, prompt)) }, createdAt: { gte: since } }, orderBy: { createdAt: "desc" } });
    if (hit) return toDto(hit, true);
  }

  // uma análise por empresa de cada vez (evita cobrança dupla com clique repetido)
  const lockKey = `ai:analysis:${input.organizationId}:${input.companyId}`;
  if ((await redis.set(lockKey, "1", "EX", settings.timeoutSeconds * (settings.maxRetries + 1) * plan.length + 30, "NX")) !== "OK") throw conflict("Já existe uma análise em andamento para esta empresa.");
  const started = Date.now();
  try {
    const knownIds = new Set(evidence.map((e) => e.id));
    const run = await runStructured({
      plan,
      request: { system: prompt.system, user: prompt.user, schemaName: "analise_comercial", schema: AI_OUTPUT_JSON_SCHEMA, maxOutputTokens: settings.maxOutputTokens },
      timeoutMs: settings.timeoutSeconds * 1000,
      maxRetries: settings.maxRetries,
      signal: input.signal,
      adapterFor: get,
      precheck: guard,
      parse: parseAiOutput,
    });
    const { output, warnings } = enforceEvidence(run.value, knownIds);
    const cost = costOf(run.step.provider, run.response.modelUsed, run.response.usage);
    const switched = run.attempts.some((a) => !a.ok) && run.step.provider !== plan[0]!.provider;
    const notes = [...run.response.notes, ...(switched ? [`Gerada por ${PROVIDER_LABEL[run.step.provider]} porque ${PROVIDER_LABEL[plan[0]!.provider]} não respondeu (alternância automática autorizada).`] : [])];
    const stored: StoredResult = { output, evidence, serverWarnings: warnings, notes, priority: intel.result.priority, composite: intel.result.composite };
    const row = await prisma.aiAnalysis.create({
      data: {
        organizationId: input.organizationId,
        companyId: input.companyId,
        requestedById: input.userId,
        status: "SUCCEEDED",
        provider: run.step.provider,
        model: run.response.modelUsed,
        requestedModel: run.step.model,
        promptVersion: PROMPT_VERSION,
        inputHash: hashFor(run.step, prompt),
        result: stored as unknown as Prisma.InputJsonValue,
        inputTokens: run.response.usage.inputTokens,
        outputTokens: run.response.usage.outputTokens,
        reasoningTokens: run.response.usage.reasoningTokens,
        costUsd: cost.usd,
        costBasis: cost.basis,
        attempts: run.attempts as unknown as Prisma.InputJsonValue,
        durationMs: Date.now() - started,
      },
    });
    return toDto(row);
  } catch (err) {
    if (!(err instanceof AiRunError)) throw err;
    const row = await prisma.aiAnalysis.create({
      data: {
        organizationId: input.organizationId,
        companyId: input.companyId,
        requestedById: input.userId,
        status: "FAILED",
        requestedModel: plan[0]!.model,
        promptVersion: PROMPT_VERSION,
        inputHash: hashFor(plan[0]!, prompt),
        attempts: err.attempts as unknown as Prisma.InputJsonValue,
        errorCode: err.last.code,
        error: err.last.detail ? `${err.last.message} ${err.last.detail}` : err.last.message,
        durationMs: Date.now() - started,
      },
    });
    return toDto(row);
  } finally {
    await redis.del(lockKey);
  }
}
