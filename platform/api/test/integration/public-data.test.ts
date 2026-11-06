import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma, type Prisma } from "../../src/lib/prisma.ts";
import { runPageSpeed } from "../../src/modules/audit/pagespeed.ts";
import { upsertDiscovered } from "../../src/modules/companies/upsert.ts";
import { withCheckDigits } from "../../src/modules/company-data/cnpj.ts";
import { setPublicFetchForTests } from "../../src/modules/public-data/http.ts";
import { ibgePanel } from "../../src/modules/public-data/ibge.ts";
import { importCaged } from "../../src/modules/public-data/importers/caged.ts";
import { importCvmDfp } from "../../src/modules/public-data/importers/cvm.ts";
import { importReceita } from "../../src/modules/public-data/importers/receita.ts";
import { runImport } from "../../src/modules/public-data/importers/runner.ts";
import { radarSyncFor } from "../../src/modules/public-data/jobs.ts";
import { createPublicDataMock } from "../../src/modules/public-data/mock.ts";
import { call, closeAll, resetDb, setupAdmin, type Agent } from "./helpers.ts";

/**
 * Fontes públicas com o SIMULADO (PUBLIC_DATA_MOCK_MODE=true nos testes): mesmos caminhos e formatos das APIs
 * reais, sem rede. Os cenários numerados seguem a seção 20 da especificação.
 */
let admin: Agent;
let org: string;
const ids: Record<string, string> = {};
const fetchSpy = vi.spyOn(globalThis, "fetch");
const dir = mkdtempSync(join(tmpdir(), "prospecta-publicos-"));

// CNPJs sintéticos válidos
const CNPJ_BASE = withCheckDigits("123456780001"); // na base local, Umuarama
const CNPJ_SANCAO = withCheckDigits("112223330001"); // simulado do Portal: sanção + contratos
const CNPJ_FORA = withCheckDigits("555555550001"); // válido, mas fora do recorte importado

const enable = (id: string, body: Record<string, unknown> = {}) => call(admin, "PUT", `/api/integrations/${id}`, { enabled: true, ...body });

async function company(key: string, body: Record<string, unknown>) {
  const r = await call(admin, "POST", "/api/companies", { city: "Umuarama", state: "PR", ...body });
  expect([200, 201]).toContain(r.statusCode);
  ids[key] = r.json().id;
  return r.json();
}

beforeAll(async () => {
  await resetDb();
  admin = await setupAdmin();
  org = admin.organizationId;
  // recorte sintético da Receita (como se viesse da importação)
  await prisma.rfCodigo.createMany({ data: [{ tipo: "municipio", codigo: "7691", descricao: "UMUARAMA" }, { tipo: "cnae", codigo: "6821801", descricao: "Corretagem na compra e venda e avaliação de imóveis" }, { tipo: "natureza", codigo: "2062", descricao: "Sociedade Empresária Limitada" }] });
  await prisma.rfEmpresa.createMany({ data: [{ cnpjBasico: CNPJ_BASE.slice(0, 8), razaoSocial: "IMOBILIARIA CENTRAL LTDA", naturezaJuridica: "2062", capitalSocial: 50000, porte: "01" }, { cnpjBasico: "98765432", razaoSocial: "CONTABIL ALFA LTDA", porte: "03" }, { cnpjBasico: "87654321", razaoSocial: "PADARIA DUPLA ME", porte: "01" }] });
  await prisma.rfSociosResumo.create({ data: { cnpjBasico: CNPJ_BASE.slice(0, 8), quantidade: 2 } });
  const est = (cnpj: string, nome: string, extra: Record<string, unknown> = {}) => ({ cnpj, cnpjBasico: cnpj.slice(0, 8), nomeFantasia: nome, nomeFolded: nome.toLowerCase(), matrizFilial: "1", situacao: "02", uf: "PR", municipioCodigo: "7691", cnaePrincipal: "6821801", dataInicio: new Date("2016-03-15T12:00:00Z"), ...extra });
  await prisma.rfEstabelecimento.createMany({
    data: [
      est(CNPJ_BASE, "IMOBILIARIA CENTRAL", { telefones: ["4436229000"], emailDominio: "imobcentral.com.br" }),
      est(withCheckDigits("987654320001"), "CONTABIL ALFA", { emailDominio: "contabilalfa.com.br", cnaePrincipal: "6920601" }),
      // dois estabelecimentos com o mesmo telefone (ambíguo)
      est(withCheckDigits("876543210001"), "PADARIA DUPLA", { telefones: ["4436227777"], cnaePrincipal: "1091102" }),
      est(withCheckDigits("876543210002"), "PADARIA DUPLA FILIAL", { telefones: ["4436227777"], matrizFilial: "2", cnaePrincipal: "1091102" }),
      // homônimos: só pelo nome
      est(withCheckDigits("444444440001"), "ESTUDIO HOMONIMO", { cnaePrincipal: "7420001" }),
      est(withCheckDigits("444444450001"), "ESTUDIO HOMONIMO", { cnaePrincipal: "7420001", municipioCodigo: "7691" }),
    ],
  });
}, 120_000);
afterAll(async () => {
  setPublicFetchForTests(null);
  await closeAll();
});

