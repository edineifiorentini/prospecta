import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { agentFromLogin, call, closeAll, getApp, resetDb, setupAdmin, type Agent } from "./helpers.ts";

let platform: Agent; // quem instalou: administrador da plataforma
let client: Agent; // dono de uma conta de cliente
let clientOrgId: string;

/** Usa o link do convite para definir a senha e entra na conta. */
async function activate(inviteLink: string, email: string, password: string) {
  const token = new URL(inviteLink).searchParams.get("token")!;
  const app = await getApp();
  const r = await app.inject({ method: "POST", url: "/api/auth/reset", payload: { token, password } });
  expect(r.statusCode).toBe(200);
  return agentFromLogin(email, password);
}

beforeAll(async () => {
  await resetDb();
  platform = await setupAdmin();
});
afterAll(closeAll);

describe("contas de clientes (empresas separadas)", () => {
  it("quem instala o sistema é o administrador da plataforma", async () => {
    expect((await call(platform, "GET", "/api/auth/session")).json().user.isPlatformAdmin).toBe(true);
  });

  it("cria uma conta separada, com funil e modelos próprios, e devolve o link do responsável", async () => {
    const r = await call(platform, "POST", "/api/platform/accounts", { organizationName: "Cliente Um", name: "Dono Cliente", email: "dono@cliente.test" });
    expect(r.statusCode).toBe(201);
    clientOrgId = r.json().organizationId;
    expect(clientOrgId).not.toBe(platform.organizationId);
    expect(await prisma.pipeline.count({ where: { organizationId: clientOrgId } })).toBe(1);
    expect(await prisma.messageTemplate.count({ where: { organizationId: clientOrgId } })).toBeGreaterThan(0);

    client = await activate(r.json().inviteLink, "dono@cliente.test", "senha-do-cliente-123");
    const s = (await call(client, "GET", "/api/auth/session")).json();
    expect(s.organization.id).toBe(clientOrgId);
    expect(s.role).toBe("OWNER");
    expect(s.user.isPlatformAdmin).toBe(false);
  });

  it("não aceita e-mail que já tem acesso", async () => {
    const r = await call(platform, "POST", "/api/platform/accounts", { organizationName: "Outra", name: "Outro", email: "dono@cliente.test" });
    expect(r.statusCode).toBe(409);
  });

  it("cada conta vê só as próprias empresas, mesmo com dados iguais", async () => {
    const mine = await call(platform, "POST", "/api/companies", { name: "Padaria Igual", phone: "+5544999990000", city: "Umuarama" });
    expect(mine.statusCode).toBe(201);
    // a mesma empresa cadastrada pelo cliente vira outro registro, sem se juntar à do administrador
    const theirs = await call(client, "POST", "/api/companies", { name: "Padaria Igual", phone: "+5544999990000", city: "Umuarama" });
    expect(theirs.statusCode).toBe(201);
    expect(theirs.json().id).not.toBe(mine.json().id);

    const list = (await call(client, "GET", "/api/companies")).json();
    expect(list.items.map((c: { id: string }) => c.id)).toEqual([theirs.json().id]);
    expect((await call(client, "GET", `/api/companies/${mine.json().id}`)).statusCode).toBe(404);
    expect((await call(platform, "GET", `/api/companies/${theirs.json().id}`)).statusCode).toBe(404);
  });

  it("não deixa usar como responsável alguém de outra conta", async () => {
    const r = await call(client, "POST", "/api/companies", { name: "Loja Nova", ownerId: platform.userId });
    expect(r.statusCode).toBe(400);
    const company = (await call(client, "POST", "/api/companies", { name: "Loja Certa" })).json();
    const deal = await call(client, "POST", "/api/deals", { companyId: company.id, ownerId: platform.userId });
    expect(deal.statusCode).toBe(400);
  });

  it("só o administrador da plataforma gerencia contas, e sem ver os dados delas", async () => {
    expect((await call(client, "GET", "/api/platform/accounts")).statusCode).toBe(403);
    expect((await call(client, "POST", "/api/platform/accounts", { organizationName: "Empresa X", name: "Fulano", email: "x@cliente.test" })).statusCode).toBe(403);

    const accounts = (await call(platform, "GET", "/api/platform/accounts")).json();
    expect(accounts).toHaveLength(2);
    const acc = accounts.find((a: { id: string }) => a.id === clientOrgId);
    expect(acc).toMatchObject({ name: "Cliente Um", isMine: false, pendingInvite: false, companies: 2, users: 1 });
    expect(acc.owner.email).toBe("dono@cliente.test");
    expect(JSON.stringify(accounts)).not.toContain("Loja Certa");
  });

  it("gera novo link só enquanto o responsável não entrou", async () => {
    // a conta do cliente já está em uso: o administrador não pode trocar a senha dele
    expect((await call(platform, "POST", `/api/platform/accounts/${clientOrgId}/invite-link`)).statusCode).toBe(409);

    const pending = (await call(platform, "POST", "/api/platform/accounts", { organizationName: "Cliente Dois", name: "Dona Dois", email: "dona@dois.test" })).json();
    const again = await call(platform, "POST", `/api/platform/accounts/${pending.organizationId}/invite-link`);
    expect(again.statusCode).toBe(200);
    // o link antigo deixa de valer quando um novo é gerado
    const app = await getApp();
    const oldToken = new URL(pending.inviteLink).searchParams.get("token");
    expect((await app.inject({ method: "POST", url: "/api/auth/reset", payload: { token: oldToken, password: "senha-qualquer-123" } })).statusCode).toBe(400);
    await activate(again.json().inviteLink, "dona@dois.test", "senha-da-dona-456");
  });
});
