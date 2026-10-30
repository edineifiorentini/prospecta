import { z } from "zod";
import { AiError } from "../../ai/errors.ts";

/** Versão do prompt e do contrato. Mudou o prompt? Suba a versão: o cache por hash deixa de valer. */
// 10.2: proíbe prometer condições do produto que não estejam na descrição da conta
export const PROMPT_VERSION = "ic-2026.10.2";

export const NEXT_ACTIONS = ["VERIFY_DECISION_MAKER", "QUALIFY_OPERATION", "REQUEST_CONVERSATION", "PRESENT_DEMO", "AWAIT_REPLY", "CLOSE_CONTACT"] as const;
export const CONFIDENCE_LEVELS = ["baixa", "media", "alta"] as const;

const evidenceId = z.string().regex(/^E\d{1,3}$/);
const level = z.enum(CONFIDENCE_LEVELS);

/** Contrato validado no servidor: igual para todos os provedores (OpenAI, Claude, Grok, Gemini e Groq). */
export const aiOutputSchema = z.object({
  summary: z.string().trim().min(20).max(1500),
  verifiedFacts: z.array(z.object({ fact: z.string().trim().min(3).max(400), evidenceIds: z.array(evidenceId).min(1).max(8) })).max(15),
  opportunityHypotheses: z
    .array(z.object({ hypothesis: z.string().trim().min(5).max(400), basis: z.string().trim().min(3).max(400), evidenceIds: z.array(evidenceId).max(8), confidence: level }))
    .min(1)
    .max(8),
  diagnosticQuestions: z.array(z.string().trim().min(5).max(300)).min(2).max(10),
  personalizedMessage: z.string().trim().min(40).max(1200),
  possibleObjections: z.array(z.object({ objection: z.string().trim().min(3).max(300), response: z.string().trim().min(5).max(600) })).max(8),
  recommendedNextAction: z.object({ action: z.enum(NEXT_ACTIONS), rationale: z.string().trim().min(5).max(500) }),
  confidence: level,
  limitations: z.array(z.string().trim().min(3).max(400)).max(10),
});

export type AiOutput = z.infer<typeof aiOutputSchema>;

// JSON Schema enviado aos provedores: só o subconjunto aceito pelos quatro (objetos fechados,
// todos os campos obrigatórios, enums e descrições). Limites de tamanho são conferidos pelo Zod acima.
const str = (description: string) => ({ type: "string", description });
const arr = (items: object, description: string) => ({ type: "array", items, description });
const obj = (properties: Record<string, object>, description?: string) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false, ...(description ? { description } : {}) });
const ids = arr({ type: "string", description: "Identificador de evidência, ex.: E3" }, "Evidências (E1, E2…) que sustentam o item");
const conf = { type: "string", enum: [...CONFIDENCE_LEVELS] };

export const AI_OUTPUT_JSON_SCHEMA: Record<string, unknown> = obj({
  summary: str("Resumo comercial objetivo da empresa e dos principais sinais (até 5 frases)"),
  verifiedFacts: arr(obj({ fact: str("Fato observado, sem interpretação"), evidenceIds: ids }), "Somente fatos presentes nas evidências"),
  opportunityHypotheses: arr(obj({ hypothesis: str("Possível dor ou necessidade, escrita como hipótese"), basis: str("Por que a hipótese faz sentido"), evidenceIds: ids, confidence: conf }), "Hipóteses a validar na conversa"),
  diagnosticQuestions: arr(str("Pergunta aberta de diagnóstico"), "Perguntas para confirmar se a necessidade existe"),
  personalizedMessage: str("Primeira mensagem de prospecção: curta, natural, consultiva, sem afirmações não verificadas"),
  possibleObjections: arr(obj({ objection: str("Objeção provável"), response: str("Resposta consultiva sugerida") }), "Objeções relevantes ao perfil"),
  recommendedNextAction: obj({ action: { type: "string", enum: [...NEXT_ACTIONS] }, rationale: str("Motivo da recomendação") }),
  confidence: conf,
  limitations: arr(str("O que não foi possível saber com os dados disponíveis"), "Limitações da análise"),
});

/** Faz o parse e valida a resposta do modelo. Erros de formato podem ser tentados de novo. */
export function parseAiOutput(text: string): AiOutput {
  let raw: unknown;
  try {
    raw = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ""));
  } catch {
    throw new AiError("INVALID_OUTPUT", null, "A resposta não é um JSON válido.");
  }
  const parsed = aiOutputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new AiError("INVALID_OUTPUT", null, parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return parsed.data;
}

const PHONE_LIKE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const EMAIL_LIKE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const URL_LIKE = /https?:\/\/|www\./i;

/**
 * Regras de precisão aplicadas DEPOIS da validação de formato:
 * - fato sem evidência existente é descartado (não vira "evidência verificada");
 * - referências a evidências inexistentes são removidas das hipóteses;
 * - mensagem com telefone, e-mail ou link (dados que o modelo nem recebeu) recebe alerta para revisão.
 */
export function enforceEvidence(out: AiOutput, knownIds: Set<string>): { output: AiOutput; warnings: string[] } {
  const warnings: string[] = [];
  const verifiedFacts = out.verifiedFacts
    .map((f) => ({ ...f, evidenceIds: f.evidenceIds.filter((id) => knownIds.has(id)) }))
    .filter((f) => f.evidenceIds.length > 0);
  const dropped = out.verifiedFacts.length - verifiedFacts.length;
  if (dropped) warnings.push(`${dropped} afirmação(ões) sem evidência válida foram retiradas dos fatos verificados.`);
  const opportunityHypotheses = out.opportunityHypotheses.map((h) => ({ ...h, evidenceIds: h.evidenceIds.filter((id) => knownIds.has(id)) }));
  const msg = out.personalizedMessage;
  if (PHONE_LIKE.test(msg) || EMAIL_LIKE.test(msg) || URL_LIKE.test(msg)) warnings.push("A mensagem cita telefone, e-mail ou link que não vieram dos dados enviados. Revise antes de usar.");
  return { output: { ...out, verifiedFacts, opportunityHypotheses }, warnings };
}
