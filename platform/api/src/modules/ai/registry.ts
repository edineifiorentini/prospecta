import { isTest } from "../../config/env.ts";
import { PRICING } from "./pricing.ts";
import { createAnthropicAdapter } from "./providers/anthropic.ts";
import { createGeminiAdapter } from "./providers/gemini.ts";
import { createGroqAdapter } from "./providers/groq.ts";
import { createResponsesAdapter } from "./providers/openai.ts";
import { AI_PROVIDERS, PROVIDER_LABEL, type AiProviderAdapter, type AiProviderId } from "./types.ts";

/**
 * As chaves são de cada conta (tabela ai_credentials, cifradas): ver credentials.ts.
 * O servidor não tem chave própria; sem chave cadastrada, o provedor fica desligado para a conta.
 */

/** Modelos padrão conferidos na documentação oficial em 29–30/10/2026 (cada conta pode trocar na tela). */
export const DEFAULT_MODELS: Record<AiProviderId, string> = { openai: "gpt-6.1-sol", anthropic: "claude-opus-5-5", xai: "grok-4.7", gemini: "gemini-3.8-flash", groq: "openai/gpt-oss-120b" };

export const defaultModel = (id: AiProviderId) => DEFAULT_MODELS[id];

/** Modelos sugeridos na tela: os de preço confirmado. A lista real vem do teste de conexão. */
export const suggestedModels = (id: AiProviderId) => [...new Set([defaultModel(id), ...Object.keys(PRICING[id])])];

/** Em testes: um adaptador fixo (sempre configurado) ou uma fábrica que recebe a chave da conta. */
type Override = AiProviderAdapter | ((apiKey: string) => AiProviderAdapter);
const overrides = new Map<AiProviderId, Override>();

/** Somente testes: troca um provedor por um falso, sem rede. */
export function setAdapterForTests(id: AiProviderId, adapter: Override | null) {
  if (!isTest) throw new Error("setAdapterForTests só pode ser usado em testes");
  if (adapter) overrides.set(id, adapter);
  else overrides.delete(id);
}

/** Adaptador do provedor com a chave informada (vazia = não configurado, nada é chamado). */
export function getAdapter(id: AiProviderId, apiKey = ""): AiProviderAdapter {
  const o = overrides.get(id);
  if (o) return typeof o === "function" ? o(apiKey) : o;
  if (id === "openai") return createResponsesAdapter({ id, apiKey });
  if (id === "xai") return createResponsesAdapter({ id, apiKey, baseURL: "https://api.x.ai/v1" });
  if (id === "anthropic") return createAnthropicAdapter({ apiKey });
  if (id === "groq") return createGroqAdapter({ apiKey });
  return createGeminiAdapter({ apiKey });
}

export type AdapterLookup = (id: AiProviderId) => AiProviderAdapter;

export function providerCatalog(get: AdapterLookup) {
  return AI_PROVIDERS.map((id) => ({
    id,
    label: PROVIDER_LABEL[id],
    configured: get(id).isConfigured(),
    defaultModel: defaultModel(id),
    suggestedModels: suggestedModels(id),
  }));
}
