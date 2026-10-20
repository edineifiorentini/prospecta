import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { agentFromLogin, call, closeAll, resetDb, setupAdmin, type Agent } from "./helpers.ts";

let admin: Agent;
beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
});
afterAll(closeAll);

describe("guia de primeiros passos", () => {
  it("usuário novo começa com o tour ativo e checklist vazio", async () => {
    const r = await call(admin, "GET", "/api/me/onboarding");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ tour: { status: "active", step: 0 }, checklistHidden: false });
    expect(Object.values(r.json().checklist).every((s) => !(s as { done: boolean }).done)).toBe(true);
  });

  it("checklist reflete os registros da organização", async () => {
    const c = (await call(admin, "POST", "/api/companies", { name: "Empresa do Guia", city: "Campinas" })).json();
    await call(admin, "POST", "/api/deals", { companyId: c.id });
    await call(admin, "POST", "/api/tasks", { title: "Primeiro retorno", companyId: c.id });
    const s = (await call(admin, "GET", "/api/me/onboarding")).json().checklist;
    expect(s.review).toEqual({ done: true, count: 1 });
    expect(s.crm.done).toBe(true);
    expect(s.task.done).toBe(true);
    expect(s.search.done).toBe(false);
    expect(s.team).toEqual({ done: false, count: 0 });
  });

  it("salva andamento por usuário sem apagar outras preferências", async () => {
    await prisma.user.update({ where: { id: admin.userId }, data: { preferences: { outra: 1 } } });
    const p = await call(admin, "PATCH", "/api/me/onboarding", { tour: { status: "active", step: 4 } });
    expect(p.json().tour).toEqual({ status: "active", step: 4 });
    await call(admin, "PATCH", "/api/me/onboarding", { tour: { status: "dismissed", step: 4 }, checklistHidden: true });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });
    expect(u.preferences).toMatchObject({ outra: 1, onboarding: { tour: { status: "dismissed", step: 4 }, checklistHidden: true } });
    expect((await call(admin, "PATCH", "/api/me/onboarding", { tour: { status: "voando", step: 1 } })).statusCode).toBe(400);
  });

  it("perfil Leitura também acompanha o próprio guia", async () => {
    const hash = (await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } })).passwordHash;
    const u = await prisma.user.create({ data: { email: "leitura.guia@test.local", name: "Leitura", passwordHash: hash } });
    await prisma.membership.create({ data: { userId: u.id, organizationId: admin.organizationId, role: "VIEWER" } });
    const v = await agentFromLogin("leitura.guia@test.local", "senha-de-teste-123");
    expect((await call(v, "GET", "/api/me/onboarding")).json().tour.status).toBe("active");
    expect((await call(v, "PATCH", "/api/me/onboarding", { tour: { status: "completed", step: 9 } })).statusCode).toBe(200);
    // o estado é por usuário
    expect((await call(admin, "GET", "/api/me/onboarding")).json().tour.status).toBe("dismissed");
  });
});
