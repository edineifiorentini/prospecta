import { env, isTest } from "../../config/env.ts";
import { PRICING } from "./pricing.ts";
import { createAnthropicAdapter } from "./providers/anthropic.ts";
import { createGeminiAdapter } from "./providers/gemini.ts";
import { createGroqAdapter } from "./providers/groq.ts";
import { createResponsesAdapter } from "./providers/openai.ts";
import { AI_PROVIDERS, PROVIDER_LABEL, type AiProviderAdapter, type AiProviderId } from "./types.ts";

/**
 * Chaves administradas pela plataforma (variáveis de ambiente do servidor).
 * Chaves próprias de cada cliente (BYOK) ficam para quando houver armazenamento cifrado e
 * separado por conta; ver platform/docs/INTELIGENCIA-COMERCIAL.md.
 */
export const KEY_ENV: Record<AiProviderId, string> = { openai: "OPENAI_API_KEY", anthropic: "ANTHROPIC_API_KEY", xai: "XAI_API_KEY", gemini: "GEMINI_API_KEY", groq: "GROQ_API_KEY" };

/** Modelos padrão conferidos na documentação oficial em 29–30/10/2026 (substituíveis por OPENAI_MODEL etc.). */
export const DEFAULT_MODELS: Record<AiProviderId, string> = { openai: "gpt-6.1-sol", anthropic: "claude-opus-5-5", xai: "grok-4.7", gemini: "gemini-3.8-flash", groq: "openai/gpt-oss-120b" };

const keyOf = (id: AiProviderId) => ({ openai: env.OPENAI_API_KEY, anthropic: env.ANTHROPIC_API_KEY, xai: env.XAI_API_KEY, gemini: env.GEMINI_API_KEY, groq: env.GROQ_API_KEY })[id];
const modelEnv = (id: AiProviderId) => ({ openai: env.OPENAI_MODEL, anthropic: env.ANTHROPIC_MODEL, xai: env.XAI_MODEL, gemini: env.GEMINI_MODEL, groq: env.GROQ_MODEL })[id];

export const defaultModel = (id: AiProviderId) => modelEnv(id) || DEFAULT_MODELS[id];

/** Modelos sugeridos na tela: os de preço confirmado. A lista real vem do teste de conexão. */
export const suggestedModels = (id: AiProviderId) => [...new Set([defaultModel(id), ...Object.keys(PRICING[id])])];

const overrides = new Map<AiProviderId, AiProviderAdapter>();

/** Somente testes: troca um provedor por um falso, sem rede. */
export function setAdapterForTests(id: AiProviderId, adapter: AiProviderAdapter | null) {
  if (!isTest) throw new Error("setAdapterForTests só pode ser usado em testes");
  if (adapter) overrides.set(id, adapter);
  else overrides.delete(id);
}

export function getAdapter(id: AiProviderId): AiProviderAdapter {
  const o = overrides.get(id);
  if (o) return o;
  const apiKey = keyOf(id);
  if (id === "openai") return createResponsesAdapter({ id, apiKey });
  if (id === "xai") return createResponsesAdapter({ id, apiKey, baseURL: "https://api.x.ai/v1" });
  if (id === "anthropic") return createAnthropicAdapter({ apiKey });
  if (id === "groq") return createGroqAdapter({ apiKey });
  return createGeminiAdapter({ apiKey });
}

export function providerCatalog() {
  return AI_PROVIDERS.map((id) => ({
    id,
    label: PROVIDER_LABEL[id],
    keyEnv: KEY_ENV[id],
    configured: getAdapter(id).isConfigured(),
    defaultModel: defaultModel(id),
    suggestedModels: suggestedModels(id),
  }));
}
