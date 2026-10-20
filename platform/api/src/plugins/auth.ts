import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { env } from "../config/env.ts";
import { prisma, type Role } from "../lib/prisma.ts";
import { randomToken, safeEqual, sha256 } from "../lib/crypto.ts";
import { AppError, forbidden, unauthorized } from "../lib/errors.ts";
import { can, type Permission } from "../modules/auth/rbac.ts";

export const SESSION_COOKIE = "pp_session";
const IDLE_TTL_MS = 7 * 24 * 3600 * 1000; // sessão expira após 7 dias sem uso
const ABSOLUTE_TTL_MS = 30 * 24 * 3600 * 1000; // e no máximo 30 dias após o login
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;

export type AuthContext = {
  sessionId: string;
  userId: string;
  organizationId: string;
  role: Role;
  csrfToken: string;
  email: string;
  name: string;
  /** senha temporária ainda não trocada: só as rotas de PASSWORD_CHANGE_ALLOWED respondem */
  mustChangePassword: boolean;
};

declare module "fastify" {
  interface FastifyRequest {
    auth: AuthContext | null;
  }
  interface FastifyContextConfig {
    /** rotas públicas não exigem sessão */
    public?: boolean;
    /** permissão exigida (além de estar autenticado) */
    permission?: Permission;
    /** pula a verificação de CSRF (ex.: webhooks com HMAC) */
    skipCsrf?: boolean;
  }
}

export const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: "lax" as const,
  path: "/",
});

export async function createSession(reply: FastifyReply, req: FastifyRequest, userId: string, organizationId: string) {
  const token = randomToken(32);
  const now = Date.now();
  const session = await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      csrfToken: randomToken(24),
      userId,
      organizationId,
      ip: req.ip,
      userAgent: req.headers["user-agent"]?.slice(0, 300),
      expiresAt: new Date(now + IDLE_TTL_MS),
    },
  });
  reply.setCookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: Math.floor(ABSOLUTE_TTL_MS / 1000) });
  return session;
}

export function clearSessionCookie(reply: FastifyReply) {
  reply.clearCookie(SESSION_COOKIE, cookieOptions());
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/** Rotas liberadas enquanto o usuário tem uma senha temporária. */
const PASSWORD_CHANGE_ALLOWED = new Set(["/api/auth/session", "/api/auth/password", "/api/auth/logout"]);
const allowedOrigins = new Set([new URL(env.APP_BASE_URL).origin, "http://localhost:3000", "http://127.0.0.1:3000", ...(env.NODE_ENV === "development" ? ["http://localhost:3001"] : [])]);

async function resolveSession(req: FastifyRequest): Promise<AuthContext | null> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || token.length > 200) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });
  if (!session || session.revokedAt || !session.user.isActive) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() < now || session.createdAt.getTime() + ABSOLUTE_TTL_MS < now) return null;
  // sessões emitidas antes de uma troca de senha deixam de valer
  if (session.createdAt < session.user.passwordChangedAt) return null;

  const membership = await prisma.membership.findUnique({
    where: { userId_organizationId: { userId: session.userId, organizationId: session.organizationId } },
  });
  if (!membership) return null;

  if (now - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await prisma.session.update({
      where: { id: session.id },
      data: { lastSeenAt: new Date(now), expiresAt: new Date(now + IDLE_TTL_MS) },
    });
  }
  return {
    sessionId: session.id,
    userId: session.userId,
    organizationId: session.organizationId,
    role: membership.role,
    csrfToken: session.csrfToken,
    email: session.user.email,
    name: session.user.name,
    mustChangePassword: session.user.mustChangePassword,
  };
}

export default fp(async (app) => {
  app.decorateRequest("auth", null);

  app.addHook("onRequest", async (req) => {
    const cfg = req.routeOptions.config ?? {};
    if (req.url.startsWith("/api/docs")) {
      // documentação da API visível apenas para usuários autenticados
      req.auth = await resolveSession(req);
      if (!req.auth || req.auth.mustChangePassword) throw unauthorized("Faça login para ver a documentação da API.");
      return;
    }
    if (!req.routeOptions.url) return; // 404 tratado adiante
    req.auth = await resolveSession(req);

    if (UNSAFE.has(req.method) && !cfg.skipCsrf) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.has(origin)) throw forbidden("Origem da requisição não permitida.");
      if (req.auth) {
        const header = req.headers["x-csrf-token"];
        if (typeof header !== "string" || !safeEqual(header, req.auth.csrfToken)) {
          throw forbidden("Token CSRF ausente ou inválido. Recarregue a página.");
        }
      }
    }

    if (cfg.public) return;
    if (!req.auth) throw unauthorized();
    if (req.auth.mustChangePassword && !PASSWORD_CHANGE_ALLOWED.has(req.routeOptions.url)) {
      throw new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Troque a senha temporária antes de continuar.");
    }
    if (cfg.permission && !can(req.auth.role, cfg.permission)) throw forbidden();
  });
});

/** Garante que o recurso pertence à organização da sessão. */
export function orgId(req: FastifyRequest): string {
  if (!req.auth) throw unauthorized();
  return req.auth.organizationId;
}

export function requirePermission(req: FastifyRequest, permission: Permission) {
  if (!req.auth) throw unauthorized();
  if (!can(req.auth.role, permission)) throw forbidden();
}
