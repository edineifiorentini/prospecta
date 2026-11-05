import { redactSecrets } from "../../ai/errors.ts";
import { ProviderError, type MatchCriteria, type ProviderErrorCode } from "../types.ts";
import type { EconodataCompany } from "./normalize.ts";

/**
 * Cliente da Econodata API v4 (https://econodata-tecnologia.github.io/api-v4-docs/, openapi.yaml).
 * Só o backend fala com o fornecedor; a chave vai no header Authorization e nunca aparece em
 * mensagens, registros ou respostas da API do Prospecta.
 *
 * Endpoints usados (contrato público):
 * - POST /v4/companies/match   — identificação por critérios soltos (até 5 candidatos com confiança)
 * - POST /v4/companies/search  — consulta por CNPJ com os blocos pedidos em `incluir`
 * - GET  /v4/account/balance   — saldo de tokens (nunca cobra)
 * Todo endpoint de dados aceita `X-Estimate-Only: true`: devolve { tokensEstimados } sem cobrar nem entregar dado.
 */

export const ECONODATA_BUCKETS = ["cadastro", "estrategico", "perfilNegocio", "contatosBasicos", "contatosAvancados"] as const;
export type EconodataBucket = (typeof ECONODATA_BUCKETS)[number];

export type EconodataMatchItem = { cnpj: string; confianca: number; correspondidoEm: string[]; razaoSocial: string | null; nomeFantasia: string | null; empresa?: EconodataCompany };

export type CallMeta = { httpStatus: number; tokensCharged: number; durationMs: number; rateLimitRemaining: number | null };
export type CallResult<T> = { data: T; meta: CallMeta };
export type Estimate = { tokensEstimados: number };

export const isEstimate = (x: unknown): x is Estimate => !!x && typeof (x as Estimate).tokensEstimados === "number";

type Options = { apiKey: string; baseUrl: string; fetch?: typeof fetch; timeoutMs?: number };
type RequestOptions = { body?: unknown; estimateOnly?: boolean; signal?: AbortSignal };

const STATUS_CODE: Record<number, ProviderErrorCode> = { 400: "INVALID_REQUEST", 401: "AUTH", 402: "INSUFFICIENT_BALANCE", 403: "FORBIDDEN", 404: "NOT_FOUND", 422: "INVALID_REQUEST", 429: "RATE_LIMIT" };

const intHeader = (h: Headers, name: string) => {
  const v = h.get(name);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Espera sugerida num 429: Retry-After (segundos) ou X-RateLimit-Reset (segundos ou horário Unix). */
function retryAfterMs(h: Headers): number | null {
  const ra = intHeader(h, "retry-after");
  if (ra != null) return Math.max(0, ra * 1000);
  const reset = intHeader(h, "x-ratelimit-reset");
  if (reset == null) return null;
  return reset > 1e9 ? Math.max(0, reset * 1000 - Date.now()) : Math.max(0, reset * 1000);
}

/** Domínio limpo, como o fornecedor espera (sem protocolo, www ou caminho). */
export function siteHost(site: string | null | undefined): string | null {
  if (!site) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(site) ? site : `https://${site}`);
    return u.hostname.replace(/^www\./i, "").toLowerCase() || null;
  } catch {
    return null;
  }
}

