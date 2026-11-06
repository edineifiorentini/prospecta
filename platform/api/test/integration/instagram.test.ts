import type { Job } from "bullmq";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { redis } from "../../src/lib/redis.ts";
import { processEnrichmentJob } from "../../src/modules/enrichment/service.ts";
import { call, closeAll, resetDb, setupAdmin, type Agent } from "./helpers.ts";

/**
 * Instagram pela API oficial com a Graph API SIMULADA (PUBLIC_DATA_MOCK_MODE=true nos testes): nenhuma chamada sai
 * da máquina e nada é raspado do site do Instagram.
 */

const fetchSpy = vi.spyOn(globalThis, "fetch");
let admin: Agent;
const ids: Record<string, string> = {};

async function company(key: string, body: Record<string, unknown>) {
  const r = await call(admin, "POST", "/api/companies", { city: "Umuarama", state: "PR", ...body });
  expect(r.statusCode).toBe(201);
  ids[key] = r.json().id;
}
const read = (key: string, body: Record<string, unknown> = {}) => call(admin, "POST", `/api/companies/${ids[key]}/instagram`, body);
const runs = () => prisma.integrationRun.count({ where: { source: "instagram", operation: "company", ok: true } });

beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
  await company("site", { name: "Padaria Exemplo", website: "https://www.instagram.com/padariaexemplo/" });
  await company("arvore", { name: "Doceria Linktree", website: "https://www.instagram.com/linktree_doceria/" });
  await company("semnada", { name: "Confeitaria Sem Rede" });
});
afterAll(closeAll);
// o Prospecta se limita a 3 consultas por minuto ao Instagram; cada caso começa com o minuto zerado
const resetMinute = async () => {
  const keys = await redis.keys("pub:rl:instagram:*");
  if (keys.length) await redis.del(...keys);
};
beforeEach(resetMinute);

describe("Instagram (API oficial, simulada)", () => {
  it("site que é o Instagram vira perfil social na gravação", async () => {
    const p = await prisma.socialProfile.findMany({ where: { companyId: ids.site } });
    expect(p).toMatchObject([{ network: "INSTAGRAM", handle: expect.stringMatching(/padariaexemplo/) }]);
  });

  it("começa desligado: nada é consultado", async () => {
    const g = (await call(admin, "GET", `/api/companies/${ids.site}/instagram`)).json();
    expect(g).toMatchObject({ enabled: false });
    const r = await read("site");
    expect(r.statusCode).toBe(400);
    expect(await runs()).toBe(0);
  });

  it("lê a bio: WhatsApp e e-mail entram como contatos 'Instagram (bio)' e o site declarado vira o site", async () => {
    expect((await call(admin, "PUT", "/api/integrations/instagram", { enabled: true })).statusCode).toBe(200);
    const r = await read("site");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ handle: "padariaexemplo", cached: false, added: { whatsapp: 1, emails: 1, website: true } });
    const contacts = await prisma.contact.findMany({ where: { companyId: ids.site, source: "INSTAGRAM" } });
    expect(contacts.map((c) => c.type).sort()).toEqual(["EMAIL", "WHATSAPP"]);
    const c = await prisma.company.findUniqueOrThrow({ where: { id: ids.site } });
    expect(c.website).toBe("https://www.padariaexemplo.com.br/");
    expect(c.domain).toBe("padariaexemplo.com.br");
    const g = (await call(admin, "GET", `/api/companies/${ids.site}/instagram`)).json();
    expect(g.profile.details).toMatchObject({ username: "padariaexemplo", simulated: true, source: "instagram_api" });
    expect(g.profile.details.followersCount).toBeGreaterThan(0);
  });

  it("dentro do cache não consulta de novo; 'Ler de novo' (force) consulta", async () => {
    const before = await runs();
    expect((await read("site")).json()).toMatchObject({ cached: true });
    expect(await runs()).toBe(before);
    expect((await read("site", { force: true })).json()).toMatchObject({ cached: false });
    expect(await runs()).toBe(before + 1);
  });

  it("@ informado à mão e perfil pessoal (não comercial) com mensagem clara", async () => {
    const ok = await read("semnada", { handle: "@confeitaria_sem_rede" });
    expect(ok.statusCode).toBe(200);
    const p = await prisma.socialProfile.findFirstOrThrow({ where: { companyId: ids.semnada, network: "INSTAGRAM" } });
    expect(p).toMatchObject({ source: "MANUAL", handle: "confeitaria_sem_rede" });
    const pessoal = await read("semnada", { handle: "perfil_pessoal", force: true });
    expect(pessoal.statusCode).toBe(404);
    expect(pessoal.json().message).toContain("não é comercial");
    expect((await read("semnada", { handle: "não é um @ válido" })).statusCode).toBe(422);
  });

  it("enriquecer sem site próprio lê o Instagram; link de agregador (linktree) não vira site", async () => {
    const ej = await prisma.enrichmentJob.create({ data: { organizationId: admin.organizationId, companyId: ids.arvore } });
    await processEnrichmentJob({ data: { enrichmentJobId: ej.id } } as Job);
    const job = await prisma.enrichmentJob.findUniqueOrThrow({ where: { id: ej.id } });
    expect(job.status).toBe("COMPLETED");
    expect(JSON.stringify(job.details)).toContain("Instagram @linktree_doceria lido");
    const c = await prisma.company.findUniqueOrThrow({ where: { id: ids.arvore } });
    expect(c.website).toBe("https://www.instagram.com/linktree_doceria/");
    expect(await prisma.contact.count({ where: { companyId: ids.arvore, source: "INSTAGRAM" } })).toBeGreaterThan(0);
  });

  it("token: a Meta confere antes de salvar; o token nunca volta ao navegador", async () => {
    const bad = await call(admin, "PUT", "/api/integrations/instagram/credential", { apiKey: "token_invalida_123456", accountId: "17841400000000001" });
    expect(bad.statusCode).toBe(400);
    expect(await prisma.aiCredential.count({ where: { provider: "instagram" } })).toBe(0);
    expect((await call(admin, "PUT", "/api/integrations/instagram/credential", { apiKey: "token_de_teste_abcd" })).statusCode).toBe(422);
    const ok = await call(admin, "PUT", "/api/integrations/instagram/credential", { apiKey: "token_de_teste_wxyz", accountId: "17841400000000001" });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ hasKey: true, keyHint: "wxyz" });
    const central = (await call(admin, "GET", "/api/integrations")).payload;
    expect(central).not.toContain("token_de_teste_wxyz");
    expect(central).not.toContain("17841400000000001");
  });

  it("limite próprio de 3 consultas por minuto: a quarta é recusada (429) para preservar a cota da Meta", async () => {
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await read("site", { force: true })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
    const last = await prisma.integrationRun.findFirstOrThrow({ where: { source: "instagram" }, orderBy: { createdAt: "desc" } });
    expect(last).toMatchObject({ ok: false, errorCode: "RATE_LIMIT", httpStatus: null });
  });

  it("nenhuma chamada saiu da máquina", () => {
    const external = fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u));
    expect(external).toEqual([]);
  });
});
