import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import type { FastifyRequest } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.ts";
import { prisma } from "../../lib/prisma.ts";
import { conflict, forbidden, notFound } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import { sendMail } from "../../lib/mailer.ts";
import { orgId } from "../../plugins/auth.ts";
import { hashPassword } from "../auth/password.ts";
import { bootstrapOrganization } from "../orgs/bootstrap.ts";

/**
 * Contas de clientes: cada conta é uma organização separada, com dados próprios.
 * Só o administrador da plataforma cria contas, e ele vê apenas nome, responsável e contagens,
 * nunca o conteúdo (empresas, CRM, conversas) de outra conta.
 */

const INVITE_TTL_MS = 72 * 3600 * 1000;
const idParams = z.object({ id: z.uuid() });

function assertPlatformAdmin(req: FastifyRequest) {
  if (!req.auth?.isPlatformAdmin) throw forbidden("Somente o administrador da plataforma pode gerenciar contas.");
}

/** Link de uso único para o responsável definir a senha (invalida os links anteriores ainda não usados). */
async function issueInviteLink(userId: string, ip: string) {
  const token = randomToken(32);
  const now = new Date();
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({ where: { userId, usedAt: null }, data: { usedAt: now } }),
    prisma.passwordResetToken.create({ data: { userId, tokenHash: sha256(token), expiresAt: new Date(now.getTime() + INVITE_TTL_MS), ip } }),
  ]);
  return `${env.APP_BASE_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
}

export const platformRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/platform/accounts", { schema: { tags: ["platform"], summary: "Lista as contas (empresas) da plataforma, sem os dados delas" } }, async (req) => {
    assertPlatformAdmin(req);
    const orgs = await prisma.organization.findMany({
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        createdAt: true,
        memberships: { where: { role: "OWNER" }, orderBy: { createdAt: "asc" }, take: 1, select: { user: { select: { name: true, email: true, lastLoginAt: true, isActive: true } } } },
        _count: { select: { memberships: true, companies: true, searchJobs: true } },
      },
    });
    return orgs.map((o) => {
      const owner = o.memberships[0]?.user ?? null;
      return {
        id: o.id,
        name: o.name,
        createdAt: o.createdAt,
        isMine: o.id === orgId(req),
        owner,
        pendingInvite: !!owner && !owner.lastLoginAt,
        users: o._count.memberships,
        companies: o._count.companies,
        searches: o._count.searchJobs,
      };
    });
  });

  app.post(
    "/platform/accounts",
    {
      config: { rateLimit: { max: 20, timeWindow: "1 hour" } },
      schema: {
        tags: ["platform"],
        summary: "Cria uma conta separada (nova empresa) com o responsável como Proprietário",
        body: z.object({ organizationName: z.string().trim().min(2).max(120), name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email() }),
      },
    },
    async (req, reply) => {
      assertPlatformAdmin(req);
      const b = req.body;
      if (await prisma.user.findUnique({ where: { email: b.email } })) throw conflict("Este e-mail já tem acesso ao sistema. Use outro e-mail para a nova conta.");
      // senha aleatória inutilizável: o responsável define a dele pelo link
      const passwordHash = await hashPassword(randomToken(32));
      const { organization, user } = await prisma.$transaction(async (tx) => {
        const organization = await bootstrapOrganization(tx, b.organizationName);
        const user = await tx.user.create({ data: { email: b.email, name: b.name, passwordHash } });
        await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
        return { organization, user };
      });
      const link = await issueInviteLink(user.id, req.ip);
      const sent = await sendMail(
        user.email,
        `Sua conta ${organization.name} na Prospecta`,
        `Olá, ${user.name}.\n\nSua conta ${organization.name} foi criada na Prospecta. Defina sua senha pelo link abaixo (válido por 72 horas):\n\n${link}\n`,
      );
      await writeAudit(req, { action: "platform.account_created", entityType: "organization", entityId: organization.id, metadata: { ownerEmail: user.email, emailSent: sent } });
      await writeAudit(req, { action: "account.created", organizationId: organization.id, entityType: "organization", entityId: organization.id, metadata: { createdBy: req.auth!.email } });
      return reply.code(201).send({ organizationId: organization.id, userId: user.id, emailSent: sent, inviteLink: link });
    },
  );

  app.post(
    "/platform/accounts/:id/invite-link",
    { config: { rateLimit: { max: 20, timeWindow: "1 hour" } }, schema: { tags: ["platform"], summary: "Gera um novo link para o responsável que ainda não entrou na conta", params: idParams } },
    async (req) => {
      assertPlatformAdmin(req);
      const owner = await prisma.membership.findFirst({ where: { organizationId: req.params.id, role: "OWNER" }, orderBy: { createdAt: "asc" }, include: { user: true } });
      if (!owner) throw notFound("Conta não encontrada.");
      // conta já em uso: o administrador não pode trocar a senha de quem já entrou
      if (owner.user.lastLoginAt) throw conflict("O responsável já entrou na conta. Para recuperar o acesso, ele usa \"Esqueci minha senha\" na tela de login.");
      const link = await issueInviteLink(owner.userId, req.ip);
      await writeAudit(req, { action: "platform.invite_link", entityType: "organization", entityId: req.params.id, metadata: { ownerEmail: owner.user.email } });
      return { inviteLink: link };
    },
  );
};
