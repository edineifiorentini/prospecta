import OpenAI from "openai";
import { AiError, toAiError } from "../errors.ts";
import type { AiProviderAdapter, StructuredRequest, StructuredResponse } from "../types.ts";

/**
 * Groq pela Chat Completions compatível com a OpenAI (https://api.groq.com/openai/v1), com
 * response_format = json_schema strict. A Responses API da Groq ainda é beta e não aceita `store`;
 * por isso este adaptador usa o endpoint de chat. Saída estruturada estrita só nos modelos listados
 * em https://console.groq.com/docs/structured-outputs (ex.: openai/gpt-oss-120b).
 */
type Options = { apiKey: string; fetch?: typeof fetch };

type GroqUsage = { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };

export function createGroqAdapter(opts: Options): AiProviderAdapter {
  const client = (timeoutMs = 30_000) => new OpenAI({ apiKey: opts.apiKey, baseURL: "https://api.groq.com/openai/v1", maxRetries: 0, timeout: timeoutMs, fetch: opts.fetch });
  return {
    id: "groq",
    isConfigured: () => !!opts.apiKey,
    async listModels(signal) {
      if (!opts.apiKey) throw new AiError("NOT_CONFIGURED", "groq");
      try {
        const ids: string[] = [];
        for await (const m of client().models.list({ signal })) ids.push(m.id);
        return ids.sort();
      } catch (err) {
        throw toAiError(err, "groq", signal);
      }
    },
    async generateStructured(req: StructuredRequest): Promise<StructuredResponse> {
      if (!opts.apiKey) throw new AiError("NOT_CONFIGURED", "groq");
      try {
        const r = await client(req.timeoutMs).chat.completions.create(
          {
            model: req.model,
            messages: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
            max_completion_tokens: req.maxOutputTokens,
            response_format: { type: "json_schema", json_schema: { name: req.schemaName, schema: req.schema, strict: true } },
          },
          { signal: req.signal },
        );
        const choice = r.choices[0];
        if (!choice) throw new AiError("PROVIDER_ERROR", "groq", "Resposta sem conteúdo.");
        if (choice.finish_reason === "length") throw new AiError("TRUNCATED", "groq");
        if (choice.message.refusal) throw new AiError("REFUSED", "groq", String(choice.message.refusal).slice(0, 300));
        const u = r.usage as GroqUsage | undefined;
        return {
          text: choice.message.content ?? "",
          modelUsed: r.model,
          usage: {
            inputTokens: u?.prompt_tokens ?? null,
            outputTokens: u?.completion_tokens ?? null,
            reasoningTokens: u?.completion_tokens_details?.reasoning_tokens ?? null,
            totalTokens: u?.total_tokens ?? null,
            // completion_tokens já inclui o raciocínio dos modelos gpt-oss
            billableOutputTokens: u?.completion_tokens ?? null,
            providerCostUsd: null,
          },
          requestId: r.id ?? null,
          notes: [],
        };
      } catch (err) {
        throw toAiError(err, "groq", req.signal);
      }
    },
  };
}
