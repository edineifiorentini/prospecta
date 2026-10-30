import { z } from "zod";
import { AI_PROVIDERS } from "../ai/types.ts";

const provider = z.enum(AI_PROVIDERS);

export const defaultAiSettings = {
  enabled: false,
  mode: "manual" as const,
  primaryProvider: null,
  fallbackProviders: [],
  autoPolicy: "priority" as const,
  models: {},
  offering: "um sistema de gestão de atendimento pelo WhatsApp para equipes: vários atendentes no mesmo número, distribuição de conversas e histórico compartilhado",
  maxCostUsdPerAnalysis: 0.2,
  allowUnknownCost: false,
  maxOutputTokens: 6000,
  timeoutSeconds: 90,
  maxRetries: 1,
  cacheDays: 30,
};

export const aiSettingsSchema = z
  .object({
    enabled: z.boolean(),
    /** manual: usa só o provedor escolhido; auto: pode usar as alternativas autorizadas, sempre com registro */
    mode: z.enum(["manual", "auto"]),
    primaryProvider: provider.nullable(),
    fallbackProviders: z.array(provider).max(AI_PROVIDERS.length - 1),
    autoPolicy: z.enum(["priority", "lowest_cost"]),
    models: z.partialRecord(provider, z.string().trim().min(1).max(80)),
    /** o que a conta vende (vai no prompt para personalizar a abordagem) */
    offering: z.string().trim().min(10).max(400),
    maxCostUsdPerAnalysis: z.number().min(0.001).max(5),
    /** permite modelos sem preço confirmado (custo desconhecido) */
    allowUnknownCost: z.boolean(),
    maxOutputTokens: z.number().int().min(1000).max(32000),
    timeoutSeconds: z.number().int().min(10).max(300),
    maxRetries: z.number().int().min(0).max(3),
    /** dias em que uma análise com os mesmos dados é reaproveitada sem nova chamada */
    cacheDays: z.number().int().min(0).max(90),
  })
  .refine((s) => !s.primaryProvider || !s.fallbackProviders.includes(s.primaryProvider), { message: "O provedor principal não pode estar entre as alternativas.", path: ["fallbackProviders"] });

export type AiSettings = z.infer<typeof aiSettingsSchema>;

/** Configurações da organização (JSON validado). Pesos de pontuação são editáveis. */
export const orgSettingsSchema = z.object({
  messaging: z
    .object({
      /** limite de mensagens iniciadas pela empresa por hora/dia, por conta */
      maxOutboundPerHour: z.number().int().min(1).max(500).default(20),
      maxOutboundPerDay: z.number().int().min(1).max(2000).default(100),
      /** toda mensagem iniciada pela empresa exige aprovação de um gestor */
      requireApproval: z.boolean().default(true),
      /** palavras que, numa mensagem recebida, registram opt-out automático */
      optOutKeywords: z.array(z.string()).default(["parar", "pare", "sair", "stop", "cancelar", "descadastrar", "não quero", "nao quero", "remover"]),
    })
    .default({ maxOutboundPerHour: 20, maxOutboundPerDay: 100, requireApproval: true, optOutKeywords: ["parar", "pare", "sair", "stop", "cancelar", "descadastrar", "não quero", "nao quero", "remover"] }),
  retention: z
    .object({
      /** dias para manter o registro bruto das fontes (raw_data) */
      rawDataDays: z.number().int().min(7).max(3650).default(180),
      /** dias para excluir definitivamente empresas arquivadas */
      archivedCompanyDays: z.number().int().min(30).max(3650).default(365),
      /** dias para manter eventos brutos de webhook */
      webhookEventDays: z.number().int().min(7).max(3650).default(90),
      /** dias para manter trilhas de auditoria */
      auditLogDays: z.number().int().min(180).max(3650).default(730),
    })
    .default({ rawDataDays: 180, archivedCompanyDays: 365, webhookEventDays: 90, auditLogDays: 730 }),
  scoring: z.record(z.string(), z.record(z.string(), z.number().min(0).max(100))).default({}),
  discovery: z
    .object({
      googleMapsEnabled: z.boolean().default(true),
      defaultCountry: z.string().default("Brasil"),
    })
    .default({ googleMapsEnabled: true, defaultCountry: "Brasil" }),
  /** inteligência comercial: segmentos-alvo, pesos e limites da prioridade (ver modules/intelligence/scoring.ts) */
  intelligence: z
    .object({
      targetSegments: z.array(z.string().max(40)).max(30).default(["imobiliaria", "contabilidade", "advocacia", "agencia_marketing"]),
      criteriaWeights: z.record(z.string(), z.number().min(0).max(100)).default({}),
      indicatorWeights: z.object({ FIT: z.number().min(0).max(100), OPPORTUNITY: z.number().min(0).max(100), RELIABILITY: z.number().min(0).max(100) }).default({ FIT: 45, OPPORTUNITY: 35, RELIABILITY: 20 }),
      thresholds: z
        .object({ a: z.number().min(1).max(100), b: z.number().min(1).max(100), minReliability: z.number().min(0).max(100), minCoverage: z.number().min(0.1).max(1) })
        .default({ a: 70, b: 50, minReliability: 40, minCoverage: 0.5 }),
    })
    .default({ targetSegments: ["imobiliaria", "contabilidade", "advocacia", "agencia_marketing"], criteriaWeights: {}, indicatorWeights: { FIT: 45, OPPORTUNITY: 35, RELIABILITY: 20 }, thresholds: { a: 70, b: 50, minReliability: 40, minCoverage: 0.5 } }),
  /** IA: desligada até um administrador ativar; as chaves ficam só no servidor */
  ai: aiSettingsSchema.default(defaultAiSettings),
});

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const defaultOrgSettings = (): OrgSettings => orgSettingsSchema.parse({});

export function readOrgSettings(raw: unknown): OrgSettings {
  const parsed = orgSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : defaultOrgSettings();
}
