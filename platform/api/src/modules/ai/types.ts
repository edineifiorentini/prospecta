/**
 * Contrato comum aos provedores de IA. Nenhum outro provedor ou intermediário é aceito.
 * Groq incluída em 30/10/2026 a pedido do cliente (exceção explícita à regra dos quatro provedores).
 */
export const AI_PROVIDERS = ["openai", "anthropic", "xai", "gemini", "groq"] as const;
export type AiProviderId = (typeof AI_PROVIDERS)[number];

export const PROVIDER_LABEL: Record<AiProviderId, string> = { openai: "OpenAI", anthropic: "Claude (Anthropic)", xai: "Grok (xAI)", gemini: "Gemini (Google)", groq: "Groq" };

export type TokenUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  totalTokens: number | null;
  /** tokens cobrados como saída, segundo a regra do provedor (inclui raciocínio quando ele é cobrado à parte) */
  billableOutputTokens: number | null;
  /** custo informado pelo próprio provedor na resposta, quando ele informa */
  providerCostUsd: number | null;
};

export type StructuredRequest = {
  model: string;
  system: string;
  user: string;
  schemaName: string;
  /** JSON Schema compatível com todos os provedores (todos os campos obrigatórios, sem campos extras) */
  schema: Record<string, unknown>;
  maxOutputTokens: number;
  signal: AbortSignal;
  timeoutMs: number;
};

export type StructuredResponse = {
  /** texto JSON devolvido pelo modelo (ainda não validado) */
  text: string;
  /** modelo que efetivamente respondeu, como informado pelo provedor */
  modelUsed: string;
  usage: TokenUsage;
  requestId: string | null;
  /** observações do provedor (ex.: troca de modelo por recusa) */
  notes: string[];
};

export interface AiProviderAdapter {
  readonly id: AiProviderId;
  isConfigured(): boolean;
  /** lista de modelos da conta (sem custo de tokens): serve de teste de conexão */
  listModels(signal: AbortSignal): Promise<string[]>;
  generateStructured(req: StructuredRequest): Promise<StructuredResponse>;
}
