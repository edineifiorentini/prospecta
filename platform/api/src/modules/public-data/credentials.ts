import { decryptSecret, encryptSecret } from "../../lib/crypto.ts";
import { logger } from "../../lib/logger.ts";
import { prisma } from "../../lib/prisma.ts";
import { keyHint } from "../ai/credentials.ts";

/** Fontes públicas que pedem chave/token gratuito: cada conta cadastra a sua, cifrada no banco (como as chaves de IA). */
export const KEYED_SOURCES = ["transparencia", "pagespeed"] as const;
export type KeyedSource = (typeof KEYED_SOURCES)[number];

export async function sourceKeyStatus(organizationId: string, source: KeyedSource) {
  const row = await prisma.aiCredential.findUnique({ where: { organizationId_provider: { organizationId, provider: source } }, select: { keyHint: true, updatedAt: true } });
  return { hasKey: !!row, keyHint: row?.keyHint ?? null, updatedAt: row?.updatedAt ?? null };
}

/** chave decifrada, só para o cabeçalho da requisição; "" quando não há */
export async function sourceKey(organizationId: string, source: KeyedSource): Promise<string> {
  const row = await prisma.aiCredential.findUnique({ where: { organizationId_provider: { organizationId, provider: source } }, select: { encryptedKey: true } });
  if (!row) return "";
  try {
    return decryptSecret(row.encryptedKey);
  } catch {
    logger.warn({ organizationId, source }, "chave da fonte pública não pôde ser decifrada; cadastre de novo");
    return "";
  }
}

export async function saveSourceKey(organizationId: string, source: KeyedSource, apiKey: string, userId: string) {
  const data = { encryptedKey: encryptSecret(apiKey), keyHint: keyHint(apiKey), updatedById: userId };
  await prisma.aiCredential.upsert({ where: { organizationId_provider: { organizationId, provider: source } }, create: { organizationId, provider: source, createdById: userId, ...data }, update: data });
  return { keyHint: data.keyHint };
}

export async function deleteSourceKey(organizationId: string, source: KeyedSource) {
  return prisma.aiCredential.deleteMany({ where: { organizationId, provider: source } });
}
