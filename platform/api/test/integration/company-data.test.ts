import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../src/lib/prisma.ts";
import { redis } from "../../src/lib/redis.ts";
import { withCheckDigits } from "../../src/modules/company-data/cnpj.ts";
import { agentFromLogin, call, closeAll, getApp, resetDb, setupAdmin, type Agent } from "./helpers.ts";

/**
 * Dados empresariais com a Econodata SIMULADA (ECONODATA_MOCK_MODE=true nos testes): o cliente HTTP real
 * fala com uma implementação local do contrato da API v4. Nenhuma chamada sai da máquina.
 */

let admin: Agent;
let other: Agent;
const KNOWN_CNPJ = withCheckDigits("123456780001");
const ids: Record<string, string> = {};

const SETTINGS = { enabled: true, autoEnrich: false, autoEnrichMaxPerSearch: 10, buckets: ["cadastro", "estrategico", "perfilNegocio"], minMatchConfidence: 0.85, maxTokensPerCall: 2000, maxDailyRequests: 50, maxDailyTokens: 20000, cacheDays: 30, maxBatchSize: 3 };

async function company(key: string, body: Record<string, unknown>) {
  const r = await call(admin, "POST", "/api/companies", { city: "Umuarama", state: "PR", ...body });
  expect(r.statusCode).toBe(201);
  ids[key] = r.json().id;
}
const enrich = (key: string, body: Record<string, unknown> = {}, agent = admin) => call(agent, "POST", `/api/companies/${ids[key]}/business-data`, body);
const calls = () => prisma.dataProviderCall.count();

beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
  const acc = await call(admin, "POST", "/api/platform/accounts", { organizationName: "Outra Conta", name: "Outro Dono", email: "outro@dados.test" });
  const token = new URL(acc.json().inviteLink).searchParams.get("token")!;
  await (await getApp()).inject({ method: "POST", url: "/api/auth/reset", payload: { token, password: "senha-de-teste-456" } });
  other = await agentFromLogin("outro@dados.test", "senha-de-teste-456");
  await company("cnpj", { name: "Imobiliária Com CNPJ", category: "Imobiliária", cnpj: KNOWN_CNPJ, phone: "(44) 3622-1234" });
  await company("site", { name: "Contabilidade Exemplo", category: "Contabilidade", website: "contabilidadeexemplo.test" });
  await company("ambigua", { name: "Empresa Ambigua", website: "ambigua.test" });
  await company("naoencontrada", { name: "Empresa Naoencontrada", website: "naoencontrada.test" });
  await company("indisponivel", { name: "Empresa Indisponivel", website: "indisponivel.test" });
  await company("outracidade", { name: "Empresa Outracidade", website: "outracidade.test" });
  await company("limite", { name: "Empresa Limite", website: "limite.test" });
  await company("semdados", { name: "Padaria Sem Consulta", category: "Padaria", phone: "(44) 3622-9999" });
}, 60_000);
afterAll(closeAll);

