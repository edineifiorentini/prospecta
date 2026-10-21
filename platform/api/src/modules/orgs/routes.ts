import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../../config/env.ts";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { badRequest, conflict, forbidden, notFound } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { randomToken, sha256 } from "../../lib/crypto.ts";
import { sendMail } from "../../lib/mailer.ts";
import { pageResult, paginate } from "../../lib/pagination.ts";
import { orgId } from "../../plugins/auth.ts";
import { hashPassword } from "../auth/password.ts";
import { canAssignRole } from "../auth/rbac.ts";
import { orgSettingsSchema, readOrgSettings } from "./settings.ts";

const roleEnum = z.enum(["OWNER", "ADMIN", "MANAGER", "SALES", "VIEWER"]);

/** Mescla profunda simples para atualizar configurações parcialmente. */
function merge(base: Record<string, unknown>, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" ? merge(base[k] as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out;
}

export const orgRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/org", { schema: { tags: ["org"], summary: "Organização e configurações" } }, async (req) => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId(req) } });
    return { id: org.id, name: org.name, slug: org.slug, createdAt: org.createdAt, settings: readOrgSettings(org.settings) };
  });

  app.patch(
    "/org",
    { config: { permission: "settings:manage" }, schema: { tags: ["org"], summary: "Atualiza nome e configurações (validação completa)", body: z.object({ name: z.string().trim().min(2).max(120).optional(), settings: z.record(z.string(), z.unknown()).optional() }) } },
    async (req) => {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId(req) } });
      const current = readOrgSettings(org.settings);
      let settings = current;
      if (req.body.settings) {
        const merged = merge(current as unknown as Record<string, unknown>, req.body.settings);
        // pesos de pontuação são substituídos por inteiro (permite restaurar os padrões)
        if ("scoring" in req.body.settings) merged.scoring = req.body.settings.scoring;
        const parsed = orgSettingsSchema.safeParse(merged);
        if (!parsed.success) throw badRequest("Configurações inválidas.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
        settings = parsed.data;
      }
      await prisma.organization.update({ where: { id: org.id }, data: { name: req.body.name ?? org.name, settings: settings as unknown as Prisma.InputJsonValue } });
      await writeAudit(req, { action: "org.updated", entityType: "organization", entityId: org.id, metadata: { keys: Object.keys(req.body.settings ?? {}) } });
      return { ok: true, settings };
    },
  );

  // ── usuários e papéis (RBAC) ──
  app.get("/users", { schema: { tags: ["users"], summary: "Membros da organização" } }, async (req) => {
    const members = await prisma.membership.findMany({
      where: { organizationId: orgId(req) },
      orderBy: { createdAt: "asc" },
      include: { user: { select: { id: true, name: true, email: true, isActive: true, lastLoginAt: true, createdAt: true } } },
    });
    return members.map((m) => ({ ...m.user, role: m.role, memberSince: m.createdAt }));
  });

  app.post(
    "/users",
    { config: { permission: "users:manage", rateLimit: { max: 20, timeWindow: "1 hour" } }, schema: { tags: ["users"], summary: "Convida um usuário (recebe link para definir a senha)", body: z.object({ name: z.string().trim().min(2).max(120), email: z.string().trim().toLowerCase().email(), role: roleEnum.default("SALES") }) } },
    async (req, reply) => {
      const organizationId = orgId(req);
      if (!canAssignRole(req.auth!.role, req.body.role)) throw forbidden("Você não pode atribuir esse papel.");
      let user = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (user && (await prisma.membership.findFirst({ where: { userId: user.id, organizationId } }))) throw conflict("Este e-mail já faz parte da organização.");
      if (!user) {
        // senha aleatória inutilizável; o usuário define a própria pelo link
        user = await prisma.user.create({ data: { email: req.body.email, name: req.body.name, passwordHash: await hashPassword(randomToken(32)) } });
      }
      await prisma.membership.create({ data: { userId: user.id, organizationId, role: req.body.role } });
      const token = randomToken(32);
      await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 72 * 3600 * 1000), ip: req.ip } });
      const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId } });
      const link = `${env.APP_BASE_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
      const sent = await sendMail(user.email, `Convite para ${org.name} — Prospecta`, `Olá, ${user.name}.\n\n${req.auth!.name} convidou você para a organização ${org.name} na Prospecta.\nDefina sua senha pelo link abaixo (válido por 72 horas):\n\n${link}\n`);
      await writeAudit(req, { action: "user.invited", entityType: "user", entityId: user.id, metadata: { role: req.body.role, emailSent: sent } });
      // o link volta só para quem convidou (users:manage), para enviar por outro canal quando o e-mail não chega
      return reply.code(201).send({ id: user.id, emailSent: sent, inviteLink: link });
    },
  );

  app.patch(
    "/users/:id",
    { config: { permission: "users:manage" }, schema: { tags: ["users"], summary: "Altera papel ou desativa usuário", params: z.object({ id: z.uuid() }), body: z.object({ role: roleEnum.optional(), isActive: z.boolean().optional() }) } },
    async (req) => {
      const organizationId = orgId(req);
      const m = await prisma.membership.findFirst({ where: { organizationId, userId: req.params.id } });
      if (!m) throw notFound("Usuário não encontrado.");
      if (req.params.id === req.auth!.userId) throw badRequest("Você não pode alterar o próprio papel ou status.");
      if (!canAssignRole(req.auth!.role, m.role)) throw forbidden("Você não pode alterar um usuário com papel superior.");
      if (req.body.role) {
        if (!canAssignRole(req.auth!.role, req.body.role)) throw forbidden("Você não pode atribuir esse papel.");
        if (m.role === "OWNER" && req.body.role !== "OWNER" && (await prisma.membership.count({ where: { organizationId, role: "OWNER" } })) <= 1) throw badRequest("A organização precisa de ao menos um proprietário.");
        await prisma.membership.update({ where: { id: m.id }, data: { role: req.body.role } });
      }
      if (req.body.isActive !== undefined) {
        await prisma.user.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } });
        if (!req.body.isActive) await prisma.session.updateMany({ where: { userId: req.params.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await writeAudit(req, { action: "user.updated", entityType: "user", entityId: req.params.id, metadata: req.body });
      return { ok: true };
    },
  );

  app.delete("/users/:id", { config: { permission: "users:manage" }, schema: { tags: ["users"], summary: "Remove o usuário da organização", params: z.object({ id: z.uuid() }) } }, async (req) => {
    const organizationId = orgId(req);
    const m = await prisma.membership.findFirst({ where: { organizationId, userId: req.params.id } });
    if (!m) throw notFound();
    if (req.params.id === req.auth!.userId) throw badRequest("Você não pode remover a si mesmo.");
    if (!canAssignRole(req.auth!.role, m.role)) throw forbidden();
    if (m.role === "OWNER" && (await prisma.membership.count({ where: { organizationId, role: "OWNER" } })) <= 1) throw badRequest("A organização precisa de ao menos um proprietário.");
    await prisma.$transaction([
      prisma.membership.delete({ where: { id: m.id } }),
      prisma.session.updateMany({ where: { userId: req.params.id, organizationId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await writeAudit(req, { action: "user.removed", entityType: "user", entityId: req.params.id });
    return { ok: true };
  });

  // ── trilha de auditoria ──
  app.get(
    "/audit-logs",
    { config: { permission: "auditlog:read" }, schema: { tags: ["org"], summary: "Trilha de auditoria", querystring: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(200).default(50), action: z.string().max(60).optional(), userId: z.uuid().optional() }) } },
    async (req) => {
      const q = req.query;
      const where: Prisma.AuditLogWhereInput = { organizationId: orgId(req), ...(q.action ? { action: { startsWith: q.action } } : {}), ...(q.userId ? { userId: q.userId } : {}) };
      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(q.page, q.pageSize), include: { user: { select: { name: true, email: true } } } }),
        prisma.auditLog.count({ where }),
      ]);
      return pageResult(items, total, q.page, q.pageSize);
    },
  );
};
