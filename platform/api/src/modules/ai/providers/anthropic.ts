import Anthropic from "@anthropic-ai/sdk";
import { AiError, toAiError } from "../errors.ts";
import type { AiProviderAdapter, StructuredRequest, StructuredResponse } from "../types.ts";

/**
 * Claude pela Messages API com saída estruturada (output_config.format = json_schema).
 * Nos modelos que aceitam, liga o fallback do próprio servidor da Anthropic para recusas
 * (fallbacks: "default"): continua sendo a Anthropic, e o modelo que respondeu fica registrado.
 */
const SERVER_FALLBACK_MODELS = new Set(["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"]);

type Options = { apiKey: string; fetch?: typeof fetch };

export function createAnthropicAdapter(opts: Options): AiProviderAdapter {
  const client = (timeoutMs = 30_000) => new Anthropic({ apiKey: opts.apiKey, maxRetries: 0, timeout: timeoutMs, fetch: opts.fetch });
  return {
    id: "anthropic",
    isConfigured: () => !!opts.apiKey,
    async listModels(signal) {
      if (!opts.apiKey) throw new AiError("NOT_CONFIGURED", "anthropic");
      try {
        const ids: string[] = [];
        for await (const m of client().models.list({}, { signal })) ids.push(m.id);
        return ids.sort();
      } catch (err) {
        throw toAiError(err, "anthropic", signal);
      }
    },
    async generateStructured(req: StructuredRequest): Promise<StructuredResponse> {
      if (!opts.apiKey) throw new AiError("NOT_CONFIGURED", "anthropic");
      const fallback = SERVER_FALLBACK_MODELS.has(req.model);
      try {
        const r = await client(req.timeoutMs).beta.messages.create(
          {
            model: req.model,
            max_tokens: req.maxOutputTokens,
            system: req.system,
            messages: [{ role: "user", content: req.user }],
            output_config: { effort: "medium", format: { type: "json_schema", schema: req.schema } },
            ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
          },
          { signal: req.signal },
        );
        if (r.stop_reason === "refusal") throw new AiError("REFUSED", "anthropic", r.stop_details?.explanation ?? null);
        if (r.stop_reason === "max_tokens") throw new AiError("TRUNCATED", "anthropic");
        const text = r.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
        const notes = r.model !== req.model ? [`A Anthropic respondeu com ${r.model} no lugar de ${req.model} (fallback do servidor após recusa).`] : [];
        return {
          text,
          modelUsed: r.model,
          usage: {
            inputTokens: r.usage.input_tokens + (r.usage.cache_read_input_tokens ?? 0) + (r.usage.cache_creation_input_tokens ?? 0),
            outputTokens: r.usage.output_tokens,
            reasoningTokens: null,
            totalTokens: r.usage.input_tokens + r.usage.output_tokens,
            // o raciocínio do Claude já é contado em output_tokens
            billableOutputTokens: r.usage.output_tokens,
            providerCostUsd: null,
          },
          requestId: r.id,
          notes,
        };
      } catch (err) {
        throw toAiError(err, "anthropic", req.signal);
      }
    },
  };
}
