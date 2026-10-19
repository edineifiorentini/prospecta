import { prisma, type MessagingAccount } from "../../lib/prisma.ts";
import { decryptSecret } from "../../lib/crypto.ts";
import { cloudApiProvider } from "./cloud-api.ts";
import type { MessagingProvider, ProviderAccount } from "./provider.ts";
import { wuzapiProvider } from "./wuzapi.ts";

export const providerFor = (kind: string): MessagingProvider => (kind === "WHATSAPP_CLOUD" ? cloudApiProvider : wuzapiProvider);

/** Converte o registro do banco (segredos cifrados) para o formato do adaptador. Nunca expor fora do servidor. */
export function toProviderAccount(a: MessagingAccount): ProviderAccount {
  return {
    id: a.id,
    externalUserId: a.externalUserId,
    token: a.tokenEncrypted ? decryptSecret(a.tokenEncrypted) : null,
    hmacKey: a.hmacKeyEncrypted ? decryptSecret(a.hmacKeyEncrypted) : null,
    settings: (a.settings ?? {}) as Record<string, unknown>,
  };
}

/** Representação segura para a API (sem tokens/HMAC). */
export const publicAccount = (a: MessagingAccount) => ({
  id: a.id,
  provider: a.provider,
  name: a.name,
  status: a.status,
  phoneJid: a.phoneJid,
  lastError: a.lastError,
  lastStatusAt: a.lastStatusAt,
  createdAt: a.createdAt,
  hasToken: !!a.tokenEncrypted,
  hasHmac: !!a.hmacKeyEncrypted,
});

export async function setAccountStatus(id: string, status: MessagingAccount["status"], extra: { phoneJid?: string | null; lastError?: string | null } = {}) {
  const prev = await prisma.messagingAccount.findUnique({ where: { id }, select: { status: true, organizationId: true } });
  await prisma.messagingAccount.update({ where: { id }, data: { status, lastStatusAt: new Date(), ...(extra.phoneJid !== undefined ? { phoneJid: extra.phoneJid } : {}), ...(extra.lastError !== undefined ? { lastError: extra.lastError } : {}) } });
  if (prev && prev.status !== status && (status === "DISCONNECTED" || status === "LOGGED_OUT" || status === "ERROR" || status === "CONNECTED")) {
    await prisma.auditLog.create({ data: { organizationId: prev.organizationId, action: `messaging.status_${status.toLowerCase()}`, entityType: "messaging_account", entityId: id, metadata: { from: prev.status, to: status, detail: extra.lastError ?? null } } });
  }
}
