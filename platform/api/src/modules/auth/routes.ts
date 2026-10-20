import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { env } from "../../config/env.ts";
import { prisma } from "../../lib/prisma.ts";
import { randomToken, safeEqual, sha256 } from "../../lib/crypto.ts";
import { badRequest, conflict, forbidden, notFound, unauthorized } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { sendMail } from "../../lib/mailer.ts";
import { clearSessionCookie, createSession } from "../../plugins/auth.ts";
import { burnPasswordCheck, hashPassword, passwordSchema, verifyPassword } from "./password.ts";
import { permissionsOf } from "./rbac.ts";
import { bootstrapOrganization } from "../orgs/bootstrap.ts";

const MAX_FAILED = 8;
const LOCK_MINUTES = 15;
const RESET_TTL_MIN = 30;

const email = z.string().trim().toLowerCase().email("E-mail inválido.").max(200);

export const authRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── estado do primeiro acesso ──
  app.get("/setup/status", { config: { public: true }, schema: { tags: ["auth"], summary: "Indica se ainda é preciso criar o primeiro administrador" } }, async () => {
    const users = await prisma.user.count();
    return { needsSetup: users === 0, bootstrapConfigured: env.ADMIN_BOOTSTRAP_TOKEN.length >= 16 };
  });

  app.post(
    "/setup",
    {
      config: { public: true, rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        summary: "Cria a organização e o administrador inicial (apenas uma vez, exige ADMIN_BOOTSTRAP_TOKEN)",
        body: z.object({
          bootstrapToken: z.string().min(1),
          organizationName: z.string().trim().min(2).max(120),
          name: z.string().trim().min(2).max(120),
          email,
          password: passwordSchema,
        }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      if (env.ADMIN_BOOTSTRAP_TOKEN.length < 16) throw forbidden("Setup desativado: defina ADMIN_BOOTSTRAP_TOKEN no .env.");
      if (!safeEqual(b.bootstrapToken, env.ADMIN_BOOTSTRAP_TOKEN)) {
        await writeAudit(req, { action: "setup.denied" });
        throw forbidden("Token de configuração inválido.");
      }
      if ((await prisma.user.count()) > 0) throw conflict("A configuração inicial já foi concluída.");

      const passwordHash = await hashPassword(b.password);
      const { user, organization } = await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { email: b.email, name: b.name, passwordHash } });
        const organization = await bootstrapOrganization(tx, b.organizationName);
        await tx.membership.create({ data: { userId: user.id, organizationId: organization.id, role: "OWNER" } });
        return { user, organization };
      });
      await writeAudit(req, { action: "setup.completed", userId: user.id, organizationId: organization.id, entityType: "user", entityId: user.id });
      const session = await createSession(reply, req, user.id, organization.id);
      return reply.code(201).send({ ok: true, csrfToken: session.csrfToken });
    },
  );

  // ── login ──
  app.post(
    "/auth/login",
    {
      config: { public: true, rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: {
        tags: ["auth"],
        summary: "Login por e-mail e senha",
        body: z.object({ email, password: z.string().min(1).max(200) }),
      },
    },
    async (req, reply) => {
      const { email, password } = req.body;
      const user = await prisma.user.findUnique({ where: { email }, include: { memberships: { orderBy: { createdAt: "asc" } } } });
      const generic = unauthorized("E-mail ou senha incorretos.");
      if (!user || !user.isActive) {
        await burnPasswordCheck(password);
        await writeAudit(req, { action: "auth.login_failed", metadata: { reason: "unknown_user" } });
        throw generic;
      }
      if (user.lockedUntil && user.lockedUntil > new Date()) {
        await writeAudit(req, { action: "auth.login_locked", userId: user.id });
        throw unauthorized(`Conta temporariamente bloqueada por excesso de tentativas. Tente novamente em alguns minutos.`);
      }
      const ok = await verifyPassword(user.passwordHash, password);
      if (!ok) {
        const failed = user.failedLoginCount + 1;
        await prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60_000) : null },
        });
        await writeAudit(req, { action: "auth.login_failed", userId: user.id, metadata: { failed } });
        throw generic;
      }
      const membership = user.memberships[0];
      if (!membership) throw forbidden("Usuário sem organização associada.");
      await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() } });
      const session = await createSession(reply, req, user.id, membership.organizationId);
      await writeAudit(req, { action: "auth.login", userId: user.id, organizationId: membership.organizationId });
      return { ok: true, csrfToken: session.csrfToken, mustChangePassword: user.mustChangePassword };
    },
  );

  app.post("/auth/logout", { config: { public: true }, schema: { tags: ["auth"], summary: "Encerra a sessão atual" } }, async (req, reply) => {
    if (req.auth) {
      await prisma.session.update({ where: { id: req.auth.sessionId }, data: { revokedAt: new Date() } });
      await writeAudit(req, { action: "auth.logout" });
    }
    clearSessionCookie(reply);
    return { ok: true };
  });

  app.get("/auth/session", { config: { public: true }, schema: { tags: ["auth"], summary: "Usuário, organização, papel e token CSRF da sessão" } }, async (req) => {
    if (!req.auth) return { authenticated: false as const };
    const org = await prisma.organization.findUnique({ where: { id: req.auth.organizationId }, select: { id: true, name: true, slug: true } });
    return {
      authenticated: true as const,
      csrfToken: req.auth.csrfToken,
      user: { id: req.auth.userId, name: req.auth.name, email: req.auth.email },
      mustChangePassword: req.auth.mustChangePassword,
      organization: org,
      role: req.auth.role,
      permissions: permissionsOf(req.auth.role),
    };
  });

  // ── sessões ativas ──
  app.get("/auth/sessions", { schema: { tags: ["auth"], summary: "Lista as sessões ativas do usuário" } }, async (req) => {
    const rows = await prisma.session.findMany({
      where: { userId: req.auth!.userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
    });
    return rows.map((r) => ({ ...r, current: r.id === req.auth!.sessionId }));
  });

  app.delete("/auth/sessions/:id", { schema: { tags: ["auth"], summary: "Revoga uma sessão", params: z.object({ id: z.uuid() }) } }, async (req) => {
    const s = await prisma.session.findFirst({ where: { id: req.params.id, userId: req.auth!.userId } });
    if (!s) throw notFound();
    await prisma.session.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
    await writeAudit(req, { action: "auth.session_revoked", entityType: "session", entityId: s.id });
    return { ok: true };
  });

  // ── troca de senha ──
  app.post(
    "/auth/password",
    {
      config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
      schema: { tags: ["auth"], summary: "Troca a senha do usuário logado", body: z.object({ currentPassword: z.string().min(1), newPassword: passwordSchema }) },
    },
    async (req, reply) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId } });
      if (!(await verifyPassword(user.passwordHash, req.body.currentPassword))) throw badRequest("Senha atual incorreta.");
      if (await verifyPassword(user.passwordHash, req.body.newPassword)) throw badRequest("A nova senha precisa ser diferente da atual.");
      const now = new Date();
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await hashPassword(req.body.newPassword), passwordChangedAt: now, mustChangePassword: false },
      });
      await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: now } });
      await writeAudit(req, { action: "auth.password_changed" });
      const session = await createSession(reply, req, user.id, req.auth!.organizationId);
      return { ok: true, csrfToken: session.csrfToken };
    },
  );

  // ── recuperação de senha ──
  app.post(
    "/auth/forgot",
    {
      config: { public: true, rateLimit: { max: 5, timeWindow: "15 minutes" } },
      schema: { tags: ["auth"], summary: "Envia link de redefinição de senha (resposta sempre igual)", body: z.object({ email }) },
    },
    async (req, reply) => {
      const user = await prisma.user.findUnique({ where: { email: req.body.email } });
      if (user?.isActive) {
        const token = randomToken(32);
        await prisma.passwordResetToken.create({
          data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MIN * 60_000), ip: req.ip },
        });
        const link = `${env.APP_BASE_URL}/redefinir-senha?token=${encodeURIComponent(token)}`;
        await sendMail(
          user.email,
          "Redefinição de senha — Prospecta",
          `Olá, ${user.name}.\n\nRecebemos um pedido para redefinir sua senha. O link abaixo vale por ${RESET_TTL_MIN} minutos e só pode ser usado uma vez:\n\n${link}\n\nSe você não fez esse pedido, ignore este e-mail.`,
        );
        await writeAudit(req, { action: "auth.reset_requested", userId: user.id });
      }
      return reply.code(202).send({ ok: true, message: "Se o e-mail estiver cadastrado, você receberá um link em instantes." });
    },
  );

  app.post(
    "/auth/reset",
    {
      config: { public: true, rateLimit: { max: 10, timeWindow: "15 minutes" } },
      schema: { tags: ["auth"], summary: "Redefine a senha com o token recebido por e-mail", body: z.object({ token: z.string().min(20).max(200), password: passwordSchema }) },
    },
    async (req, reply) => {
      const rec = await prisma.passwordResetToken.findUnique({ where: { tokenHash: sha256(req.body.token) } });
      if (!rec || rec.usedAt || rec.expiresAt < new Date()) throw badRequest("Link inválido ou expirado. Peça um novo.");
      const now = new Date();
      await prisma.$transaction([
        prisma.passwordResetToken.update({ where: { id: rec.id }, data: { usedAt: now } }),
        prisma.passwordResetToken.updateMany({ where: { userId: rec.userId, usedAt: null }, data: { usedAt: now } }),
        prisma.user.update({
          where: { id: rec.userId },
          data: { passwordHash: await hashPassword(req.body.password), passwordChangedAt: now, failedLoginCount: 0, lockedUntil: null, mustChangePassword: false },
        }),
        prisma.session.updateMany({ where: { userId: rec.userId, revokedAt: null }, data: { revokedAt: now } }),
      ]);
      await writeAudit(req, { action: "auth.password_reset", userId: rec.userId });
      clearSessionCookie(reply);
      return { ok: true };
    },
  );

};
