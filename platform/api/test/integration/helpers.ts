import type { FastifyInstance } from "fastify";
import { buildApp } from "../../src/app.ts";
import { prisma } from "../../src/lib/prisma.ts";
import { redis } from "../../src/lib/redis.ts";

export type Agent = { cookie: string; csrf: string; userId: string; organizationId: string };

let app: FastifyInstance | null = null;
export async function getApp() {
  app ??= await buildApp({ logger: false });
  await app.ready();
  return app;
}

/** Limpa todas as tabelas do banco de teste (ordem respeitando chaves estrangeiras via TRUNCATE CASCADE). */
export async function resetDb() {
  const rows = await prisma.$queryRawUnsafe<{ tablename: string }[]>("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'");
  await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(", ")} RESTART IDENTITY CASCADE`);
  await redis.flushdb();
}

const pick = (setCookie: string | string[] | undefined) => {
  const v = Array.isArray(setCookie) ? setCookie.find((c) => c.startsWith("pp_session=")) : setCookie;
  return v?.split(";")[0] ?? "";
};

export async function setupAdmin(email = "admin@test.local", password = "senha-de-teste-123") {
  const a = await getApp();
  const res = await a.inject({ method: "POST", url: "/api/setup", headers: { origin: "http://localhost:3000" }, payload: { bootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN, organizationName: "Org Teste", name: "Admin Teste", email, password } });
  if (res.statusCode !== 201) throw new Error(`setup falhou: ${res.statusCode} ${res.body}`);
  return agentFromLogin(email, password);
}

export async function agentFromLogin(email: string, password: string): Promise<Agent> {
  const a = await getApp();
  const res = await a.inject({ method: "POST", url: "/api/auth/login", payload: { email, password } });
  if (res.statusCode !== 200) throw new Error(`login falhou: ${res.statusCode} ${res.body}`);
  const cookie = pick(res.headers["set-cookie"]);
  const session = await a.inject({ method: "GET", url: "/api/auth/session", headers: { cookie } });
  const s = session.json();
  return { cookie, csrf: s.csrfToken, userId: s.user.id, organizationId: s.organization.id };
}

export async function call(agent: Agent | null, method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: unknown) {
  const a = await getApp();
  return a.inject({
    method,
    url,
    payload: payload as never,
    headers: agent ? { cookie: agent.cookie, ...(method !== "GET" ? { "x-csrf-token": agent.csrf } : {}) } : {},
  });
}

export async function closeAll() {
  await app?.close();
  await prisma.$disconnect();
  redis.disconnect();
}
