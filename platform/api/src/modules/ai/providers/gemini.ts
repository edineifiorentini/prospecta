import { GoogleGenAI } from "@google/genai";
import { AiError, toAiError } from "../errors.ts";
import type { AiProviderAdapter, StructuredRequest, StructuredResponse } from "../types.ts";

/**
 * Gemini pela Interactions API (recomendada pelo Google para integrações novas), com
 * response_format JSON + schema e store: false (a interação não fica guardada no Google).
 */
type Options = { apiKey: string };

export function createGeminiAdapter(opts: Options): AiProviderAdapter {
  const client = () => new GoogleGenAI({ apiKey: opts.apiKey });
  return {
    id: "gemini",
    isConfigured: () => !!opts.apiKey,
    async listModels(signal) {
      if (!opts.apiKey) throw new AiError("NOT_CONFIGURED", "gemini");
      try {
        const ids: string[] = [];
        const pager = await client().models.list({ config: { pageSize: 100, abortSignal: signal } });
        for await (const m of pager) if (m.name) ids.push(m.name.replace(/^models\//, ""));
        return ids.sort();
      } catch (err) {
        throw toAiError(err, "gemini", signal);
      }
    },
    async generateStructured(req: StructuredRequest): Promise<StructuredResponse> {
      if (!opts.apiKey) throw new AiError("NOT_CONFIGURED", "gemini");
      try {
        const r = await client().interactions.create(
          {
            model: req.model,
            system_instruction: req.system,
            input: req.user,
            store: false,
            response_format: { type: "text", mime_type: "application/json", schema: req.schema },
            generation_config: { max_output_tokens: req.maxOutputTokens },
          },
          { signal: req.signal, timeout: req.timeoutMs, maxRetries: 0 },
        );
        if (r.status === "incomplete") throw new AiError("TRUNCATED", "gemini");
        if (r.status === "failed" || r.status === "cancelled") throw new AiError("PROVIDER_ERROR", "gemini", r.status);
        const text = r.output_text ?? "";
        const u = r.usage;
        const input = u?.total_input_tokens ?? null;
        const output = u?.total_output_tokens ?? null;
        const thought = u?.total_thought_tokens ?? 0;
        // o Google cobra o raciocínio como saída; quando o total mostra que ele veio à parte, soma
        const thoughtSeparate = u?.total_tokens != null && input != null && output != null && u.total_tokens >= input + output + thought && thought > 0;
        return {
          text,
          modelUsed: typeof r.model === "string" ? r.model : req.model,
          usage: {
            inputTokens: input,
            outputTokens: output,
            reasoningTokens: u?.total_thought_tokens ?? null,
            totalTokens: u?.total_tokens ?? null,
            billableOutputTokens: output == null ? null : output + (thoughtSeparate ? thought : 0),
            providerCostUsd: null,
          },
          requestId: r.id ?? null,
          notes: [],
        };
      } catch (err) {
        throw toAiError(err, "gemini", req.signal);
      }
    },
  };
}
