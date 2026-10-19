import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Job } from "bullmq";
import { prisma } from "../../src/lib/prisma.ts";
import { redis } from "../../src/lib/redis.ts";
import { processSearchJob, csvRowsKey } from "../../src/modules/search/processor.ts";
import { applyRetention } from "../../src/modules/maintenance/tasks.ts";
import { call, closeAll, resetDb, setupAdmin, type Agent } from "./helpers.ts";

let admin: Agent;
beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
});
afterAll(closeAll);

describe("empresas, deduplicação e CRM", () => {
  it("cadastro manual deduplica por domínio + nome", async () => {
    const a = await call(admin, "POST", "/api/companies", { name: "Padaria Pão Bom", website: "https://paobom.com.br", city: "Campinas", phone: "(19) 3333-4444" });
    expect(a.statusCode).toBe(201);
    const b = await call(admin, "POST", "/api/companies", { name: "Padaria Pão Bom LTDA", website: "http://www.paobom.com.br/contato", city: "Campinas" });
    expect(b.statusCode).toBe(200);
    expect(b.json()).toMatchObject({ id: a.json().id, isNew: false, matchedBy: "domain" });
  });

  it("edição registra histórico e procedência manual", async () => {
    const list = await call(admin, "GET", "/api/companies?q=Pão");
    const id = list.json().items[0].id;
    const r = await call(admin, "PATCH", `/api/companies/${id}`, { category: "Padaria" });
    expect(r.json().changed).toBe(1);
    const detail = (await call(admin, "GET", `/api/companies/${id}`)).json();
    expect(detail.provenance.category).toMatchObject({ source: "MANUAL", status: "VERIFIED" });
    const timeline = (await call(admin, "GET", `/api/companies/${id}/timeline`)).json();
    expect(timeline.some((a: { type: string }) => a.type === "FIELD_CHANGE")).toBe(true);
  });

  it("exportação CSV neutraliza fórmulas", async () => {
    await call(admin, "POST", "/api/companies", { name: "=HYPERLINK(\"http://x\")", city: "Campinas" });
    const r = await call(admin, "GET", "/api/companies/export.csv");
    expect(r.statusCode).toBe(200);
    expect(r.body).toContain("'=HYPERLINK");
    expect(r.body).not.toMatch(/\n"?=HYPERLINK/);
  });

  it("envia ao CRM, move etapas e registra atividades", async () => {
    const ids = (await call(admin, "GET", "/api/companies")).json().items.map((c: { id: string }) => c.id);
    const bulk = await call(admin, "POST", "/api/deals/bulk", { companyIds: ids });
    expect(bulk.json().created).toBe(ids.length);
    expect((await call(admin, "POST", "/api/deals/bulk", { companyIds: ids })).json().created).toBe(0);
    const pipelines = (await call(admin, "GET", "/api/pipelines")).json();
    const stages = pipelines[0].stages;
    expect(stages.map((s: { name: string }) => s.name)).toContain("Contato autorizado");
    const deal = (await call(admin, "GET", "/api/deals")).json().deals[0];
    const won = stages.find((s: { kind: string }) => s.kind === "WON");
    const moved = await call(admin, "PATCH", `/api/deals/${deal.id}`, { stageId: won.id, position: 1, valueCents: 150000 });
    expect(moved.json().status).toBe("WON");
    const history = (await call(admin, "GET", `/api/deals/${deal.id}/history`)).json();
    expect(history.some((h: { type: string }) => h.type === "STAGE_CHANGE")).toBe(true);
  });

  it("etapas personalizadas: cria, reordena e remove movendo negociações", async () => {
    const p = (await call(admin, "GET", "/api/pipelines")).json()[0];
    expect((await call(admin, "POST", `/api/pipelines/${p.id}/stages`, { name: "Diagnóstico enviado" })).statusCode).toBe(201);
    const after = (await call(admin, "GET", "/api/pipelines")).json()[0];
    const created = after.stages.find((s: { name: string }) => s.name === "Diagnóstico enviado");
    expect(created.position).toBeLessThan(after.stages.find((s: { kind: string }) => s.kind === "WON").position);
    const reversed = [...after.stages].reverse().map((s: { id: string }) => s.id);
    expect((await call(admin, "POST", `/api/pipelines/${p.id}/reorder`, { stageIds: reversed })).statusCode).toBe(200);
    expect((await call(admin, "DELETE", `/api/stages/${created.id}`, {})).statusCode).toBe(200);
  });

  it("tarefas, anotações e ligações aparecem na linha do tempo", async () => {
    const company = (await call(admin, "GET", "/api/companies")).json().items[0];
    expect((await call(admin, "POST", "/api/tasks", { title: "Retornar ligação", companyId: company.id, dueAt: new Date(Date.now() - 60_000).toISOString() })).statusCode).toBe(201);
    expect((await call(admin, "GET", "/api/tasks/summary")).json().overdue).toBe(1);
    expect((await call(admin, "POST", `/api/companies/${company.id}/notes`, { body: "Prefere contato pela manhã." })).statusCode).toBe(201);
    expect((await call(admin, "POST", "/api/activities", { companyId: company.id, type: "CALL", title: "Ligação", outcome: "NO_ANSWER", durationMin: 2 })).statusCode).toBe(201);
    const types = (await call(admin, "GET", `/api/companies/${company.id}/timeline`)).json().map((a: { type: string }) => a.type);
    expect(types).toEqual(expect.arrayContaining(["TASK", "NOTE", "CALL"]));
  });
});

describe("importação CSV pela fila", () => {
  it("importa, filtra e deduplica com procedência", async () => {
    const job = await prisma.searchJob.create({
      data: {
        organizationId: admin.organizationId,
        createdById: admin.userId,
        provider: "CSV_IMPORT",
        name: "Importação: teste.csv",
        params: { fileName: "teste.csv", format: "generic", mapping: { name: "nome", phone: "telefone", website: "site", city: "cidade" }, totalRows: 3, filters: { website: "any", phone: "with", email: "any" }, saveOnlyMatching: true },
      },
    });
    await redis.set(
      csvRowsKey(job.id),
      JSON.stringify([
        { nome: "Academia Força", telefone: "(19) 99999-1111", site: "forca.com.br", cidade: "Campinas" },
        { nome: "Academia Sem Telefone", telefone: "", site: "", cidade: "Campinas" },
        { nome: "Padaria Pão Bom", telefone: "(19) 3333-4444", site: "paobom.com.br", cidade: "Campinas" },
      ]),
    );
    await processSearchJob({ data: { searchJobId: job.id } } as Job);
    const done = await prisma.searchJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(done.status).toBe("COMPLETED");
    expect(done.newCount).toBe(1);
    expect(done.duplicateCount).toBe(1);
    expect((done.progress as { filteredOut: number }).filteredOut).toBe(1);
    const company = await prisma.company.findFirstOrThrow({ where: { name: "Academia Força" }, include: { leadSources: true, contacts: true, scores: true } });
    expect(company.leadSources[0]!.sourceType).toBe("CSV_IMPORT");
    expect(company.contacts[0]!.normalizedValue).toBe("+5519999991111");
    expect(company.scores.find((s) => s.kind === "DATA_QUALITY")).toBeTruthy();
  });

  it("retenção limpa registros brutos antigos", async () => {
    await prisma.leadSource.updateMany({ data: { collectedAt: new Date(Date.now() - 400 * 86400_000) } });
    const r = await applyRetention();
    expect(r.rawCleared).toBeGreaterThan(0);
  });
});
