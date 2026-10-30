import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { agentFromLogin, call, closeAll, getApp, resetDb, setupAdmin, type Agent } from "./helpers.ts";

let platform: Agent;
let client: Agent;
let clientOrgId: string;

const search = (limit: number) => ({ provider: "GOOGLE_MAPS_SCRAPER", keyword: "dentista", city: "Umuarama", state: "PR", limit });
/** Simula o fim de uma pesquisa (nos testes não há worker nem motor de coleta). */
const finish = (id: string, resultCount: number) => prisma.searchJob.update({ where: { id }, data: { status: "COMPLETED", startedAt: new Date(), finishedAt: new Date(), resultCount } });
const quota = async (a: Agent) => (await call(a, "GET", "/api/searches/quota")).json();

beforeAll(async () => {
  await resetDb();
  platform = await setupAdmin();
  const r = await call(platform, "POST", "/api/platform/accounts", { organizationName: "Conta de Teste", name: "Fulano Teste", email: "teste@limite.test", limits: { searchesPerDay: 3, maxCompanies: 50 } });
  expect(r.statusCode).toBe(201);
  clientOrgId = r.json().organizationId;
  const token = new URL(r.json().inviteLink).searchParams.get("token")!;
  await (await getApp()).inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "senha-do-teste-123" } });
  client = await agentFromLogin("teste@limite.test", "senha-do-teste-123");
});
afterAll(closeAll);

describe("limites de pesquisa por conta", () => {
  it("a conta nasce com os limites definidos na criação", async () => {
    expect(await quota(client)).toMatchObject({ searchesPerDay: 3, searchesToday: 0, maxCompanies: 50, companiesUsed: 0, companiesReserved: 0, companiesRemaining: 50 });
    // a conta do administrador continua sem limites
    expect(await quota(platform)).toMatchObject({ searchesPerDay: null, maxCompanies: null, companiesRemaining: null });
  });

  it("a pesquisa é cortada no saldo de empresas e o motor nem procura além dele", async () => {
    const r = await call(client, "POST", "/api/searches", search(60));
    expect(r.statusCode).toBe(201);
    expect(r.json().quotaCap).toBe(50);
    const job = await prisma.searchJob.findUniqueOrThrow({ where: { id: r.json().id } });
    expect(job.params).toMatchObject({ limit: 50, quotaCap: 50 });
    // em andamento, a pesquisa reserva o teto dela
    expect(await quota(client)).toMatchObject({ searchesToday: 1, companiesReserved: 50, companiesRemaining: 0 });
  });

  it("sem saldo (contando o reservado), recusa antes de criar", async () => {
    const r = await call(client, "POST", "/api/searches", search(20));
    expect(r.statusCode).toBe(429);
    expect(r.json().message).toMatch(/Limite de empresas desta conta atingido/);
    expect(await prisma.searchJob.count({ where: { organizationId: clientOrgId } })).toBe(1);
  });

  it("concluída, conta o que trouxe e devolve o resto do saldo", async () => {
    const first = await prisma.searchJob.findFirstOrThrow({ where: { organizationId: clientOrgId } });
    await finish(first.id, 30);
    expect(await quota(client)).toMatchObject({ companiesUsed: 30, companiesReserved: 0, companiesRemaining: 20 });
    const r = await call(client, "POST", "/api/searches", search(60));
    expect(r.json().quotaCap).toBe(20);
    await finish(r.json().id, 18);
  });

  it("importação de CSV e pesquisa cancelada antes de começar não contam", async () => {
    await prisma.searchJob.create({ data: { organizationId: clientOrgId, provider: "CSV_IMPORT", name: "Importação: lista.csv", status: "COMPLETED", resultCount: 400, params: { fileName: "lista.csv" } } });
    const r = await call(client, "POST", "/api/searches", search(5));
    expect(r.statusCode).toBe(201);
    expect((await call(client, "POST", `/api/searches/${r.json().id}/cancel`)).statusCode).toBe(200);
    expect(await quota(client)).toMatchObject({ searchesToday: 2, companiesUsed: 48, companiesRemaining: 2 });
  });

  it("no limite diário, recusa mesmo com saldo de empresas", async () => {
    const third = await call(client, "POST", "/api/searches", search(5));
    expect(third.statusCode).toBe(201);
    expect(third.json().quotaCap).toBe(2);
    // o motor aceita no mínimo 5; o que passar de 2 é descartado antes de gravar
    expect((await prisma.searchJob.findUniqueOrThrow({ where: { id: third.json().id } })).params).toMatchObject({ limit: 5, quotaCap: 2 });
    await finish(third.json().id, 2);
    const r = await call(client, "POST", "/api/searches", search(5));
    expect(r.statusCode).toBe(429);
    expect(r.json().message).toMatch(/Limite diário de pesquisas desta conta atingido \(3 de 3\)/);
  });

  it("só o administrador da plataforma muda os limites, e vê o uso de cada conta", async () => {
    expect((await call(client, "PUT", `/api/platform/accounts/${clientOrgId}/limits`, { searchesPerDay: null, maxCompanies: null })).statusCode).toBe(403);
    const r = await call(platform, "PUT", `/api/platform/accounts/${clientOrgId}/limits`, { searchesPerDay: null, maxCompanies: 100 });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ searchesPerDay: null, maxCompanies: 100, companiesUsed: 50, companiesRemaining: 50 });
    expect((await call(platform, "PUT", `/api/platform/accounts/${clientOrgId}/limits`, { searchesPerDay: 0, maxCompanies: 100 })).statusCode).toBe(400);
    const acc = (await call(platform, "GET", "/api/platform/accounts")).json().find((a: { id: string }) => a.id === clientOrgId);
    expect(acc.searchUsage).toMatchObject({ searchesPerDay: null, searchesToday: 3, maxCompanies: 100, companiesUsed: 50 });
    expect(await prisma.auditLog.count({ where: { organizationId: clientOrgId, action: "account.search_limits" } })).toBe(1);
  });

  it("duas pesquisas ao mesmo tempo não passam do limite", async () => {
    await call(platform, "PUT", `/api/platform/accounts/${clientOrgId}/limits`, { searchesPerDay: null, maxCompanies: 60 });
    const [a, b] = await Promise.all([call(client, "POST", "/api/searches", search(10)), call(client, "POST", "/api/searches", search(10))]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 429]);
  });

  it("repetir uma pesquisa respeita os mesmos limites", async () => {
    const failed = await prisma.searchJob.create({
      data: { organizationId: clientOrgId, provider: "GOOGLE_MAPS_SCRAPER", name: "dentista · Umuarama", status: "FAILED", params: { ...search(60), radiusKm: 5 } },
    });
    const r = await call(client, "POST", `/api/searches/${failed.id}/retry`);
    expect(r.statusCode).toBe(429);
  });
});
