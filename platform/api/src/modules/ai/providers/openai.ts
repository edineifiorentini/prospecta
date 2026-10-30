import OpenAI from "openai";
import { AiError, toAiError } from "../errors.ts";
import type { AiProviderAdapter, AiProviderId, StructuredRequest, StructuredResponse } from "../types.ts";

/**
 * OpenAI e xAI pela Responses API (POST /v1/responses) com saída estruturada em
 * text.format = json_schema (strict). A xAI documenta o SDK oficial da OpenAI apontado para
 * https://api.x.ai/v1; por isso os dois provedores compartilham este adaptador.
 */
type Options = { id: Extract<AiProviderId, "openai" | "xai">; apiKey: string; baseURL?: string; fetch?: typeof fetch };

type XaiUsage = { cost_in_nano_usd?: number };

export function createResponsesAdapter(opts: Options): AiProviderAdapter {
  const client = (timeoutMs = 30_000) => new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL, maxRetries: 0, timeout: timeoutMs, fetch: opts.fetch });
  return {
    id: opts.id,
    isConfigured: () => !!opts.apiKey,
    async listModels(signal) {
      if (!opts.apiKey) throw new AiError("NOT_CONFIGURED", opts.id);
      try {
        const ids: string[] = [];
        for await (const m of client().models.list({ signal })) ids.push(m.id);
        return ids.sort();
      } catch (err) {
        throw toAiError(err, opts.id, signal);
      }
    },
    async generateStructured(req: StructuredRequest): Promise<StructuredResponse> {
      if (!opts.apiKey) throw new AiError("NOT_CONFIGURED", opts.id);
      try {
        const r = await client(req.timeoutMs).responses.create(
          {
            model: req.model,
            // instruções como mensagem de sistema: formato aceito pela OpenAI e pela xAI
            input: [
              { role: "system", content: req.system },
              { role: "user", content: req.user },
            ],
            max_output_tokens: req.maxOutputTokens,
            // não guarda a conversa no provedor: os dados da empresa não precisam ficar lá
            store: false,
            text: { format: { type: "json_schema", name: req.schemaName, schema: req.schema, strict: true } },
          },
          { signal: req.signal },
        );
        if (r.status === "incomplete") throw new AiError(r.incomplete_details?.reason === "max_output_tokens" ? "TRUNCATED" : "PROVIDER_ERROR", opts.id, r.incomplete_details?.reason ?? null);
        const refusal = r.output.flatMap((o) => (o.type === "message" ? o.content : [])).find((c) => c.type === "refusal");
        if (refusal && "refusal" in refusal) throw new AiError("REFUSED", opts.id, String(refusal.refusal).slice(0, 300));
        const u = r.usage;
        const xai = u as unknown as XaiUsage | undefined;
        // a xAI informa o custo da chamada; só usamos a unidade inequívoca (nano-dólares)
        const providerCostUsd = typeof xai?.cost_in_nano_usd === "number" ? xai.cost_in_nano_usd / 1e9 : null;
        return {
          text: r.output_text,
          modelUsed: r.model,
          usage: {
            inputTokens: u?.input_tokens ?? null,
            outputTokens: u?.output_tokens ?? null,
            reasoningTokens: u?.output_tokens_details?.reasoning_tokens ?? null,
            totalTokens: u?.total_tokens ?? null,
            // na Responses API o raciocínio já está dentro de output_tokens
            billableOutputTokens: u?.output_tokens ?? null,
            providerCostUsd: opts.id === "xai" ? providerCostUsd : null,
          },
          requestId: r.id ?? null,
          notes: [],
        };
      } catch (err) {
        throw toAiError(err, opts.id, req.signal);
      }
    },
  };
}
