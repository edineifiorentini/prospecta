import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { randomToken, sha256 } from "../../src/lib/crypto.ts";
import { agentFromLogin, call, closeAll, getApp, resetDb, setupAdmin, type Agent } from "./helpers.ts";

let admin: Agent;

beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
});
afterAll(closeAll);

describe("autenticação e sessão", () => {
  it("setup só funciona uma vez", async () => {
    const app = await getApp();
    const r = await app.inject({ method: "POST", url: "/api/setup", payload: { bootstrapToken: process.env.ADMIN_BOOTSTRAP_TOKEN, organizationName: "Outra Org", name: "Outro", email: "x@x.com", password: "outra-senha-forte-1" } });
    expect(r.statusCode).toBe(409);
  });

  it("não armazena senha em texto e usa Argon2id", async () => {
    const u = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    expect(u.passwordHash.startsWith("$argon2id$")).toBe(true);
    expect(u.passwordHash).not.toContain("senha-de-teste-123");
  });

  it("exige CSRF em requisições de escrita autenticadas", async () => {
    const app = await getApp();
    const r = await app.inject({ method: "POST", url: "/api/lists", headers: { cookie: admin.cookie }, payload: { name: "x" } });
    expect(r.statusCode).toBe(403);
    const ok = await call(admin, "POST", "/api/lists", { name: "Lista válida" });
    expect(ok.statusCode).toBe(201);
  });

  it("bloqueia origem estrangeira", async () => {
    const app = await getApp();
    const r = await app.inject({ method: "POST", url: "/api/auth/login", headers: { origin: "https://evil.example" }, payload: { email: "admin@test.local", password: "x" } });
    expect(r.statusCode).toBe(403);
  });

  it("rotas protegidas exigem sessão", async () => {
    expect((await call(null, "GET", "/api/companies")).statusCode).toBe(401);
    expect((await call(null, "GET", "/api/docs")).statusCode).toBe(401);
  });

  it("bloqueia a conta após tentativas repetidas", async () => {
    const app = await getApp();
    await prisma.user.create({ data: { email: "alvo@test.local", name: "Alvo", passwordHash: (await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } })).passwordHash } });
    await prisma.membership.create({ data: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: "alvo@test.local" } })).id, organizationId: admin.organizationId, role: "SALES" } });
    for (let i = 0; i < 8; i++) await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "alvo@test.local", password: "errada" }, remoteAddress: `10.0.0.${i + 10}` });
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "alvo@test.local", password: "senha-de-teste-123" }, remoteAddress: "10.0.0.99" });
    expect(r.statusCode).toBe(401);
    expect(r.json().message).toMatch(/bloqueada/);
  });

  it("redefine a senha com token de uso único e revoga sessões", async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } });
    const token = randomToken(32);
    await prisma.passwordResetToken.create({ data: { userId: user.id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 600_000) } });
    const app = await getApp();
    const r = await app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "nova-senha-forte-456" } });
    expect(r.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "outra-senha-forte-789" } })).statusCode).toBe(400);
    expect((await call(admin, "GET", "/api/companies")).statusCode).toBe(401); // sessão antiga revogada
    admin = await agentFromLogin("admin@test.local", "nova-senha-forte-456");
    expect((await call(admin, "GET", "/api/companies")).statusCode).toBe(200);
  });
});

describe("RBAC e isolamento entre organizações", () => {
  it("perfil Leitura não pode criar buscas nem empresas", async () => {
    const hash = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } })).passwordHash;
    const viewer = await prisma.user.create({ data: { email: "leitor@test.local", name: "Leitor", passwordHash: hash } });
    await prisma.membership.create({ data: { userId: viewer.id, organizationId: admin.organizationId, role: "VIEWER" } });
    const v = await agentFromLogin("leitor@test.local", "nova-senha-forte-456");
    expect((await call(v, "GET", "/api/companies")).statusCode).toBe(200);
    expect((await call(v, "POST", "/api/companies", { name: "Empresa X" })).statusCode).toBe(403);
    expect((await call(v, "POST", "/api/searches", { provider: "OSM_OVERPASS", keyword: "dentista", city: "Campinas" })).statusCode).toBe(403);
  });

  it("usuário de outra organização não acessa dados alheios", async () => {
    const c = await call(admin, "POST", "/api/companies", { name: "Empresa Privada", city: "Campinas" });
    const companyId = c.json().id;
    const org2 = await prisma.organization.create({ data: { name: "Outra", slug: "outra" } });
    const hash = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } })).passwordHash;
    const u2 = await prisma.user.create({ data: { email: "intruso@test.local", name: "Intruso", passwordHash: hash } });
    await prisma.membership.create({ data: { userId: u2.id, organizationId: org2.id, role: "OWNER" } });
    const intruder = await agentFromLogin("intruso@test.local", "nova-senha-forte-456");
    expect((await call(intruder, "GET", `/api/companies/${companyId}`)).statusCode).toBe(404);
    expect((await call(intruder, "PATCH", `/api/companies/${companyId}`, { name: "hack" })).statusCode).toBe(404);
    expect((await call(intruder, "GET", "/api/companies")).json().total).toBe(0);
  });
});

describe("senha temporária", () => {
  it("exige a troca antes de liberar o sistema", async () => {
    const { hashPassword } = await import("../../src/modules/auth/password.ts");
    const u = await prisma.user.create({ data: { email: "temp@test.local", name: "Temporário", passwordHash: await hashPassword("Temp-abcd-EFGH-2345"), mustChangePassword: true } });
    await prisma.membership.create({ data: { userId: u.id, organizationId: admin.organizationId, role: "OWNER" } });

    const app = await getApp();
    const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: "temp@test.local", password: "Temp-abcd-EFGH-2345" } });
    expect(login.json().mustChangePassword).toBe(true);
    const t = await agentFromLogin("temp@test.local", "Temp-abcd-EFGH-2345");

    const blocked = await call(t, "GET", "/api/companies");
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect((await call(t, "GET", "/api/docs")).statusCode).toBe(401);
    expect((await call(t, "GET", "/api/auth/session")).json().mustChangePassword).toBe(true);

    // a nova senha precisa ser diferente da temporária
    expect((await call(t, "POST", "/api/auth/password", { currentPassword: "Temp-abcd-EFGH-2345", newPassword: "Temp-abcd-EFGH-2345" })).statusCode).toBe(400);
    const changed = await call(t, "POST", "/api/auth/password", { currentPassword: "Temp-abcd-EFGH-2345", newPassword: "minha-senha-pessoal-77" });
    expect(changed.statusCode).toBe(200);

    const after = await agentFromLogin("temp@test.local", "minha-senha-pessoal-77");
    expect((await call(after, "GET", "/api/companies")).statusCode).toBe(200);
    expect((await call(after, "GET", "/api/auth/session")).json().mustChangePassword).toBe(false);
  });
});
