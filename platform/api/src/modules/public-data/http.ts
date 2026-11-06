import { env, isProd } from "../../config/env.ts";
import { AppError } from "../../lib/errors.ts";
import { prisma } from "../../lib/prisma.ts";
import { redis } from "../../lib/redis.ts";
import { redactSecrets } from "../ai/errors.ts";
import { readOrgSettings, type IntegrationConfig } from "../orgs/settings.ts";
import { createPublicDataMock } from "./mock.ts";
import { sourceDef, type PublicSourceId } from "./sources.ts";

/**
 * Acesso às fontes públicas: limite por minuto (global, porque as fontes limitam por IP) e por dia (por conta),
 * nova tentativa com espera só para 429/indisponibilidade, registro de cada execução (IntegrationRun) e
 * modo simulado sem rede (PUBLIC_DATA_MOCK_MODE, ignorado em produção).
 */

export const publicMockActive = () => env.PUBLIC_DATA_MOCK_MODE && !isProd;

export type SourceErrorCode = "DISABLED" | "NOT_CONFIGURED" | "AUTH" | "NOT_FOUND" | "INVALID_REQUEST" | "RATE_LIMIT" | "UNAVAILABLE" | "LIMIT_EXCEEDED" | "BLOCKED";

const MESSAGES: Record<SourceErrorCode, string> = {
  DISABLED: "Integração desativada nesta conta (Configurações › Integrações).",
  NOT_CONFIGURED: "Esta integração precisa de uma chave gratuita cadastrada na conta.",
  AUTH: "A fonte recusou a chave cadastrada (inválida ou expirada).",
  NOT_FOUND: "A fonte não tem dados para esta consulta.",
  INVALID_REQUEST: "A fonte recusou os parâmetros da consulta.",
  RATE_LIMIT: "Limite de requisições da fonte atingido. Tente em instantes.",
  UNAVAILABLE: "A fonte está indisponível agora. Tente mais tarde.",
  LIMIT_EXCEEDED: "Limite diário de consultas desta integração atingido nesta conta.",
  BLOCKED: "Endereço bloqueado: só sites públicos podem ser analisados.",
};

export class SourceError extends Error {
  constructor(
    public code: SourceErrorCode,
    public detail: string | null = null,
    public httpStatus: number | null = null,
    public retryAfterMs: number | null = null,
  ) {
    super(MESSAGES[code]);
  }
  get retryable() {
    return this.code === "RATE_LIMIT" || this.code === "UNAVAILABLE";
  }
}

/** Configuração efetiva de uma fonte: padrão do catálogo + o que a conta mudou. */
export function integrationConfig(settings: unknown, id: PublicSourceId): IntegrationConfig {
  return { ...sourceDef(id).defaults, ...(readOrgSettings(settings).integrations[id] ?? {}) };
}

export async function orgIntegration(organizationId: string, id: PublicSourceId) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
  return integrationConfig(org.settings, id);
}

export async function assertEnabled(organizationId: string, id: PublicSourceId) {
  const cfg = await orgIntegration(organizationId, id);
  if (!cfg.enabled) throw new SourceError("DISABLED");
  return cfg;
}

let fetchOverride: typeof fetch | null = null;
let mockFetch: typeof fetch | null = null;
/** testes: troca o transporte HTTP (null volta ao padrão) */
export function setPublicFetchForTests(f: typeof fetch | null) {
  fetchOverride = f;
  mockFetch = null;
}
function transport(): typeof fetch {
  if (fetchOverride) return fetchOverride;
  if (publicMockActive()) return (mockFetch ??= createPublicDataMock());
  return fetch;
}

const dayKey = () => new Date().toISOString().slice(0, 10).replace(/-/g, "");

