import { prisma, type MessagingAccount } from "../../lib/prisma.ts";
import { logger } from "../../lib/logger.ts";
import { normalizePhone } from "../../lib/normalize.ts";
import { readOrgSettings } from "../orgs/settings.ts";
import { setAccountStatus } from "./accounts.ts";
import { isOptOut } from "./policy.ts";
import type { InboundEvent } from "./provider.ts";

const ORDER = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 } as Record<string, number>;

/** Associa o número ao lead do CRM (contato telefone/WhatsApp com o mesmo E.164). */
async function findCompanyByPhone(organizationId: string, e164: string) {
  const contact = await prisma.contact.findFirst({
    where: { organizationId, normalizedValue: e164, type: { in: ["PHONE", "WHATSAPP"] }, company: { status: "ACTIVE" } },
    orderBy: { collectedAt: "desc" },
    select: { companyId: true },
  });
  return contact?.companyId ?? null;
}

export async function ensureConversation(account: MessagingAccount, chatId: string, phone: string, contactName?: string | null) {
  const existing = await prisma.conversation.findUnique({ where: { messagingAccountId_externalChatId: { messagingAccountId: account.id, externalChatId: chatId } } });
  if (existing) {
    if (contactName && !existing.contactName) await prisma.conversation.update({ where: { id: existing.id }, data: { contactName } });
    return existing;
  }
  const companyId = await findCompanyByPhone(account.organizationId, phone);
  return prisma.conversation.create({ data: { organizationId: account.organizationId, messagingAccountId: account.id, companyId, externalChatId: chatId, contactPhone: phone, contactName: contactName ?? null } });
}

export async function handleInboundEvents(account: MessagingAccount, events: InboundEvent[]) {
  for (const ev of events) {
    if (ev.kind === "status") {
      await setAccountStatus(account.id, ev.status, { phoneJid: ev.jid ?? undefined, lastError: ev.status === "ERROR" || ev.status === "LOGGED_OUT" || ev.status === "DISCONNECTED" ? (ev.detail ?? null) : null });
      continue;
    }
    if (ev.kind === "qr" || ev.kind === "ignored") continue;

    if (ev.kind === "receipt") {
      const messages = await prisma.message.findMany({ where: { externalId: { in: ev.externalIds }, conversation: { messagingAccountId: account.id } }, select: { id: true, status: true } });
      for (const m of messages) {
        if ((ORDER[m.status] ?? -1) >= (ORDER[ev.state] ?? 0)) continue; // nunca rebaixa o status
        await prisma.message.update({ where: { id: m.id }, data: { status: ev.state, ...(ev.state === "DELIVERED" ? { deliveredAt: ev.timestamp } : { readAt: ev.timestamp }) } });
      }
      continue;
    }

    // mensagem
    if (ev.isGroup) continue; // grupos não fazem parte do CRM
    const phone = normalizePhone(ev.phone)?.e164 ?? ev.phone;
    const conv = await ensureConversation(account, ev.chatId, phone, ev.fromMe ? null : ev.pushName);
    if (ev.fromMe) {
      // enviada pelo próprio celular (ou eco do nosso envio): registra sem duplicar
      await prisma.message.upsert({
        where: { conversationId_externalId: { conversationId: conv.id, externalId: ev.externalId } },
        create: { organizationId: account.organizationId, conversationId: conv.id, direction: "OUTBOUND", externalId: ev.externalId, body: ev.text, type: ev.type, status: "SENT", sentAt: ev.timestamp },
        update: {},
      });
      await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: ev.timestamp } });
      continue;
    }

    const created = await prisma.message
      .create({ data: { organizationId: account.organizationId, conversationId: conv.id, direction: "INBOUND", externalId: ev.externalId, body: ev.text, type: ev.type, status: "RECEIVED", createdAt: ev.timestamp } })
      .catch((err: { code?: string }) => (err.code === "P2002" ? null : Promise.reject(err)));
    if (!created) continue; // evento repetido
    await prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: ev.timestamp, lastInboundAt: ev.timestamp, unreadCount: { increment: 1 }, status: "OPEN" } });
    if (conv.companyId) {
      await prisma.activity.create({ data: { organizationId: account.organizationId, companyId: conv.companyId, type: "WHATSAPP", title: "Mensagem recebida no WhatsApp", body: ev.text.slice(0, 280), metadata: { conversationId: conv.id, messageId: created.id } } });
    }

    // pedido de interrupção → bloqueio imediato + revogação registrada
    const settings = readOrgSettings((await prisma.organization.findUnique({ where: { id: account.organizationId }, select: { settings: true } }))?.settings).messaging;
    if (isOptOut(ev.text, settings.optOutKeywords)) {
      await prisma.$transaction([
        prisma.suppressionEntry.upsert({
          where: { organizationId_channel_value: { organizationId: account.organizationId, channel: "WHATSAPP", value: phone } },
          create: { organizationId: account.organizationId, channel: "WHATSAPP", value: phone, reason: "OPT_OUT", source: `Mensagem recebida: "${ev.text.slice(0, 60)}"` },
          update: {},
        }),
        prisma.contactConsent.create({
          data: { organizationId: account.organizationId, companyId: conv.companyId, channel: "WHATSAPP", contactValue: phone, status: "REVOKED", legalBasis: "CONSENT", source: "Opt-out por mensagem", evidence: ev.text.slice(0, 500), revokedAt: ev.timestamp },
        }),
        prisma.conversation.update({ where: { id: conv.id }, data: { status: "OPTED_OUT" } }),
        prisma.auditLog.create({ data: { organizationId: account.organizationId, action: "messaging.opt_out", entityType: "conversation", entityId: conv.id, metadata: { keywordMatched: true } } }),
        ...(conv.companyId ? [prisma.activity.create({ data: { organizationId: account.organizationId, companyId: conv.companyId, type: "CONSENT", title: "Contato pediu para não receber mensagens", body: "Número adicionado à lista de bloqueio automaticamente.", metadata: { conversationId: conv.id } } })] : []),
      ]);
      logger.info({ conversationId: conv.id }, "opt-out registrado");
    }
  }
}
