import type { AiProviderId } from "./types.ts";

export type AiErrorCode =
  | "NOT_CONFIGURED"
  | "AUTH"
  | "RATE_LIMIT"
  | "TIMEOUT"
  | "CANCELLED"
  | "MODEL_NOT_FOUND"
  | "BAD_REQUEST"
  | "PROVIDER_ERROR"
  | "NETWORK"
  | "REFUSED"
  | "TRUNCATED"
  | "INVALID_OUTPUT"
  | "COST_LIMIT";

const MESSAGES: Record<AiErrorCode, string> = {
  NOT_CONFIGURED: "Provedor sem chave cadastrada nesta conta (Configurações › Inteligência artificial).",
  AUTH: "A chave do provedor foi recusada (inválida, revogada ou sem permissão).",
  RATE_LIMIT: "O provedor limitou as requisições ou o saldo da conta acabou.",
  TIMEOUT: "O provedor não respondeu dentro do tempo limite.",
  CANCELLED: "A análise foi cancelada.",
  MODEL_NOT_FOUND: "O modelo escolhido não existe ou não está liberado para esta chave.",
  BAD_REQUEST: "O provedor recusou o formato da requisição.",
  PROVIDER_ERROR: "O provedor está com erro ou indisponível.",
  NETWORK: "Não foi possível conectar ao provedor.",
  REFUSED: "O modelo se recusou a responder.",
  TRUNCATED: "A resposta foi cortada pelo limite de tokens de saída.",
  INVALID_OUTPUT: "A resposta do modelo não seguiu o formato esperado.",
  COST_LIMIT: "A estimativa de custo passa do limite configurado.",
};

const RETRYABLE = new Set<AiErrorCode>(["RATE_LIMIT", "TIMEOUT", "PROVIDER_ERROR", "NETWORK", "INVALID_OUTPUT"]);

export class AiError extends Error {
  constructor(
    public code: AiErrorCode,
    public provider: AiProviderId | null,
    public detail: string | null = null,
  ) {
    super(MESSAGES[code]);
  }
  get retryable() {
    return RETRYABLE.has(this.code);
  }
}

/** Remove qualquer coisa com cara de chave de API antes de registrar ou mostrar uma mensagem. */
export function redactSecrets(text: string): string {
  return text
    .replace(/\b(sk-ant-[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9_-]{8,}|xai-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|AIza[0-9A-Za-z_-]{20,})/g, "[chave omitida]")
    .replace(/(authorization|x-api-key|x-goog-api-key)\s*[:=]\s*\S+/gi, "$1: [omitido]")
    .slice(0, 300);
}

/** Converte erros dos SDKs (OpenAI, Anthropic, Google) num AiError com mensagem segura. */
export function toAiError(err: unknown, provider: AiProviderId, signal?: AbortSignal): AiError {
  if (err instanceof AiError) return err;
  const e = err as { status?: number; code?: number | string; name?: string; message?: string };
  const detail = e?.message ? redactSecrets(String(e.message)) : null;
  if (signal?.aborted) return new AiError(signal.reason instanceof DOMException && signal.reason.name === "TimeoutError" ? "TIMEOUT" : "CANCELLED", provider, detail);
  const name = e?.name ?? "";
  if (/Timeout/i.test(name)) return new AiError("TIMEOUT", provider, detail);
  if (/Abort/i.test(name)) return new AiError("CANCELLED", provider, detail);
  const status = typeof e?.status === "number" ? e.status : typeof e?.code === "number" ? e.code : undefined;
  if (status === 401 || status === 403) return new AiError("AUTH", provider, detail);
  // a xAI responde 400 (não 401) para chave incorreta
  if (status === 400 && /api[ _-]?key|incorrect key|invalid key/i.test(detail ?? "")) return new AiError("AUTH", provider, detail);
  if (status === 404) return new AiError("MODEL_NOT_FOUND", provider, detail);
  if (status === 429) return new AiError("RATE_LIMIT", provider, detail);
  if (status === 400 || status === 422) return new AiError("BAD_REQUEST", provider, detail);
  if (status && status >= 500) return new AiError("PROVIDER_ERROR", provider, detail);
  if (/Connection|fetch failed|ECONN|ENOTFOUND|network/i.test(`${name} ${detail ?? ""}`)) return new AiError("NETWORK", provider, detail);
  return new AiError("PROVIDER_ERROR", provider, detail);
}
