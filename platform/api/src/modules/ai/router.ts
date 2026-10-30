import { AiError, toAiError } from "./errors.ts";
import { getAdapter } from "./registry.ts";
import type { AiProviderId, StructuredRequest, StructuredResponse } from "./types.ts";

/**
 * Executa uma chamada estruturada seguindo um plano de provedores.
 *
 * - Modo manual: o plano tem um único provedor; se ele falhar, a operação falha.
 * - Alternância automática: só percorre provedores que o cliente autorizou, na ordem da política,
 *   e cada tentativa fica registrada em `attempts` para a tela mostrar quem respondeu e por quê.
 * - Tentativas extras no mesmo provedor apenas para erros temporários (limite, timeout, rede, formato).
 */
export type PlanStep = { provider: AiProviderId; model: string };
export type Attempt = { provider: AiProviderId; model: string; ok: boolean; errorCode: string | null; error: string | null; durationMs: number; retry: number };

export type RunOptions<T> = {
  plan: PlanStep[];
  request: Omit<StructuredRequest, "model" | "signal" | "timeoutMs">;
  timeoutMs: number;
  maxRetries: number;
  signal: AbortSignal;
  /** bloqueia um passo antes de chamar (ex.: custo acima do limite) */
  precheck?: (step: PlanStep) => AiError | null;
  /** valida o texto devolvido; deve lançar AiError("INVALID_OUTPUT") se não servir */
  parse: (text: string) => T;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
};

export type RunResult<T> = { value: T; response: StructuredResponse; step: PlanStep; attempts: Attempt[] };

const defaultSleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

export class AiRunError extends Error {
  constructor(
    public last: AiError,
    public attempts: Attempt[],
  ) {
    super(last.message);
  }
}

export async function runStructured<T>(opts: RunOptions<T>): Promise<RunResult<T>> {
  const attempts: Attempt[] = [];
  const sleep = opts.sleep ?? defaultSleep;
  let last: AiError = new AiError("NOT_CONFIGURED", null);
  for (const step of opts.plan) {
    const blocked = opts.precheck?.(step);
    if (blocked) {
      attempts.push({ provider: step.provider, model: step.model, ok: false, errorCode: blocked.code, error: blocked.detail ?? blocked.message, durationMs: 0, retry: 0 });
      last = blocked;
      continue;
    }
    const adapter = getAdapter(step.provider);
    for (let retry = 0; retry <= opts.maxRetries; retry++) {
      if (opts.signal.aborted) throw new AiRunError(new AiError("CANCELLED", step.provider), attempts);
      const started = Date.now();
      const signal = AbortSignal.any([opts.signal, AbortSignal.timeout(opts.timeoutMs)]);
      try {
        const response = await adapter.generateStructured({ ...opts.request, model: step.model, signal, timeoutMs: opts.timeoutMs });
        const value = opts.parse(response.text);
        attempts.push({ provider: step.provider, model: response.modelUsed, ok: true, errorCode: null, error: null, durationMs: Date.now() - started, retry });
        return { value, response, step, attempts };
      } catch (err) {
        const e = toAiError(err, step.provider, signal);
        attempts.push({ provider: step.provider, model: step.model, ok: false, errorCode: e.code, error: e.detail ? `${e.message} ${e.detail}` : e.message, durationMs: Date.now() - started, retry });
        last = e;
        if (opts.signal.aborted || e.code === "CANCELLED") throw new AiRunError(new AiError("CANCELLED", step.provider), attempts);
        if (!e.retryable || retry === opts.maxRetries) break;
        await sleep(500 * 2 ** retry, opts.signal).catch(() => undefined);
      }
    }
  }
  throw new AiRunError(last, attempts);
}
