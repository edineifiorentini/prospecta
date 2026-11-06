import type { Job } from "bullmq";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { processSearchJob } from "../../src/modules/search/processor.ts";
import { call, closeAll, resetDb, setupAdmin, type Agent } from "./helpers.ts";

/**
 * Busca de empresas na Econodata com a API SIMULADA (ECONODATA_MOCK_MODE=true nos testes): mesmo contrato
 * de search_list/calc_list, sem rede e sem chave real.
 */

let admin: Agent;
const SETTINGS = { enabled: true, autoEnrich: false, autoEnrichMaxPerSearch: 10, buckets: ["cadastro", "estrategico", "perfilNegocio"], minMatchConfidence: 0.85, maxTokensPerCall: 5000, maxDailyRequests: 50, maxDailyTokens: 50000, cacheDays: 30, maxBatchSize: 25 };
const BODY = { provider: "ECONODATA", keyword: "padaria", city: "Umuarama", state: "Paraná", limit: 20, econodata: { buckets: ["cadastro"] } };
const run = (id: string) => processSearchJob({ data: { searchJobId: id } } as Job);
const paid = () => prisma.dataProviderCall.aggregate({ where: { estimateOnly: false, operation: "search_list" }, _count: true, _sum: { tokensCharged: true } });

beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
});
afterAll(closeAll);

describe("busca de empresas na Econodata (simulada)", () => {
  it("começa indisponível: sem dados empresariais ligados, não há prévia nem busca", async () => {
    const pv = await call(admin, "POST", "/api/searches/econodata/preview", BODY);
    expect(pv.statusCode).toBe(200);
    expect(pv.json()).toMatchObject({ enabled: false, total: null });
    const r = await call(admin, "POST", "/api/searches", BODY);
    expect(r.statusCode).toBe(422);
    expect(await prisma.dataProviderCall.count()).toBe(0);
  });

  it("prévia: conta e estima o custo sem trazer empresas nem cobrar por empresa", async () => {
    expect((await call(admin, "PUT", "/api/business-data/settings", SETTINGS)).statusCode).toBe(200);
    const pv = (await call(admin, "POST", "/api/searches/econodata/preview", BODY)).json();
    expect(pv.simulated).toBe(true);
    expect(pv.total).toBeGreaterThan(0);
    expect(pv.willFetch).toBe(Math.min(pv.total, 20));
    expect(pv.tokensEstimated).toBeGreaterThan(0);
    expect(pv.blocked).toBeNull();
    expect((await paid())._count).toBe(0);
    expect(await prisma.company.count()).toBe(0);
  });

  it("busca: grava empresas com CNPJ e cidade, com o perfil empresarial já pago e o consumo registrado", async () => {
    const r = await call(admin, "POST", "/api/searches", BODY);
    expect(r.statusCode).toBe(201);
    await run(r.json().id);
    const job = await prisma.searchJob.findUniqueOrThrow({ where: { id: r.json().id } });
    expect(job.status).toBe("COMPLETED");
    const companies = await prisma.company.findMany({ where: { organizationId: admin.organizationId } });
    expect(companies.length).toBe(job.newCount);
    expect(companies.length).toBeGreaterThan(0);
    expect(companies.length).toBeLessThanOrEqual(20);
    expect(companies.every((c) => !!c.cnpj && c.city === "Umuarama" && c.state === "PR")).toBe(true);
    const profiles = await prisma.companyDataProfile.findMany({ where: { provider: "econodata-mock", identifiedBy: "search_list", status: "MATCHED" } });
    expect(profiles.length).toBe(companies.length);
    const p = await paid();
    expect(p._count).toBeGreaterThan(0);
    expect(p._sum.tokensCharged ?? 0).toBeGreaterThan(0);
    // sem o bloco de contatos, nenhum telefone ou e-mail vem da Econodata
    expect(await prisma.contact.count({ where: { organizationId: admin.organizationId } })).toBe(0);
    const g = await call(admin, "GET", `/api/companies/${companies[0]!.id}/business-data`);
    expect(g.json().data).toMatchObject({ status: "MATCHED", identifiedBy: "search_list" });
  });

  it("repetir a busca não duplica empresas (mesmo CNPJ) nem recobra quem veio nas últimas 24 h", async () => {
    const before = await prisma.company.count();
    const tokensBefore = (await paid())._sum.tokensCharged ?? 0;
    const r = await call(admin, "POST", "/api/searches", BODY);
    await run(r.json().id);
    const job = await prisma.searchJob.findUniqueOrThrow({ where: { id: r.json().id } });
    expect(job.newCount).toBe(0);
    expect(job.duplicateCount).toBe(before);
    expect(await prisma.company.count()).toBe(before);
    const results = await prisma.searchResult.findMany({ where: { searchJobId: job.id } });
    expect(results.every((x) => x.matchedBy === "cnpj")).toBe(true);
    // só a base da página (o simulado cobra 30 por página)
    expect(((await paid())._sum.tokensCharged ?? 0) - tokensBefore).toBeLessThanOrEqual(30);
  });

  it("bloco de contatos não liberado na conta é recusado antes de criar a busca", async () => {
    const r = await call(admin, "POST", "/api/searches", { ...BODY, econodata: { buckets: ["cadastro", "contatosBasicos"] } });
    expect(r.statusCode).toBe(422);
    expect(r.json().message).toContain("contatosBasicos");
  });

  it("custo acima do limite por consulta: a prévia avisa e a busca falha sem cobrar", async () => {
    await call(admin, "PUT", "/api/business-data/settings", { ...SETTINGS, maxTokensPerCall: 10 });
    const pv = (await call(admin, "POST", "/api/searches/econodata/preview", { ...BODY, keyword: "academia" })).json();
    expect(pv.blocked).toContain("limite por consulta");
    const before = (await paid())._count;
    const r = await call(admin, "POST", "/api/searches", { ...BODY, keyword: "academia" });
    await run(r.json().id);
    const job = await prisma.searchJob.findUniqueOrThrow({ where: { id: r.json().id } });
    expect(job.status).toBe("FAILED");
    expect(job.error).toContain("limite por consulta");
    expect((await paid())._count).toBe(before);
    await call(admin, "PUT", "/api/business-data/settings", SETTINGS);
  });

  it("sem resultados: a prévia mostra zero e não estima cobrança", async () => {
    const pv = (await call(admin, "POST", "/api/searches/econodata/preview", { ...BODY, keyword: "nenhuma coisa" })).json();
    expect(pv).toMatchObject({ total: 0, willFetch: 0, tokensEstimated: null, blocked: null });
  });
});
