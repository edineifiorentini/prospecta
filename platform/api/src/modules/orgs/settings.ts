import { z } from "zod";

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
});

export type OrgSettings = z.infer<typeof orgSettingsSchema>;

export const defaultOrgSettings = (): OrgSettings => orgSettingsSchema.parse({});

export function readOrgSettings(raw: unknown): OrgSettings {
  const parsed = orgSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : defaultOrgSettings();
}