describe("dados empresariais (Econodata simulada)", () => {
  it("começa desligado: nada é consultado", async () => {
    const g = await call(admin, "GET", `/api/companies/${ids.cnpj}/business-data`);
    expect(g.json()).toMatchObject({ enabled: false, configured: true, simulated: true, data: null });
    expect((await enrich("cnpj")).statusCode).toBe(400);
    expect(await calls()).toBe(0);
  });

  it("só administradores mudam a configuração; o cadastro é bloco obrigatório", async () => {
    expect((await call(admin, "PUT", "/api/business-data/settings", { ...SETTINGS, buckets: ["estrategico"] })).statusCode).toBe(400);
    const r = await call(admin, "PUT", "/api/business-data/settings", SETTINGS);
    expect(r.statusCode).toBe(200);
    expect(r.json().settings.enabled).toBe(true);
  });

  it("prévia de custo não cobra nem conta como consulta", async () => {
    const e = await call(admin, "POST", `/api/companies/${ids.cnpj}/business-data/estimate`);
    expect(e.json()).toMatchObject({ path: "cnpj_known", tokens: 100, blocked: null, simulated: true });
    expect((await prisma.dataProviderCall.findFirstOrThrow()).estimateOnly).toBe(true);
    expect((await call(admin, "GET", "/api/business-data/settings")).json().usage).toEqual({ requests: 0, tokens: 0 });
  });

  it("com CNPJ já validado: consulta direta, natureza de cada dado e nada simulado gravado na empresa", async () => {
    const r = await enrich("cnpj");
    expect(r.statusCode).toBe(200);
    const d = r.json();
    expect(d).toMatchObject({ status: "MATCHED", identifiedBy: "cnpj_known", cnpj: KNOWN_CNPJ, simulated: true, cached: false, tokensCharged: 100 });
    expect(d.profile.registrationStatus).toMatchObject({ value: "ATIVA", nature: "OFFICIAL" });
    expect(d.profile.employees).toMatchObject({ value: { min: 10, max: 19 }, nature: "ESTIMATED" });
    expect(d.profile.phones).toBeUndefined();
    const c = await prisma.company.findUniqueOrThrow({ where: { id: ids.cnpj }, select: { legalName: true } });
    expect(c.legalName).toBeNull();
    expect(await prisma.companyFieldSource.count({ where: { companyId: ids.cnpj, source: "ECONODATA" } })).toBe(0);
  });

  it("cache: repetir não chama o fornecedor; forçar chama de novo", async () => {
    const before = await calls();
    expect((await enrich("cnpj")).json()).toMatchObject({ status: "MATCHED", cached: true });
    expect(await calls()).toBe(before);
    expect((await enrich("cnpj", { force: true })).json()).toMatchObject({ cached: false });
    expect(await calls()).toBeGreaterThan(before);
  });

  it("sem CNPJ: identifica pelo site e só vincula sozinho quando é seguro", async () => {
    const d = (await enrich("site")).json();
    expect(d).toMatchObject({ status: "MATCHED", identifiedBy: "match", matchConfidence: 0.93 });
    expect(d.matchedBy).toContain("site");
  });

  it("ambígua: guarda os candidatos sem dado pago e espera a confirmação de uma pessoa", async () => {
    const d = (await enrich("ambigua")).json();
    expect(d).toMatchObject({ status: "CANDIDATES", profile: null, tokensCharged: 0 });
    expect(d.candidates).toHaveLength(2);
    expect((await call(admin, "POST", `/api/companies/${ids.ambigua}/business-data/confirm`, { cnpj: KNOWN_CNPJ })).statusCode).toBe(400);
    const ok = (await call(admin, "POST", `/api/companies/${ids.ambigua}/business-data/confirm`, { cnpj: d.candidates[1].cnpj })).json();
    expect(ok).toMatchObject({ status: "MATCHED", identifiedBy: "manual_choice", cnpj: d.candidates[1].cnpj });
    expect(await prisma.auditLog.count({ where: { action: "company.data_match_confirmed" } })).toBe(1);
  });

  it("não encontrada e de outra cidade: nenhum vínculo automático", async () => {
    expect((await enrich("naoencontrada")).json()).toMatchObject({ status: "NOT_FOUND", tokensCharged: 0 });
    const outra = (await enrich("outracidade")).json();
    expect(outra.status).toBe("CANDIDATES");
    expect(outra.warnings.join(" ")).toMatch(/Curitiba/);
  });

  it("fornecedor indisponível: registra a falha; 429 passageiro: tenta de novo e conclui", async () => {
    const down = (await enrich("indisponivel")).json();
    expect(down).toMatchObject({ status: "FAILED", errorCode: "UNAVAILABLE" });
    expect((await enrich("limite")).json()).toMatchObject({ status: "MATCHED" });
  }, 30_000);

  it("concorrência: uma consulta por empresa de cada vez", async () => {
    const org = (await prisma.company.findUniqueOrThrow({ where: { id: ids.semdados }, select: { organizationId: true } })).organizationId;
    await redis.set(`cdata:lock:${org}:${ids.semdados}`, "1", "EX", 30);
    expect((await enrich("semdados")).statusCode).toBe(409);
    await redis.del(`cdata:lock:${org}:${ids.semdados}`);
  });

  it("limites da conta: por consulta e por dia, antes de qualquer cobrança", async () => {
    await call(admin, "PUT", "/api/business-data/settings", { ...SETTINGS, maxTokensPerCall: 50 });
    const perCall = await enrich("cnpj", { force: true });
    expect(perCall.statusCode).toBe(429);
    expect(perCall.json().message).toMatch(/acima do limite por consulta/);
    const used = (await call(admin, "GET", "/api/business-data/settings")).json().usage.requests;
    await call(admin, "PUT", "/api/business-data/settings", { ...SETTINGS, maxDailyRequests: used });
    const daily = await enrich("cnpj", { force: true });
    expect(daily.statusCode).toBe(429);
    expect(daily.json().message).toMatch(/Limite diário/);
    await call(admin, "PUT", "/api/business-data/settings", SETTINGS);
  });

  it("chave por conta: inválida não é salva, válida fica cifrada e nunca volta; saldo zerado vira erro claro", async () => {
    const bad = await call(admin, "PUT", "/api/business-data/credential", { apiKey: "ek_live_invalida_0000111" });
    expect(bad.statusCode).toBe(422);
    expect(bad.body).not.toContain("0000111");
    expect(await prisma.aiCredential.count({ where: { provider: "econodata" } })).toBe(0);

    const good = await call(admin, "PUT", "/api/business-data/credential", { apiKey: "ek_live_conta_admin_5678" });
    expect(good.json()).toMatchObject({ credential: { hasKey: true, keyHint: "5678" }, balance: 50000 });
    const row = await prisma.aiCredential.findFirstOrThrow({ where: { provider: "econodata" } });
    expect(row.encryptedKey).not.toContain("conta_admin");
    expect((await call(admin, "GET", "/api/business-data/settings")).body).not.toContain("conta_admin");

    await call(admin, "PUT", "/api/business-data/credential", { apiKey: "ek_live_semsaldo_9999" });
    const noBalance = (await enrich("semdados")).json();
    expect(noBalance).toMatchObject({ status: "FAILED", errorCode: "INSUFFICIENT_BALANCE" });
    expect((await call(admin, "DELETE", "/api/business-data/credential")).json()).toMatchObject({ removed: true });

    const everything = JSON.stringify([await prisma.auditLog.findMany(), await prisma.dataProviderCall.findMany(), await prisma.companyDataProfile.findMany()]);
    expect(everything).not.toMatch(/conta_admin|semsaldo_9999|invalida_0000111/);
  });

  it("lote: vai para a fila, respeita o tamanho máximo e ignora empresas de outra conta", async () => {
    const foreign = (await call(other, "POST", "/api/companies", { name: "Empresa da Outra Conta" })).json().id;
    const r = await call(admin, "POST", "/api/business-data/batch", { companyIds: [ids.site, ids.semdados, foreign] });
    expect(r.json()).toEqual({ queued: 2, ignored: 1 });
    expect((await call(admin, "POST", "/api/business-data/batch", { companyIds: [ids.site, ids.semdados, ids.cnpj, ids.limite] })).statusCode).toBe(400);
  });

  it("automático: desligado não enfileira; ligado pega só empresas novas da busca com CNPJ ou site, sem perfil", async () => {
    const { autoEnrichAfterSearch } = await import("../../src/modules/company-data/service.ts");
    const org = (await prisma.company.findUniqueOrThrow({ where: { id: ids.site }, select: { organizationId: true } })).organizationId;
    await company("auto-site", { name: "Agência Nova Busca", website: "agencianova.test" });
    await company("auto-sem", { name: "Sem Site Nem CNPJ" });
    const job = await prisma.searchJob.create({ data: { organizationId: org, provider: "GOOGLE_MAPS_SCRAPER", name: "busca", status: "COMPLETED", params: {} } });
    await prisma.searchResult.createMany({
      data: [
        { searchJobId: job.id, companyId: ids["auto-site"], position: 1, title: "a", isNew: true },
        { searchJobId: job.id, companyId: ids["auto-sem"], position: 2, title: "b", isNew: true },
        { searchJobId: job.id, companyId: ids.site, position: 3, title: "c", isNew: true }, // já tem perfil
      ],
    });
    expect(await autoEnrichAfterSearch(org, job.id)).toBe(0);
    await call(admin, "PUT", "/api/business-data/settings", { ...SETTINGS, autoEnrich: true });
    expect(await autoEnrichAfterSearch(org, job.id)).toBe(1);
    await call(admin, "PUT", "/api/business-data/settings", SETTINGS);
  });

  it("outra conta não vê os dados empresariais da primeira", async () => {
    expect((await call(other, "GET", `/api/companies/${ids.cnpj}/business-data`)).statusCode).toBe(404);
    expect((await call(other, "POST", `/api/companies/${ids.cnpj}/business-data`, {})).statusCode).toBeGreaterThanOrEqual(400);
    expect((await call(other, "GET", "/api/business-data/settings")).json()).toMatchObject({ settings: { enabled: false }, credential: { hasKey: false } });
  });

  it("indicadores: critérios novos só nas empresas enriquecidas, com evidências da Econodata", async () => {
    const withData = (await call(admin, "GET", `/api/companies/${ids.cnpj}/intelligence`)).json();
    const keys = (b: { indicators: Record<string, { criteria: { key: string }[] }> }) => Object.values(b.indicators).flatMap((i) => i.criteria.map((c) => c.key));
    expect(keys(withData)).toEqual(expect.arrayContaining(["fit.size", "opp.scale", "rel.registry"]));
    expect(withData.evidence.find((e: { key: string }) => e.key === "biz.registry")).toMatchObject({ source: "ECONODATA_SIMULATED" });
    expect(withData.issues.map((i: { code: string }) => i.code)).toContain("business.simulated");
    const without = (await call(admin, "GET", `/api/companies/${ids.semdados}/intelligence`)).json();
    expect(keys(without)).not.toContain("fit.size");
  });
});
