import { prisma } from "../../lib/prisma.ts";
import { decryptSecret, encryptSecret } from "../../lib/crypto.ts";
import { logger } from "../../lib/logger.ts";
import { getAdapter, type AdapterLookup } from "./registry.ts";
import { AI_PROVIDERS, type AiProviderId } from "./types.ts";

/**
 * Chaves de IA por conta (BYOK). Regras:
 * - cifradas com AES-256-GCM (encryptSecret / APP_ENCRYPTION_KEY) e decifradas só em memória, na hora do uso;
 * - toda consulta filtra pela conta da sessão: uma conta nunca usa nem enxerga a chave de outra;
 * - a chave nunca volta ao navegador nem vai para registros ou auditoria (só os 4 últimos caracteres).
 */

export const keyHint = (apiKey: string) => apiKey.slice(-4);

/** Adaptadores montados com as chaves da própria conta. */
export async function adaptersFor(organizationId: string): Promise<AdapterLookup> {
  const rows = await prisma.aiCredential.findMany({ where: { organizationId }, select: { provider: true, encryptedKey: true } });
  const encrypted = new Map(rows.map((r) => [r.provider, r.encryptedKey]));
  return (id) => {
    const payload = encrypted.get(id);
    if (!payload) return getAdapter(id);
    try {
      return getAdapter(id, decryptSecret(payload));
    } catch {
      // APP_ENCRYPTION_KEY trocada ou dado corrompido: trata como sem chave, sem derrubar a tela
      logger.warn({ organizationId, provider: id }, "chave de IA não pôde ser decifrada; cadastre de novo");
      return getAdapter(id);
    }
  };
}

export type CredentialStatus = { hasKey: boolean; keyHint: string | null; updatedAt: Date | null };

export async function credentialStatus(organizationId: string): Promise<Record<AiProviderId, CredentialStatus>> {
  const rows = await prisma.aiCredential.findMany({ where: { organizationId }, select: { provider: true, keyHint: true, updatedAt: true } });
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return Object.fromEntries(
    AI_PROVIDERS.map((id) => {
      const r = byProvider.get(id);
      return [id, { hasKey: !!r, keyHint: r?.keyHint ?? null, updatedAt: r?.updatedAt ?? null }];
    }),
  ) as Record<AiProviderId, CredentialStatus>;
}

export async function saveCredential(input: { organizationId: string; provider: AiProviderId; apiKey: string; userId: string }) {
  const data = { encryptedKey: encryptSecret(input.apiKey), keyHint: keyHint(input.apiKey), updatedById: input.userId };
  return prisma.aiCredential.upsert({
    where: { organizationId_provider: { organizationId: input.organizationId, provider: input.provider } },
    create: { organizationId: input.organizationId, provider: input.provider, createdById: input.userId, ...data },
    update: data,
    select: { provider: true, keyHint: true, updatedAt: true },
  });
}

export async function deleteCredential(organizationId: string, provider: AiProviderId) {
  const r = await prisma.aiCredential.deleteMany({ where: { organizationId, provider } });
  return r.count > 0;
}
