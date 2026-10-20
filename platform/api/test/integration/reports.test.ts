import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { agentFromLogin, call, closeAll, resetDb, setupAdmin, type Agent } from "./helpers.ts";

let admin: Agent;

beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
  const a = (await call(admin, "POST", "/api/companies", { name: "Clínica Alfa", website: "https://alfa.example", city: "Campinas", category: "Dentista", phone: "(19) 3333-1111" })).json();
  const b = (await call(admin, "POST", "/api/companies", { name: "=Padaria Beta", city: "Sumaré", category: "Padaria" })).json();
  const stages = (await call(admin, "GET", "/api/pipelines")).json()[0].stages as { id: string; kind: string }[];
  const dealA = (await call(admin, "POST", "/api/deals", { companyId: a.id, valueCents: 250_000 })).json();
  const dealB = (await call(admin, "POST", "/api/deals", { companyId: b.id })).json();
  await call(admin, "PATCH", `/api/deals/${dealA.id}`, { stageId: stages.find((s) => s.kind === "WON")!.id });
  await call(admin, "PATCH", `/api/deals/${dealB.id}`, { stageId: stages.find((s) => s.kind === "LOST")!.id });
  await call(admin, "POST", "/api/activities", { companyId: a.id, type: "CALL", title: "Ligação de apresentação", outcome: "CONNECTED" });
  await call(admin, "POST", "/api/tasks", { title: "Retornar contato", companyId: b.id, dueAt: new Date(Date.now() - 86_400_000).toISOString() });

});
afterAll(closeAll);

describe("painel e relatórios", () => {
  it("calcula indicadores a partir dos registros", async () => {
    const r = await call(admin, "GET", "/api/dashboard");
    expect(r.statusCode).toBe(200);
    const m = r.json();
    expect(m.leads).toMatchObject({ total: 2, newInPeriod: 2, withoutWebsite: 1, qualified: 1 });
    expect(m.pipeline).toMatchObject({ wonInPeriod: 1, lostInPeriod: 1, winRate: 0.5, wonValueCents: 250_000, openDeals: 0 });
    expect(m.activity.contacts).toMatchObject({ calls: 1, total: 1 });
    expect(m.activity.tasks).toMatchObject({ open: 1, overdue: 1 });
    // todas as empresas recebem qualidade dos dados ou ficam fora das faixas como "não avaliado"
    const dq = m.scores.DATA_QUALITY;
    expect(dq.buckets.reduce((s: number, b: { count: number }) => s + b.count, 0) + dq.notEvaluated).toBe(2);
    expect(m.series.newCompanies.reduce((s: number, x: { count: number }) => s + x.count, 0)).toBe(2);
  });

  it("aplica filtros de cidade e período", async () => {
    const city = (await call(admin, "GET", "/api/dashboard?city=Campinas")).json();
    expect(city.leads.total).toBe(1);
    expect(city.segments.byCategory).toEqual([{ label: "Dentista", count: 1 }]);
    expect(city.pipeline.wonInPeriod).toBe(1);
    expect(city.pipeline.lostInPeriod).toBe(0);
    const past = (await call(admin, "GET", "/api/dashboard?from=2020-01-01T00:00:00-03:00&to=2020-12-31T23:59:59-03:00")).json();
    expect(past.leads.newInPeriod).toBe(0);
    expect(past.leads.total).toBe(2); // situação atual não depende do período
    expect(past.pipeline.winRate).toBeNull();
  });

  it("exporta CSV com definições e neutraliza fórmulas", async () => {
    const summary = await call(admin, "GET", "/api/reports/summary.csv");
    expect(summary.statusCode).toBe(200);
    expect(summary.headers["content-type"]).toContain("text/csv");
    expect(summary.body).toContain("Taxa de conversão,50%");
    const deals = await call(admin, "GET", "/api/reports/deals.csv");
    expect(deals.body).toContain("'=Padaria Beta");
    expect(deals.body).toContain("2500,00");
    const acts = await call(admin, "GET", "/api/reports/activities.csv");
    expect(acts.body).toContain("Ligação de apresentação");
    const logged = await prisma.auditLog.count({ where: { action: { startsWith: "report." } } });
    expect(logged).toBeGreaterThanOrEqual(3);
  });

  it("perfil Leitura vê o painel mas não exporta", async () => {
    const hash = (await prisma.user.findUniqueOrThrow({ where: { email: "admin@test.local" } })).passwordHash;
    const u = await prisma.user.create({ data: { email: "leitura@test.local", name: "Leitura", passwordHash: hash } });
    await prisma.membership.create({ data: { userId: u.id, organizationId: admin.organizationId, role: "VIEWER" } });
    const v = await agentFromLogin("leitura@test.local", "senha-de-teste-123");
    expect((await call(v, "GET", "/api/dashboard")).statusCode).toBe(200);
    expect((await call(v, "GET", "/api/reports/deals.csv")).statusCode).toBe(403);
    expect((await call(v, "GET", "/api/reports/summary.pdf")).statusCode).toBe(403);
  });
});