describe("fontes públicas (simuladas)", () => {
  it("20 · integração desativada: nada é consultado", async () => {
    await company("cnpj", { name: "Imobiliária Central", category: "Imobiliária", cnpj: CNPJ_BASE, phone: "(44) 3622-9000" });
    const regional = await call(admin, "GET", `/api/companies/${ids.cnpj}/regional`);
    expect(regional.json()).toMatchObject({ ibge: { enabled: false }, comex: { enabled: false }, caged: { enabled: false }, city: null });
    expect((await call(admin, "POST", `/api/companies/${ids.cnpj}/public-records`, {})).statusCode).toBe(400);
    expect((await call(admin, "POST", `/api/companies/${ids.cnpj}/receita`)).json()).toMatchObject({ code: "DISABLED" });
    expect((await call(admin, "GET", "/api/radar")).json()).toMatchObject({ enabled: false, items: [] });
    expect(await prisma.integrationRun.count()).toBe(0);
    const central = (await call(admin, "GET", "/api/integrations")).json();
    expect(central.sources.find((s: { id: string }) => s.id === "pncp").config.enabled).toBe(false);
    // recursos que já existiam continuam ligados
    expect(central.sources.find((s: { id: string }) => s.id === "brasilapi").config.enabled).toBe(true);
  });

  it("só administradores mudam a central; valores fora do limite são recusados", async () => {
    expect((await call(admin, "PUT", "/api/integrations/ibge", { maxDailyRequests: 0 })).statusCode).toBe(400);
    expect((await call(admin, "PUT", "/api/integrations/naoexiste", { enabled: true })).statusCode).toBe(400);
    for (const id of ["ibge", "comexstat", "caged", "receita_aberta", "transparencia", "cvm", "pncp", "pagespeed"]) expect((await enable(id)).statusCode).toBe(200);
  });

  it("2 · empresa com CNPJ validado: cadastro oficial da base local, gravado com procedência", async () => {
    const r = await call(admin, "POST", `/api/companies/${ids.cnpj}/receita`);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ status: "MATCHED", identifiedBy: "cnpj_known", profile: { legalName: { value: "IMOBILIARIA CENTRAL LTDA", nature: "OFFICIAL" }, registrationStatus: { value: "ATIVA" }, partnersCount: { value: 2 }, primaryCnae: { value: { code: "6821-8/01" } } } });
    const c = await prisma.company.findUniqueOrThrow({ where: { id: ids.cnpj } });
    expect(c.legalName).toBe("IMOBILIARIA CENTRAL LTDA");
    expect(await prisma.companyFieldSource.count({ where: { companyId: ids.cnpj, source: "RECEITA_DADOS_ABERTOS" } })).toBe(2);
    // os indicadores passam a usar o cadastro oficial (CNPJ ativo)
    const intel = (await call(admin, "GET", `/api/companies/${ids.cnpj}/intelligence`)).json();
    const rel = intel.result?.indicators?.RELIABILITY?.criteria ?? intel.indicators?.RELIABILITY?.criteria;
    expect(rel.find((x: { key: string }) => x.key === "rel.registry").result).toBe("MET");
  });

  it("1 · empresa vinda do Google Maps: identificada pelo telefone na mesma cidade", async () => {
    const r = await upsertDiscovered({ organizationId: org, source: "GOOGLE_MAPS_SCRAPER" }, { name: "Imobiliária Central Umuarama", phones: ["+554436229000"], emails: [], city: "Umuarama", state: "PR", googlePlaceId: "ChIJ-teste-1", raw: {} });
    ids.maps = r.companyId;
    // mesmo telefone da empresa já cadastrada: o Prospecta une as duas
    expect(r.matchedBy).toBe("phone");
    expect(r.isNew).toBe(false);
  });

  it("3 · empresa sem CNPJ: vinculada pelo domínio do site; registros públicos exigem CNPJ", async () => {
    await company("semcnpj", { name: "Contábil Alfa", category: "Contabilidade", website: "https://www.contabilalfa.com.br/" });
    expect((await call(admin, "POST", `/api/companies/${ids.semcnpj}/public-records`, {})).statusCode).toBe(422);
    const r = (await call(admin, "POST", `/api/companies/${ids.semcnpj}/receita`)).json();
    expect(r).toMatchObject({ status: "MATCHED", identifiedBy: "match" });
    expect(r.matchedBy).toEqual(expect.arrayContaining(["dominio", "nome"]));
    expect((await prisma.company.findUniqueOrThrow({ where: { id: ids.semcnpj } })).cnpj).toBe(withCheckDigits("987654320001"));
  });

  it("4 · nome ambíguo: só candidatos, nunca vínculo automático; a confirmação vincula", async () => {
    await company("homonimo", { name: "Estúdio Homônimo", category: "Fotografia" });
    const r = (await call(admin, "POST", `/api/companies/${ids.homonimo}/receita`)).json();
    expect(r.status).toBe("CANDIDATES");
    expect(r.candidates).toHaveLength(2);
    expect(r.candidates.every((c: { matchedBy: string[] }) => c.matchedBy.join() === "nome")).toBe(true);
    expect((await call(admin, "POST", `/api/companies/${ids.homonimo}/receita/confirm`, { cnpj: CNPJ_FORA })).statusCode).toBe(422);
    const ok = (await call(admin, "POST", `/api/companies/${ids.homonimo}/receita/confirm`, { cnpj: r.candidates[1].cnpj })).json();
    expect(ok).toMatchObject({ status: "MATCHED", identifiedBy: "manual_choice" });
    // telefone compartilhado por dois estabelecimentos também pede confirmação
    await company("dupla", { name: "Padaria Dupla", phone: "(44) 3622-7777" });
    expect((await call(admin, "POST", `/api/companies/${ids.dupla}/receita`)).json()).toMatchObject({ status: "CANDIDATES" });
  });

  it("5 · registro duplicado: o mesmo CNPJ não cria outra empresa", async () => {
    const r = await call(admin, "POST", "/api/companies", { name: "Imobiliária Central (de novo)", cnpj: CNPJ_BASE, city: "Umuarama", state: "PR" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ id: ids.cnpj, isNew: false });
  });

  it("15 · falhas de correspondência por CNPJ: fora do recorte ou com CNPJ diferente na resposta", async () => {
    await company("fora", { name: "Empresa de Fora", cnpj: CNPJ_FORA });
    expect((await call(admin, "POST", `/api/companies/${ids.fora}/receita`)).json()).toMatchObject({ status: "NOT_FOUND", warnings: [expect.stringMatching(/recorte importado/)] });
    // o Portal devolve um registro de OUTRO CNPJ: não é ligado à empresa
    const mock = createPublicDataMock();
    setPublicFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/ceis")) return new Response(JSON.stringify([{ id: 1, sancionado: { codigoFormatado: withCheckDigits("999999990001") }, tipoSancao: { descricaoResumida: "Outro" } }]), { status: 200 });
      return mock(input, init);
    }) as typeof fetch);
    await call(admin, "PUT", "/api/integrations/transparencia/credential", { apiKey: "chave-de-teste-123456" });
    const r = (await call(admin, "POST", `/api/companies/${ids.fora}/public-records`, { force: true })).json();
    expect(r.records).toEqual([]);
    setPublicFetchForTests(null);
  });

  it("23 · a chave nunca volta ao navegador nem vai para os registros", async () => {
    const secret = "chave-super-secreta-998877";
    const put = await call(admin, "PUT", "/api/integrations/transparencia/credential", { apiKey: secret });
    expect(put.json()).toMatchObject({ hasKey: true, keyHint: "8877" });
    expect(put.body).not.toContain(secret);
    const central = await call(admin, "GET", "/api/integrations");
    expect(central.body).not.toContain(secret);
    const stored = await prisma.aiCredential.findFirstOrThrow({ where: { organizationId: org, provider: "transparencia" } });
    expect(stored.encryptedKey).not.toContain(secret);
  });

  it("CNPJ com registros no Portal: sanção com vigência e contratos federais, em linguagem neutra", async () => {
    await company("sancao", { name: "Empresa Com Registros", cnpj: CNPJ_SANCAO });
    const r = (await call(admin, "POST", `/api/companies/${ids.sancao}/public-records`, {})).json();
    expect(r.records.map((x: { kind: string }) => x.kind).sort()).toEqual(["CEIS", "CONTRATO_FEDERAL", "CONTRATO_FEDERAL"]);
    expect(r.records.find((x: { kind: string }) => x.kind === "CEIS")).toMatchObject({ status: "prazo encerrado", agency: "Prefeitura Simulada (PR)" });
    // cache: a segunda consulta não chama a fonte de novo
    const runs = await prisma.integrationRun.count({ where: { source: "transparencia" } });
    expect((await call(admin, "POST", `/api/companies/${ids.sancao}/public-records`, {})).json().cached).toBe(true);
    expect(await prisma.integrationRun.count({ where: { source: "transparencia" } })).toBe(runs);
  });

  it("11 · token inválido no Portal da Transparência: erro compreensível e registrado", async () => {
    await call(admin, "PUT", "/api/integrations/transparencia/credential", { apiKey: "chave-invalida-000111" });
    const r = await call(admin, "POST", `/api/companies/${ids.sancao}/public-records`, { force: true });
    expect(r.statusCode).toBe(400);
    expect(r.json()).toMatchObject({ code: "AUTH" });
    const run = await prisma.integrationRun.findFirstOrThrow({ where: { source: "transparencia", ok: false }, orderBy: { createdAt: "desc" } });
    expect(run.errorCode).toBe("AUTH");
    expect(JSON.stringify(run)).not.toContain("chave-invalida-000111");
  });

  it("16 · indicador municipal sem dados: 'não disponível', nunca zero", async () => {
    const r = await ibgePanel({ ibge: "4128203", name: "Município Sem Dados", uf: "PR" }, { organizationId: org, cacheDays: 1 });
    expect(r.payload.indicators.every((i) => i.value === null && i.status === "indisponivel")).toBe(true);
  });

  it("indicadores regionais: rotulados como do município, com ano e fonte; o setor da empresa destacado", async () => {
    const r = (await call(admin, "GET", `/api/companies/${ids.cnpj}/regional`)).json();
    expect(r.city).toEqual({ ibge: "4128104", name: "Umuarama", uf: "PR" });
    expect(r.highlightSection).toBe("L");
    expect(r.ibge.data.indicators.find((i: { key: string }) => i.key === "populacao")).toMatchObject({ referenceYear: "2025", table: "6579" });
    expect(r.ibge.data.sectors.length).toBeGreaterThan(5);
    expect(r.comex.data.flows.map((f: { flow: string }) => f.flow)).toEqual(["export", "import"]);
    expect(r.caged.data).toMatchObject({ available: false });
  });

  it("10 · fonte pública fora do ar: as outras continuam", async () => {
    const mock = createPublicDataMock();
    setPublicFetchForTests((async (input: string | URL | Request, init?: RequestInit) => (String(input).includes("/agregados/") ? new Response("{}", { status: 503 }) : mock(input, init))) as typeof fetch);
    await company("curitiba", { name: "Agência Curitiba", city: "Curitiba", state: "PR" });
    const r = (await call(admin, "GET", `/api/companies/${ids.curitiba}/regional?force=true`)).json();
    expect(r.ibge.error).toMatch(/indisponível/);
    expect(r.comex.data.flows).toHaveLength(2);
    setPublicFetchForTests(null);
  }, 60_000);

  it("12 · limite de requisições: 429 da fonte e limite diário da conta", async () => {
    await expect(ibgePanel({ ibge: "9999998", name: "Limite", uf: "PR" }, { organizationId: org, cacheDays: 1 })).rejects.toMatchObject({ code: "RATE_LIMIT" });
    await expect(ibgePanel({ ibge: "4115200", name: "Maringá", uf: "PR" }, { organizationId: org, cacheDays: 1, force: true, maxDaily: 1 })).rejects.toMatchObject({ code: "LIMIT_EXCEEDED" });
  }, 60_000);

  it("21 · consultas iguais ao mesmo tempo viram uma só (e depois saem do cache)", async () => {
    let calls = 0;
    const mock = createPublicDataMock();
    setPublicFetchForTests((async (input: string | URL | Request, init?: RequestInit) => {
      calls++;
      return mock(input, init);
    }) as typeof fetch);
    const city = { ibge: "3550308", name: "São Paulo", uf: "SP" };
    const [a, b] = await Promise.all([ibgePanel(city, { organizationId: org, cacheDays: 1 }), ibgePanel(city, { organizationId: org, cacheDays: 1 })]);
    expect(calls).toBe(4);
    expect([a.cached, b.cached].sort()).toEqual([false, true]);
    expect((await ibgePanel(city, { organizationId: org, cacheDays: 1 })).cached).toBe(true);
    expect(calls).toBe(4);
    setPublicFetchForTests(null);
  }, 60_000);

  it("8/9 · PageSpeed: medição simulada e falhas registradas sem derrubar nada", async () => {
    const ok = await runPageSpeed(org, ids.cnpj, "https://imobcentral.com.br/", "mobile", 100);
    expect(ok).toMatchObject({ strategy: "mobile", simulated: true });
    expect(ok.field?.inpMs).toBeGreaterThan(0);
    await expect(runPageSpeed(org, ids.cnpj, "https://falha.exemplo.com.br/", "mobile", 100)).rejects.toMatchObject({ code: "UNAVAILABLE" });
    await call(admin, "PUT", "/api/integrations/pagespeed/credential", { apiKey: "chave-invalida-pagespeed" });
    await expect(runPageSpeed(org, ids.cnpj, "https://imobcentral.com.br/", "desktop", 100)).rejects.toMatchObject({ code: "AUTH" });
    expect(await prisma.integrationRun.count({ where: { source: "pagespeed", ok: false } })).toBe(2);
  }, 60_000);

  it("17 · empresa sem indicadores financeiros (não é companhia aberta): nada é mostrado", async () => {
    expect((await call(admin, "GET", `/api/companies/${ids.cnpj}/cvm`)).json()).toMatchObject({ enabled: true, data: null });
  });

  it("CVM: importa só o último exercício das contas principais e mostra quando o CNPJ é de companhia aberta", async () => {
    const file = join(dir, "dfp_cia_aberta_DRE_con_2024.csv");
    const header = "CNPJ_CIA;DT_REFER;VERSAO;DENOM_CIA;CD_CVM;GRUPO_DFP;MOEDA;ESCALA_MOEDA;ORDEM_EXERC;DT_INI_EXERC;DT_FIM_EXERC;CD_CONTA;DS_CONTA;VL_CONTA;ST_CONTA_FIXA";
    const row = (ordem: string, conta: string, valor: string) => `${CNPJ_SANCAO.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, "$1.$2.$3/$4-$5")};2024-12-31;1;EMPRESA SA;12345;DF Consolidado;REAL;MIL;${ordem};2024-01-01;2024-12-31;${conta};Conta;${valor};S`;
    writeFileSync(file, Buffer.from([header, row("ÚLTIMO", "3.01", "1500"), row("PENÚLTIMO", "3.01", "1200"), row("ÚLTIMO", "3.11", "-80"), row("ÚLTIMO", "3.02", "999")].join("\n"), "latin1"));
    const r = await importCvmDfp(file);
    expect(r).toMatchObject({ status: "COMPLETED", linesImported: 2 });
    await prisma.cvmCompany.create({ data: { cnpj: CNPJ_SANCAO, name: "EMPRESA SA", status: "ATIVO", sector: "Serviços" } });
    const panel = (await call(admin, "GET", `/api/companies/${ids.sancao}/cvm`)).json();
    expect(panel.data.years[0].items).toEqual(expect.arrayContaining([expect.objectContaining({ accountCode: "3.01", valueBrl: 1_500_000 }), expect.objectContaining({ accountCode: "3.11", valueBrl: -80_000 })]));
  });

  it("13/14 · importação interrompida e retomada: sem perder nem duplicar linhas", async () => {
    const file = join(dir, "codigos.csv");
    writeFileSync(file, Array.from({ length: 25 }, (_, i) => `"T${String(i).padStart(3, "0")}";"Item ${i}"`).join("\n"), "latin1");
    let batches = 0;
    const spec = {
      source: "teste",
      kind: "codigos",
      filePath: file,
      encoding: "latin1" as const,
      delimiter: ";",
      header: false,
      batchSize: 10,
      onBatch: async (rows: string[][], _h: string[] | null, tx: Prisma.TransactionClient) => {
        batches++;
        await tx.rfCodigo.createMany({ data: rows.map((r) => ({ tipo: "teste", codigo: r[0]!, descricao: r[1]! })) });
        if (batches === 2) throw new Error("queda simulada no meio do lote");
        return rows.length;
      },
    };
    const first = await runImport(spec);
    expect(first).toMatchObject({ status: "FAILED", linesImported: 10 });
    // o lote que falhou foi desfeito junto com o checkpoint
    expect(await prisma.rfCodigo.count({ where: { tipo: "teste" } })).toBe(10);
    const second = await runImport(spec);
    expect(second).toMatchObject({ status: "COMPLETED", resumedFrom: 10, linesRead: 25, linesImported: 25 });
    expect(await prisma.rfCodigo.count({ where: { tipo: "teste" } })).toBe(25);
    expect((await runImport(spec)).status).toBe("SKIPPED");
  });

  it("CAGED e Receita: importação com recorte, agregados sem dado pessoal e retomada idempotente", async () => {
    const caged = join(dir, "CAGEDMOV202509.txt");
    const lines = ["competênciamov;região;uf;município;seção;subclasse;saldomovimentação;idade;salário"];
    for (let i = 0; i < 30; i++) lines.push(`202509;4;41;412810;${i % 3 === 0 ? "G" : "L"};4711302;${i % 4 === 0 ? -1 : 1};30;2000,00`);
    lines.push("202509;3;35;355030;G;4711302;1;30;2000,00");
    writeFileSync(caged, lines.join("\n"), "utf8");
    const r = await importCaged(caged, { uf: "PR", batchSize: 7 });
    expect(r).toMatchObject({ status: "COMPLETED", linesImported: 30 });
    const rows = await prisma.laborStat.findMany({ where: { cityCode: "412810" } });
    expect(rows.reduce((s, x) => s + x.hires + x.separations, 0)).toBe(30);
    expect(Object.keys(rows[0]!)).not.toContain("salario");
    expect(await prisma.laborStat.count({ where: { cityCode: "355030" } })).toBe(0);
    // refazer o mesmo arquivo não soma duas vezes
    await importCaged(caged, { uf: "PR", redo: true });
    expect((await prisma.laborStat.findMany({ where: { cityCode: "412810" } })).reduce((s, x) => s + x.hires + x.separations, 0)).toBe(30);

    const est = join(dir, "K3241.ESTABELE");
    const l = (cnpj: string, uf: string) => `"${cnpj.slice(0, 8)}";"${cnpj.slice(8, 12)}";"${cnpj.slice(12)}";"1";"LOJA ${uf}";"02";"20200101";"00";"";"";"20200101";"4711302";"";"RUA";"A";"1";"";"CENTRO";"87500000";"${uf}";"7691";"44";"30304040";"";"";"";"";"contato@loja${uf.toLowerCase()}.com.br";"";""`;
    writeFileSync(est, Buffer.from([l(withCheckDigits("333333330001"), "PR"), l(withCheckDigits("333333340001"), "SP")].join("\n"), "latin1"));
    expect(await importReceita("estabelecimentos", est, { filters: { uf: "PR" } })).toMatchObject({ status: "COMPLETED", linesRead: 2, linesImported: 1 });
    expect(await prisma.rfEstabelecimento.findUnique({ where: { cnpj: withCheckDigits("333333330001") } })).toMatchObject({ emailDominio: "lojapr.com.br", telefones: ["4430304040"] });
    expect(await prisma.rfEstabelecimento.findUnique({ where: { cnpj: withCheckDigits("333333340001") } })).toBeNull();
  });

  it("radar: sincroniza o PNCP da UF, classifica pelos segmentos e separa comprador de lead", async () => {
    expect((await call(admin, "POST", "/api/radar/sync")).statusCode).toBe(422);
    const settings = (await call(admin, "GET", "/api/radar/settings")).json().settings;
    expect((await call(admin, "PUT", "/api/radar/settings", { ...settings, ufs: ["PR"] })).statusCode).toBe(200);
    const sync = await radarSyncFor(org);
    expect(sync.records).toBe(14);
    const r = (await call(admin, "GET", "/api/radar")).json();
    expect(r.enabled).toBe(true);
    // 6 das 7 contratações simuladas combinam com algum segmento; limpeza urbana não
    expect(r.total).toBe(6);
    expect(r.items.some((i: { object: string }) => /limpeza/.test(i.object))).toBe(false);
    expect(r.bySegment).toMatchObject({ marketing: 1, sites: 1, equipamentos: 1, software: 1, manutencao: 1, servicos: 1 });
    expect(r.items[0]).toMatchObject({ buyerName: "MUNICIPIO SIMULADO PR", url: expect.stringMatching(/^https:\/\/pncp\.gov\.br\/app\/editais\//) });
    expect((await call(admin, "GET", "/api/radar?all=true")).json().total).toBe(7);
    expect((await call(admin, "GET", "/api/radar?segment=sites")).json().items).toHaveLength(1);
    // simulado nunca aparece no radar real
    expect(await prisma.publicOpportunity.count({ where: { source: "pncp" } })).toBe(0);
  });

  it("18/19 · score por oferta: independente por produto e sem quebrar com dados incompletos", async () => {
    const offers = [
      { id: "sites", name: "Desenvolvimento de sites", criteriaWeights: { "opp.no_website": 40, "opp.site_gaps": 30 } },
      { id: "alto-custo", name: "Sistema de alto custo", targetSizes: ["GRANDE"], criteriaWeights: { "fit.size": 40 } },
    ];
    expect((await call(admin, "PATCH", "/api/org", { settings: { intelligence: { offers } } })).statusCode).toBe(200);
    const r = (await call(admin, "GET", `/api/companies/${ids.cnpj}/offers`)).json();
    expect(r.offers.map((o: { id: string }) => o.id)).toEqual(["sites", "alto-custo"]);
    expect(r.offers[0].opportunity).not.toBe(r.offers[1].opportunity);
    // empresa quase sem dados: nota nula vira "necessita qualificação", sem erro
    await company("vazia", { name: "Empresa Quase Sem Dados" });
    const v = (await call(admin, "GET", `/api/companies/${ids.vazia}/offers`)).json();
    expect(v.offers[0].priority).toBe("NEEDS_QUALIFICATION");
    // a prioridade A/B/C da conta não mudou por causa das ofertas
    const intel = (await call(admin, "GET", `/api/companies/${ids.cnpj}/intelligence`)).json();
    const opp = intel.result?.indicators?.OPPORTUNITY?.criteria ?? intel.indicators?.OPPORTUNITY?.criteria;
    expect(opp.map((c: { key: string }) => c.key)).not.toContain("opp.no_website");
  });

  it("central: execuções, falhas recentes, uso do dia e teste simulado", async () => {
    const t = (await call(admin, "POST", "/api/integrations/ibge/test")).json();
    expect(t).toMatchObject({ ok: true, simulated: true });
    expect((await call(admin, "POST", "/api/integrations/receita_aberta/test")).json().ok).toBe(true);
    const central = (await call(admin, "GET", "/api/integrations")).json();
    const pagespeed = central.sources.find((s: { id: string }) => s.id === "pagespeed");
    expect(pagespeed.failures30d).toBeGreaterThanOrEqual(2);
    expect(pagespeed.recentErrors[0]).toHaveProperty("errorCode");
    const receita = central.sources.find((s: { id: string }) => s.id === "receita_aberta");
    expect(receita.localBase.records).toBeGreaterThan(0);
  });

  it("24 · nenhuma chamada de rede real nos testes simulados", () => {
    const external = fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => !/^https?:\/\/(127\.0\.0\.1|localhost)/.test(u));
    expect(external).toEqual([]);
  });
});
