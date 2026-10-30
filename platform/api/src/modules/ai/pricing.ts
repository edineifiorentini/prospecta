import type { AiProviderId, TokenUsage } from "./types.ts";

/**
 * Preços por 1 milhão de tokens (USD), conferidos nas páginas oficiais na data indicada.
 * Modelo fora da tabela, ou preço com data de validade vencida, tem custo DESCONHECIDO:
 * nada é estimado por aproximação. Atualize esta tabela quando os provedores mudarem os preços.
 */
export type Price = { input: number; output: number; verifiedAt: string; source: string; validUntil?: string; note?: string };

const OPENAI = "https://developers.openai.com/api/docs/models";
const ANTHROPIC = "https://platform.claude.com/docs/en/about-claude/pricing";
const XAI = "https://docs.x.ai/developers/models";
const GEMINI = "https://ai.google.dev/gemini-api/docs/pricing";
const GROQ = "https://console.groq.com/docs/models";

export const PRICING: Record<AiProviderId, Record<string, Price>> = {
  openai: {
    "gpt-6-astra": { input: 10, output: 50, verifiedAt: "2026-10-29", source: OPENAI },
    "gpt-6.1-sol": { input: 2, output: 10, verifiedAt: "2026-10-29", source: OPENAI },
    "gpt-6.1-terra": { input: 1, output: 5, verifiedAt: "2026-10-29", source: OPENAI },
    "gpt-6-luna": { input: 0.1, output: 0.5, verifiedAt: "2026-10-29", source: OPENAI },
  },
  anthropic: {
    "claude-fable-5-1": { input: 10, output: 50, verifiedAt: "2026-10-29", source: ANTHROPIC },
    "claude-opus-5-5": { input: 4, output: 20, verifiedAt: "2026-10-29", source: ANTHROPIC },
    "claude-opus-5": { input: 5, output: 25, verifiedAt: "2026-10-29", source: ANTHROPIC },
    "claude-sonnet-5-5": { input: 2, output: 10, verifiedAt: "2026-10-29", source: ANTHROPIC },
    "claude-haiku-5-5": { input: 0.1, output: 0.5, verifiedAt: "2026-10-29", source: ANTHROPIC, note: "prompts de até 100 mil tokens" },
  },
  xai: {
    "grok-4.7": { input: 2, output: 6, verifiedAt: "2026-10-29", source: XAI, note: "prompts abaixo de 200 mil tokens" },
    "grok-4.6": { input: 2, output: 6, verifiedAt: "2026-10-29", source: XAI, note: "prompts abaixo de 200 mil tokens" },
    "grok-4.5": { input: 2, output: 6, verifiedAt: "2026-10-29", source: XAI, note: "prompts abaixo de 200 mil tokens" },
    "grok-4.3": { input: 1.25, output: 2.5, verifiedAt: "2026-10-29", source: XAI, note: "prompts abaixo de 200 mil tokens" },
  },
  gemini: {
    "gemini-4-argon": { input: 2, output: 10, verifiedAt: "2026-10-29", source: GEMINI, validUntil: "2026-12-01", note: "o Google anunciou novo preço a partir de 01/12/2026" },
    "gemini-3.8-flash": { input: 0.75, output: 3.75, verifiedAt: "2026-10-29", source: GEMINI, validUntil: "2027-01-01", note: "o Google anunciou novo preço a partir de 01/01/2027" },
    "gemini-3.6-flash": { input: 0.75, output: 3.75, verifiedAt: "2026-10-29", source: GEMINI, validUntil: "2027-01-01", note: "o Google anunciou novo preço a partir de 01/01/2027" },
    "gemini-3.5-flash-lite": { input: 0.3, output: 2.5, verifiedAt: "2026-10-29", source: GEMINI },
    "gemini-2.5-pro": { input: 1.25, output: 10, verifiedAt: "2026-10-29", source: GEMINI, note: "prompts de até 200 mil tokens" },
    "gemini-2.5-flash": { input: 0.3, output: 2.5, verifiedAt: "2026-10-29", source: GEMINI },
  },
  // só modelos com saída estruturada estrita (json_schema strict) na Groq
  groq: {
    "openai/gpt-oss-120b": { input: 0.15, output: 0.6, verifiedAt: "2026-10-30", source: GROQ },
    "openai/gpt-oss-20b": { input: 0.075, output: 0.3, verifiedAt: "2026-10-30", source: GROQ },
    "qwen/qwen3.8-27b": { input: 0.8, output: 4, verifiedAt: "2026-10-30", source: GROQ, note: "modelo em prévia: pode ser descontinuado sem aviso" },
  },
};

export function priceOf(provider: AiProviderId, model: string, at = new Date()): Price | null {
  const p = PRICING[provider][model] ?? null;
  if (!p) return null;
  if (p.validUntil && at >= new Date(`${p.validUntil}T00:00:00Z`)) return null;
  return p;
}

export type CostEstimate = { usd: number | null; known: boolean; basis: string };

const usd = (v: number) => Math.round(v * 1_000_000) / 1_000_000;

/** Custo de uma resposta já recebida, pelos tokens informados pelo provedor. */
export function costOf(provider: AiProviderId, model: string, usage: TokenUsage, at = new Date()): CostEstimate {
  if (usage.providerCostUsd != null) return { usd: usd(usage.providerCostUsd), known: true, basis: "Custo informado pelo próprio provedor na resposta." };
  const price = priceOf(provider, model, at);
  if (!price) return { usd: null, known: false, basis: `Preço de ${model} não confirmado na tabela oficial: custo desconhecido.` };
  if (usage.inputTokens == null || usage.billableOutputTokens == null) return { usd: null, known: false, basis: "O provedor não informou os tokens consumidos: custo desconhecido." };
  return { usd: usd((usage.inputTokens * price.input + usage.billableOutputTokens * price.output) / 1_000_000), known: true, basis: `Tabela de ${price.verifiedAt} (${price.source}).` };
}

/** Estimativa ANTES da chamada: entrada aproximada (caracteres ÷ 4) + teto de saída (pior caso). */
export function estimateCost(provider: AiProviderId, model: string, inputChars: number, maxOutputTokens: number, at = new Date()): CostEstimate & { inputTokens: number; maxOutputTokens: number } {
  const inputTokens = Math.ceil(inputChars / 4);
  const price = priceOf(provider, model, at);
  if (!price) return { usd: null, known: false, basis: `Preço de ${model} não confirmado na tabela oficial: custo desconhecido.`, inputTokens, maxOutputTokens };
  return {
    usd: usd((inputTokens * price.input + maxOutputTokens * price.output) / 1_000_000),
    known: true,
    basis: `Pior caso: ~${inputTokens} tokens de entrada (estimativa) + até ${maxOutputTokens} de saída, pela tabela de ${price.verifiedAt}.`,
    inputTokens,
    maxOutputTokens,
  };
}
