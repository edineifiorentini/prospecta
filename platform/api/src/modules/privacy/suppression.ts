import { prisma } from "../../lib/prisma.ts";

/** Canal da lista de bloqueio que impede coletar de novo um e-mail/telefone excluído a pedido do titular. */
export const COLLECTION_CHANNEL = "COLLECTION";

/** Valores normalizados (E.164 ou e-mail em minúsculas) que não podem voltar a ser coletados. */
export async function blockedForCollection(organizationId: string, values: string[]): Promise<Set<string>> {
  if (!values.length) return new Set();
  const rows = await prisma.suppressionEntry.findMany({ where: { organizationId, channel: COLLECTION_CHANNEL, value: { in: values } }, select: { value: true } });
  return new Set(rows.map((r) => r.value));
}