export function toEconodataCriteria(c: MatchCriteria) {
  const uf = c.state?.trim().toUpperCase();
  const out = {
    cnpj: c.cnpj?.replace(/\D/g, "") || undefined,
    nome: c.name?.trim() || undefined,
    uf: uf && /^[A-Z]{2}$/.test(uf) ? uf : undefined,
    site: siteHost(c.site) ?? undefined,
    telefone: c.phone?.trim() || undefined,
    email: c.email?.trim() || undefined,
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

export function createEconodataClient(opts: Options) {
  async function request<T>(method: "GET" | "POST", path: string, o: RequestOptions = {}): Promise<CallResult<T>> {
    if (!opts.apiKey) throw new ProviderError("NOT_CONFIGURED");
    const headers: Record<string, string> = { Authorization: `Bearer ${opts.apiKey}`, Accept: "application/json" };
    if (o.body !== undefined) headers["Content-Type"] = "application/json";
    if (o.estimateOnly) headers["X-Estimate-Only"] = "true";
    const signals = [AbortSignal.timeout(opts.timeoutMs ?? 20_000), ...(o.signal ? [o.signal] : [])];
    const started = Date.now();
    let res: Response;
    try {
      res = await (opts.fetch ?? fetch)(new URL(path, opts.baseUrl), { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body), signal: AbortSignal.any(signals) });
    } catch (err) {
      throw new ProviderError("UNAVAILABLE", redactSecrets(String((err as Error)?.message ?? err)));
    }
    const meta: CallMeta = { httpStatus: res.status, tokensCharged: intHeader(res.headers, "x-tokens-charged") ?? 0, durationMs: Date.now() - started, rateLimitRemaining: intHeader(res.headers, "x-ratelimit-remaining") };
    if (res.ok) return { data: (await res.json()) as T, meta };
    // erros no formato RFC 7807 (application/problem+json)
    let detail: string | null = null;
    try {
      const p = (await res.json()) as { title?: string; detail?: string };
      detail = [p.title, p.detail].filter(Boolean).join(": ") || null;
    } catch {
      detail = null;
    }
    const code = STATUS_CODE[res.status] ?? (res.status >= 500 ? "UNAVAILABLE" : "INVALID_REQUEST");
    throw new ProviderError(code, detail ? redactSecrets(detail) : null, res.status, code === "RATE_LIMIT" ? retryAfterMs(res.headers) : null);
  }

  return {
    /** Identificação: até 5 candidatos; lista vazia não cobra. Só o melhor, quando confiante, traz `empresa` (e é cobrado). */
    match: (criteria: MatchCriteria, o: { buckets: readonly EconodataBucket[]; estimateOnly?: boolean; signal?: AbortSignal }) =>
      request<{ correspondencias: EconodataMatchItem[] } | Estimate>("POST", "/v4/companies/match", {
        body: { criterios: toEconodataCriteria(criteria), ...(o.buckets.length ? { incluir: o.buckets } : {}) },
        estimateOnly: o.estimateOnly,
        signal: o.signal,
      }),
    /** Consulta por CNPJ com os blocos pedidos; reconsultar a mesma empresa em 24h não recobra. */
    lookup: (cnpj: string, o: { buckets: readonly EconodataBucket[]; scope?: "unidade" | "matrizFiliais"; estimateOnly?: boolean; signal?: AbortSignal }) =>
      request<{ empresa: EconodataCompany } | Estimate>("POST", "/v4/companies/search", {
        body: { criterios: { cnpj: cnpj.replace(/\D/g, "") }, incluir: o.buckets, ...(o.scope && o.scope !== "unidade" ? { escopo: o.scope } : {}) },
        estimateOnly: o.estimateOnly,
        signal: o.signal,
      }),
    /** Saldo de tokens da conta no fornecedor (nunca cobra). */
    balance: (signal?: AbortSignal) => request<{ saldoTokens: number }>("GET", "/v4/account/balance", { signal }),
  };
}

export type EconodataClient = ReturnType<typeof createEconodataClient>;

/** Tenta de novo só erros temporários (429 e indisponibilidade), com espera crescente. */
export async function withRetry<T>(fn: () => Promise<T>, o: { maxRetries?: number; sleep?: (ms: number) => Promise<void>; onRetry?: (err: ProviderError, attempt: number) => void } = {}): Promise<T> {
  const max = o.maxRetries ?? 2;
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!(err instanceof ProviderError) || !err.retryable || attempt >= max) throw err;
      o.onRetry?.(err, attempt + 1);
      await sleep(Math.min(10_000, err.retryAfterMs ?? 1000 * 2 ** attempt));
    }
  }
}
