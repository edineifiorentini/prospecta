import type { FastifyRequest } from "fastify";
import { prisma } from "./prisma.ts";
import { logger } from "./logger.ts";

type AuditInput = {
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  organizationId?: string | null;
  userId?: string | null;
};

/** Registra uma trilha de auditoria. Falhas aqui nunca derrubam a operação principal. */
export async function writeAudit(req: FastifyRequest | null, input: AuditInput) {
  try {
    await prisma.auditLog.create({
      data: {
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: (input.metadata ?? {}) as object,
        organizationId: input.organizationId ?? req?.auth?.organizationId ?? null,
        userId: input.userId ?? req?.auth?.userId ?? null,
        ip: req?.ip ?? null,
        userAgent: req?.headers["user-agent"]?.slice(0, 300) ?? null,
      },
    });
  } catch (err) {
    logger.error({ err, action: input.action }, "falha ao gravar audit log");
  }
}