/** limite por minuto que o Prospecta se impõe por fonte (global: as fontes contam por IP) */
async function takeMinuteSlot(id: PublicSourceId) {
  const minute = Math.floor(Date.now() / 60_000);
  const key = `pub:rl:${id}:${minute}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 70);
  if (n > sourceDef(id).ratePerMinute) throw new SourceError("RATE_LIMIT", "limite por minuto do Prospecta para esta fonte", null, (minute + 1) * 60_000 - Date.now());
}

/** limite diário por conta (só chamadas de rede; cache não conta) */
async function takeDailySlot(id: PublicSourceId, organizationId: string | null, max: number) {
  if (!organizationId) return;
  const key = `pub:day:${organizationId}:${id}:${dayKey()}`;
  const n = await redis.incr(key);
  if (n === 1) await redis.expire(key, 2 * 86_400);
  if (n > max) throw new SourceError("LIMIT_EXCEEDED");
}

export async function usageToday(id: PublicSourceId, organizationId: string) {
  return Number((await redis.get(`pub:day:${organizationId}:${id}:${dayKey()}`)) ?? 0);
}

export async function withRetry<T>(fn: () => Promise<T>, o: { maxRetries?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<T> {
  const max = o.maxRetries ?? 2;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof SourceError) || !err.retryable || attempt >= max) throw err;
      await sleep(Math.min(10_000, err.retryAfterMs ?? 1000 * 2 ** attempt));
    }
  }
}

export type RequestOptions = {
  organizationId: string | null;
  /** limite diário da conta para esta fonte */
  maxDaily?: number;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** testes: espera entre tentativas */
  sleep?: (ms: number) => Promise<void>;
};

function retryAfter(res: Response) {
  const v = res.headers.get("retry-after");
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n * 1000 : Math.max(0, Date.parse(v) - Date.now()) || null;
}

/**
 * Uma requisição JSON a uma fonte pública. 204 e 404 viram `null` (sem dados); os demais erros viram SourceError.
 * A chave (quando houver) vai só no cabeçalho e nunca aparece em mensagem de erro.
 */
export async function requestJson<T>(id: PublicSourceId, url: string, o: RequestOptions): Promise<T | null> {
  await takeMinuteSlot(id);
  await takeDailySlot(id, o.organizationId, o.maxDaily ?? sourceDef(id).defaults.maxDailyRequests);
  return withRetry(
    async () => {
      let res: Response;
      try {
        res = await transport()(url, {
          method: o.method ?? "GET",
          headers: { accept: "application/json", "user-agent": env.HTTP_USER_AGENT, ...(o.body ? { "content-type": "application/json" } : {}), ...o.headers },
          body: o.body ? JSON.stringify(o.body) : undefined,
          signal: AbortSignal.timeout(o.timeoutMs ?? 30_000),
        });
      } catch (err) {
        throw new SourceError("UNAVAILABLE", redactSecrets((err as Error).message).slice(0, 200));
      }
      if (res.status === 204 || res.status === 404) return null;
      if (res.ok) {
        const text = await res.text();
        if (!text.trim()) return null;
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new SourceError("UNAVAILABLE", "resposta fora do formato JSON", res.status);
        }
      }
      const detail = redactSecrets((await res.text().catch(() => "")).slice(0, 300)) || null;
      if (res.status === 401 || res.status === 403) throw new SourceError("AUTH", detail, res.status);
      if (res.status === 429) throw new SourceError("RATE_LIMIT", detail, res.status, retryAfter(res));
      if (res.status === 400 && /api key|chave/i.test(detail ?? "")) throw new SourceError("AUTH", detail, res.status);
      if (res.status >= 400 && res.status < 500) throw new SourceError("INVALID_REQUEST", detail, res.status);
      throw new SourceError("UNAVAILABLE", detail, res.status);
    },
    { sleep: o.sleep },
  );
}

export type RunContext = { source: PublicSourceId; operation: "company" | "regional" | "sync" | "health" | "import"; organizationId?: string | null; companyId?: string | null };

/** Executa uma operação de integração e registra o resultado (sem chave e sem dado pessoal). */
export async function tracked<T>(ctx: RunContext, fn: () => Promise<{ value: T; records: number }>): Promise<T> {
  const started = Date.now();
  const base = { source: ctx.source, operation: ctx.operation, organizationId: ctx.organizationId ?? null, companyId: ctx.companyId ?? null, mock: publicMockActive() };
  try {
    const { value, records } = await fn();
    await prisma.integrationRun.create({ data: { ...base, ok: true, records, durationMs: Date.now() - started } });
    return value;
  } catch (err) {
    const e = err instanceof SourceError ? err : new SourceError("UNAVAILABLE", redactSecrets((err as Error).message).slice(0, 200));
    if (e.code !== "DISABLED") {
      await prisma.integrationRun.create({ data: { ...base, ok: false, httpStatus: e.httpStatus, errorCode: e.code, error: e.detail?.slice(0, 300) ?? null, durationMs: Date.now() - started } });
    }
    throw e;
  }
}

/** Erro de fonte → resposta HTTP da API do Prospecta (mensagem compreensível, sem segredo). */
export function sourceHttpError(err: unknown) {
  if (!(err instanceof SourceError)) return err;
  const status = err.code === "DISABLED" || err.code === "NOT_CONFIGURED" || err.code === "AUTH" ? 400 : err.code === "RATE_LIMIT" || err.code === "LIMIT_EXCEEDED" ? 429 : err.code === "NOT_FOUND" ? 404 : err.code === "BLOCKED" || err.code === "INVALID_REQUEST" ? 422 : 502;
  // a mensagem da fonte (detail) já passou por redactSecrets
  return new AppError(status, err.code, err.code === "INVALID_REQUEST" && err.detail ? err.detail : err.message, err.detail ? { detail: err.detail } : undefined);
}
