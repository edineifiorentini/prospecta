import { prisma } from "../../lib/prisma.ts";
import { fold } from "../../lib/normalize.ts";
import { readOrgSettings } from "../orgs/settings.ts";

export const CUSTOMER_WINDOW_MS = 24 * 3600 * 1000;

export type SendDecision =
  | { allowed: true; basis: "CONSENT" | "CUSTOMER_INITIATED"; requiresApproval: boolean; detail: string }
  | { allowed: false; reason: "SUPPRESSED" | "REVOKED" | "NO_CONSENT" | "RATE_LIMIT" | "NO_ACCOUNT"; detail: string };

/**
 * Regras para mensagens no WhatsApp (sem disparos em massa):
 *  1. número na lista de bloqueio/opt-out → bloqueado;
 *  2. consentimento mais recente REVOGADO → bloqueado;
 *  3. contato escreveu nas últimas 24 h → resposta permitida (iniciada pelo cliente);
 *  4. consentimento GRANTED registrado (fonte, data, evidência) → permitido, com aprovação de gestor se configurado;
 *  5. caso contrário → bloqueado: número público não é autorização.
 *  Limites por hora/dia valem para mensagens iniciadas pela empresa.
 */
export async function decideSend(organizationId: string, phoneE164: string, opts: { lastInboundAt?: Date | null; accountId?: string } = {}): Promise<SendDecision> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
  const settings = readOrgSettings(org.settings).messaging;

  const suppressed = await prisma.suppressionEntry.findUnique({ where: { organizationId_channel_value: { organizationId, channel: "WHATSAPP", value: phoneE164 } } });
  if (suppressed) return { allowed: false, reason: "SUPPRESSED", detail: `Número na lista de bloqueio (${suppressed.reason}) desde ${suppressed.createdAt.toLocaleDateString("pt-BR")}.` };

  const consent = await prisma.contactConsent.findFirst({ where: { organizationId, channel: "WHATSAPP", contactValue: phoneE164 }, orderBy: { createdAt: "desc" } });
  if (consent?.status === "REVOKED") return { allowed: false, reason: "REVOKED", detail: `Consentimento revogado em ${consent.revokedAt?.toLocaleDateString("pt-BR") ?? "data não registrada"}.` };

  const customerInitiated = !!opts.lastInboundAt && Date.now() - opts.lastInboundAt.getTime() < CUSTOMER_WINDOW_MS;
  if (customerInitiated) return { allowed: true, basis: "CUSTOMER_INITIATED", requiresApproval: false, detail: "Resposta a mensagem recebida nas últimas 24 h." };

  if (consent?.status !== "GRANTED") {
    return { allowed: false, reason: "NO_CONSENT", detail: "Sem consentimento registrado para WhatsApp. Um número público não autoriza o contato: registre a autorização (fonte, data e evidência) antes." };
  }

  if (opts.accountId) {
    const hourAgo = new Date(Date.now() - 3600 * 1000);
    const dayAgo = new Date(Date.now() - 24 * 3600 * 1000);
    const base = { organizationId, direction: "OUTBOUND" as const, status: { in: ["QUEUED", "SENT", "DELIVERED", "READ"] as ("QUEUED" | "SENT" | "DELIVERED" | "READ")[] }, conversation: { messagingAccountId: opts.accountId } };
    const [hour, day] = await Promise.all([prisma.message.count({ where: { ...base, createdAt: { gte: hourAgo } } }), prisma.message.count({ where: { ...base, createdAt: { gte: dayAgo } } })]);
    if (hour >= settings.maxOutboundPerHour) return { allowed: false, reason: "RATE_LIMIT", detail: `Limite de ${settings.maxOutboundPerHour} mensagens por hora atingido.` };
    if (day >= settings.maxOutboundPerDay) return { allowed: false, reason: "RATE_LIMIT", detail: `Limite de ${settings.maxOutboundPerDay} mensagens por dia atingido.` };
  }
  return { allowed: true, basis: "CONSENT", requiresApproval: settings.requireApproval, detail: `Consentimento registrado em ${consent.grantedAt?.toLocaleDateString("pt-BR") ?? consent.createdAt.toLocaleDateString("pt-BR")} (${consent.source}).` };
}

/** Detecta pedido de interrupção numa mensagem recebida (palavras configuráveis). */
export function isOptOut(text: string, keywords: string[]): boolean {
  const t = fold(text);
  if (!t || t.length > 120) return false; // mensagens longas raramente são opt-out puro
  return keywords.some((k) => {
    const kw = fold(k);
    return kw && (t === kw || t.startsWith(`${kw} `) || t.endsWith(` ${kw}`) || t.includes(` ${kw} `));
  });
}

/** Substitui variáveis {{contato}}, {{empresa}}, {{usuario}}, {{organizacao}} do modelo. */
export function renderTemplate(body: string, vars: Record<string, string | null | undefined>) {
  return body.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "");
}
