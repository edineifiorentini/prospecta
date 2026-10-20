import type { Job } from "bullmq";
import { prisma } from "../../lib/prisma.ts";
import { logger } from "../../lib/logger.ts";
import type { MessagingJobData } from "../../queues/index.ts";
import { liveStatus, providerFor, setAccountStatus, toProviderAccount } from "./accounts.ts";
import { decideSend } from "./policy.ts";
import { ProviderError } from "./provider.ts";

/** Envia uma mensagem aprovada/autorizada. Revalida bloqueios antes do envio (opt-out pode ter chegado). */
export async function processSendMessage(job: Job<MessagingJobData>) {
  const msg = await prisma.message.findUnique({ where: { id: job.data.messageId }, include: { conversation: { include: { messagingAccount: true } } } });
  if (!msg || msg.status !== "QUEUED") return;
  const conv = msg.conversation;
  const account = conv.messagingAccount;

  const decision = await decideSend(msg.organizationId, conv.contactPhone, { lastInboundAt: conv.lastInboundAt });
  if (!decision.allowed) {
    await prisma.message.update({ where: { id: msg.id }, data: { status: "BLOCKED", error: decision.detail } });
    return;
  }
  try {
    const res = await providerFor(account.provider).sendText(toProviderAccount(account), conv.contactPhone, msg.body, msg.id);
    await prisma.$transaction([
      prisma.message.update({ where: { id: msg.id }, data: { status: "SENT", externalId: res.externalId, sentAt: res.sentAt, error: null } }),
      prisma.conversation.update({ where: { id: conv.id }, data: { lastMessageAt: res.sentAt } }),
      ...(conv.companyId
        ? [prisma.activity.create({ data: { organizationId: msg.organizationId, companyId: conv.companyId, userId: msg.sentById, type: "WHATSAPP" as const, title: "Mensagem enviada no WhatsApp", body: msg.body.slice(0, 280), metadata: { conversationId: conv.id, messageId: msg.id } } })]
        : []),
    ]);
  } catch (err) {
    const message = err instanceof ProviderError ? err.message : (err as Error).message;
    const last = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    logger.warn({ messageId: msg.id, attempt: job.attemptsMade + 1, err: message }, "falha ao enviar mensagem");
    if (err instanceof ProviderError && err.status === 401) await setAccountStatus(account.id, "ERROR", { lastError: "Token recusado pelo provedor." });
    await prisma.message.update({ where: { id: msg.id }, data: { error: message.slice(0, 500), ...(last ? { status: "FAILED" } : {}) } });
    if (!last) throw err; // BullMQ tenta de novo com espera exponencial
  }
}

/** Atualiza o estado das contas (detecta desconexões); não reconecta sozinho em loop. */
export async function refreshMessagingStatus() {
  const accounts = await prisma.messagingAccount.findMany({ where: { provider: "WUZAPI", tokenEncrypted: { not: null } } });
  for (const a of accounts) {
    try {
      const s = await liveStatus(a);
      if (s.status !== a.status) await setAccountStatus(a.id, s.status, { phoneJid: s.jid ?? a.phoneJid, lastError: s.status === "DISCONNECTED" && a.status === "CONNECTED" ? "Conexão perdida; use Reconectar." : undefined });
    } catch (err) {
      if (a.status !== "ERROR") await setAccountStatus(a.id, "ERROR", { lastError: (err as Error).message.slice(0, 200) });
    }
  }
}
