import { describe, expect, it, vi } from "vitest";
import { redactSecrets } from "../../src/modules/ai/errors.ts";
import { formatCnpj, isValidCnpj, withCheckDigits } from "../../src/modules/company-data/cnpj.ts";
import { createEconodataClient, siteHost, toEconodataCriteria, withRetry, type EconodataMatchItem } from "../../src/modules/company-data/econodata/client.ts";
import { createEconodataMock, syntheticCnpj } from "../../src/modules/company-data/econodata/mock.ts";
import { normalizeEconodata, type EconodataCompany } from "../../src/modules/company-data/econodata/normalize.ts";
import { decideMatch } from "../../src/modules/company-data/matching.ts";
import { ProviderError } from "../../src/modules/company-data/types.ts";
import { collectFacts, type BusinessSnapshot, type CompanySnapshot } from "../../src/modules/intelligence/evidence.ts";
import { DEFAULT_INTELLIGENCE_CONFIG, scoreCompany } from "../../src/modules/intelligence/scoring.ts";
import { detectSegment } from "../../src/modules/intelligence/segments.ts";
import { businessSnapshot } from "../../src/modules/intelligence/service.ts";

const NOW = new Date("2026-11-03T12:00:00Z");
const CTX = { provider: "econodata", simulated: false, fetchedAt: NOW.toISOString(), buckets: ["cadastro", "estrategico", "perfilNegocio"] };
const client = (key = "ek_live_teste_0001") => createEconodataClient({ apiKey: key, baseUrl: "https://api.econodata.com.br", fetch: createEconodataMock() });
const noSleep = () => Promise.resolve();

describe("CNPJ", () => {
  it("valida dígitos verificadores e formata", () => {
    expect(isValidCnpj("47.960.950/0001-21")).toBe(true);
    expect(isValidCnpj("47.960.950/0001-22")).toBe(false);
    expect(isValidCnpj("11.111.111/1111-11")).toBe(false);
    expect(isValidCnpj(withCheckDigits("123456780001"))).toBe(true);
    expect(formatCnpj("47960950000121")).toBe("47.960.950/0001-21");
    expect(isValidCnpj(syntheticCnpj("qualquer"))).toBe(true);
  });
});

describe("normalização (Econodata → modelo interno)", () => {
  const company: EconodataCompany = {
    cnpj: "47.960.950/0001-21",
    cadastro: { razaoSocial: "EXEMPLO LTDA", nomeFantasia: null, situacao: "ATIVA", dataAbertura: "2010-05-02T00:00:00Z", capitalSocial: 50000, cnaePrimario: { codigo: "L-6821-8/01", descricao: "Corretagem" }, socios: [{ nome: "Fulano", cpf: "***.111.222-**" }, {}] },
    estrategico: { headcountCnpj: { de: 10, ate: 19, origem: "Presumido" }, faturamentoCnpj: { de: 1_000_000, ate: 4_800_000, origem: "RAIS" } },
    perfilNegocio: { porte: "PEQUENO", comercioExterior: { exportacaoAnos: ["2024"], importacaoAnos: [] } },
  };

  it("marca a natureza de cada dado e não guarda dados pessoais dos sócios", () => {
    const p = normalizeEconodata(company, CTX);
    expect(p.cnpj).toBe("47960950000121");
    expect(p.legalName).toMatchObject({ value: "EXEMPLO LTDA", nature: "OFFICIAL", source: "Econodata · cadastro" });
    expect(p.employees).toMatchObject({ value: { min: 10, max: 19, value: null }, nature: "ESTIMATED" });
    expect(p.revenue?.nature).toBe("DECLARED");
    expect(p.size).toMatchObject({ value: "PEQUENO", nature: "ESTIMATED" });
    expect(p.foreignTrade?.value).toEqual({ exportYears: ["2024"], importYears: [] });
    expect(p.foreignTrade?.note).toMatch(/não informa volume/);
    expect(p.partnersCount?.value).toBe(2);
    expect(JSON.stringify(p)).not.toMatch(/Fulano|111\.222/);
  });

  it("campo ausente fica ausente (nunca zero) e contatos só existem quando pedidos", () => {
    const p = normalizeEconodata({ cnpj: "47960950000121", cadastro: { razaoSocial: "X LTDA", capitalSocial: null, nomeFantasia: "" } }, CTX);
    expect(p.shareCapital).toBeUndefined();
    expect(p.tradeName).toBeUndefined();
    expect(p.employees).toBeUndefined();
    expect(p.phones).toBeUndefined();
    expect(p.decisionMakers).toBeUndefined();
    expect(Object.keys(p)).not.toContain("revenue");
  });
});

describe("identificação: nunca vincular por semelhança de nome", () => {
  const empresa = (cidade: string | null, uf: string | null): EconodataCompany => ({ cnpj: "47.960.950/0001-21", cadastro: { cidade, uf } });
  const item = (over: Partial<EconodataMatchItem> = {}): EconodataMatchItem => ({ cnpj: "47.960.950/0001-21", confianca: 0.93, correspondidoEm: ["site", "nome"], razaoSocial: "X LTDA", nomeFantasia: "X", empresa: empresa("Umuarama", "PR"), ...over });
  const company = { city: "Umuarama", state: "PR" };

  it("vincula só com identificador forte, confiança alta, sem empate e mesma cidade", () => {
    expect(decideMatch(company, [item()], 0.85)).toMatchObject({ action: "LINK", cnpj: "47960950000121", confidence: 0.93 });
  });
  it("lista vazia = não encontrada", () => {
    expect(decideMatch(company, [], 0.85)).toEqual({ action: "NOT_FOUND" });
  });
  it("só por nome e UF → pede confirmação, mesmo com confiança alta", () => {
    const d = decideMatch(company, [item({ correspondidoEm: ["nome", "uf"], confianca: 0.99 })], 0.85);
    expect(d).toMatchObject({ action: "ASK" });
    expect(d.action === "ASK" && d.reason).toMatch(/só pelo nome/);
  });
  it("confiança baixa, empate, sem cadastro ou outra cidade → pede confirmação", () => {
    expect(decideMatch(company, [item({ confianca: 0.7 })], 0.85).action).toBe("ASK");
    expect(decideMatch(company, [item(), item({ cnpj: "33.905.522/0001-91", confianca: 0.88 })], 0.85).action).toBe("ASK");
    expect(decideMatch(company, [item({ empresa: undefined })], 0.85).action).toBe("ASK");
    const outra = decideMatch(company, [item({ empresa: empresa("Curitiba", "PR") })], 0.85);
    expect(outra.action === "ASK" && outra.reason).toMatch(/Curitiba/);
    expect(decideMatch(company, [item({ empresa: empresa(null, "SP") })], 0.85).action).toBe("ASK");
  });
});

describe("cliente HTTP (contrato da API v4, contra a Econodata simulada)", () => {
  it("envia Bearer e X-Estimate-Only; a prévia não cobra", async () => {
    const seen: Headers[] = [];
    const mock = createEconodataMock();
    const spy = vi.fn((input: string | URL | Request, init?: RequestInit) => {
      seen.push(new Headers(init?.headers));
      return mock(input, init);
    }) as unknown as typeof fetch;
    const c = createEconodataClient({ apiKey: "ek_live_teste_0001", baseUrl: "https://api.econodata.com.br", fetch: spy });
    const r = await c.lookup("47960950000121", { buckets: ["cadastro", "estrategico"], estimateOnly: true });
    expect(r.data).toEqual({ tokensEstimados: 70 });
    expect(r.meta.tokensCharged).toBe(0);
    expect(seen[0]!.get("authorization")).toBe("Bearer ek_live_teste_0001");
    expect(seen[0]!.get("x-estimate-only")).toBe("true");
  });

  it("consulta paga devolve a empresa e os tokens de X-Tokens-Charged; repetir não recobra", async () => {
    const c = client();
    const first = await c.lookup("47960950000121", { buckets: ["cadastro"] });
    expect("empresa" in first.data && first.data.empresa.cadastro?.situacao).toBe("ATIVA");
    expect(first.meta.tokensCharged).toBe(30);
    expect((await c.lookup("47960950000121", { buckets: ["cadastro"] })).meta.tokensCharged).toBe(0);
  });

  it("critérios do match no formato do fornecedor", () => {
    expect(siteHost("https://www.Exemplo.com.br/contato")).toBe("exemplo.com.br");
    expect(toEconodataCriteria({ name: " Exemplo ", state: "pr", site: "http://www.exemplo.com.br", phone: "" })).toEqual({ nome: "Exemplo", uf: "PR", site: "exemplo.com.br" });
  });

  it("erros viram códigos próprios e a chave nunca aparece", async () => {
    const bad = await client("ek_live_invalida_99887766").balance().catch((e: unknown) => e);
    expect(bad).toBeInstanceOf(ProviderError);
    expect((bad as ProviderError).code).toBe("AUTH");
    expect(JSON.stringify({ m: (bad as ProviderError).message, d: (bad as ProviderError).detail })).not.toContain("99887766");
    await expect(client("ek_live_semsaldo_0001").lookup("47960950000121", { buckets: ["cadastro"] })).rejects.toMatchObject({ code: "INSUFFICIENT_BALANCE", httpStatus: 402 });
    await expect(client().lookup("99000000000191", { buckets: ["cadastro"] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(client().match({ name: "Empresa Indisponivel", site: "indisponivel.test" }, { buckets: [] })).rejects.toMatchObject({ code: "UNAVAILABLE", httpStatus: 503 });
    expect(redactSecrets("Bearer ek_live_abc123456789 recusada")).not.toContain("abc123456789");
  });

  it("429: tenta de novo e segue; persistente: desiste com RATE_LIMIT", async () => {
    const c = client();
    const onRetry = vi.fn();
    const ok = await withRetry(() => c.match({ name: "Empresa Limite", site: "limite.test", state: "PR" }, { buckets: ["cadastro"] }), { sleep: noSleep, onRetry });
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect("correspondencias" in ok.data && ok.data.correspondencias).toHaveLength(1);
    await expect(withRetry(() => c.match({ name: "x", site: "semprelimite.test" }, { buckets: [] }), { sleep: noSleep, maxRetries: 2 })).rejects.toMatchObject({ code: "RATE_LIMIT" });
  });

  it("não repete erros definitivos (401/402/404)", async () => {
    const fn = vi.fn(() => Promise.reject(new ProviderError("AUTH", null, 401)));
    await expect(withRetry(fn, { sleep: noSleep })).rejects.toMatchObject({ code: "AUTH" });
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("indicadores com dados empresariais", () => {
  function snapshot(over: Partial<CompanySnapshot> = {}): CompanySnapshot {
    return {
      id: "c1", name: "Exemplo Serviços", category: null, categories: [], city: "Umuarama", state: "PR", address: "Rua A, 100", website: null, cnpj: null, sourceUrl: "https://maps.google.com/?cid=1", rating: 4.5, reviewCount: 20, publicProfile: {},
      enrichmentStatus: "NOT_STARTED", lastEnrichedAt: null, lastVerifiedAt: null, collectedAt: new Date("2026-11-01"), hasGoogleSource: true,
      contacts: [{ type: "PHONE", value: "+554436221234", normalizedValue: "+554436221234", source: "GOOGLE_MAPS_SCRAPER", sourceUrl: null, status: "FOUND", collectedAt: new Date("2026-11-01"), lastVerifiedAt: null }],
      websites: [], socialProfiles: [], fieldSources: [], auditSignals: null, auditAt: null, duplicateCandidates: [], ...over,
    };
  }
  const business = (over: Partial<BusinessSnapshot> = {}): BusinessSnapshot => ({
    provider: "econodata", simulated: false, fetchedAt: NOW.toISOString(), cnpj: "47960950000121", registrationStatus: "ATIVA", openedAt: "2010-05-02",
    primaryCnae: { code: "L-6821-8/01", description: "Corretagem na compra e venda e avaliação de imóveis" }, size: "PEQUENO",
    employees: { min: 10, max: 19, value: null, nature: "ESTIMATED" }, revenue: { min: 1_000_000, max: 4_800_000, value: null, nature: "ESTIMATED" }, foreignTrade: null, units: null, ...over,
  });
  const run = (s: CompanySnapshot) => scoreCompany(s, collectFacts(s), DEFAULT_INTELLIGENCE_CONFIG, NOW);
  const keys = (r: ReturnType<typeof run>) => Object.values(r.indicators).flatMap((i) => i.criteria.map((c) => c.key));

  it("sem perfil empresarial, nada muda: os critérios novos nem entram no peso", () => {
    const without = run(snapshot());
    expect(keys(without)).not.toContain("fit.size");
    expect(JSON.stringify(run(snapshot({ business: null })).indicators)).toBe(JSON.stringify(without.indicators));
  });

  it("com perfil: CNAE identifica o segmento, porte e equipe pesam e as evidências dizem a natureza", () => {
    const s = snapshot({ business: business() });
    const f = collectFacts(s);
    expect(f.segment).toMatchObject({ field: "cnae" });
    expect(f.evidence.find((e) => e.key === "biz.employees")).toMatchObject({ kind: "INFERRED", label: expect.stringMatching(/10 a 19 \(estimado pelo fornecedor\)/) });
    expect(f.evidence.find((e) => e.key === "biz.registry")?.kind).toBe("OBSERVED");
    const r = run(s);
    const crit = (k: string) => Object.values(r.indicators).flatMap((i) => i.criteria).find((c) => c.key === k)!;
    expect(crit("fit.size").result).toBe("MET");
    expect(crit("opp.scale").result).toBe("MET");
    expect(crit("rel.registry").result).toBe("MET");
    expect(crit("fit.segment").result).toBe("MET");
  });

  it("CNPJ baixado é problema confirmado: alerta e prioridade no máximo C", () => {
    const s = snapshot({ category: "Imobiliária", business: business({ registrationStatus: "BAIXADA" }) });
    const r = run(s);
    expect(["C", "NEEDS_QUALIFICATION"]).toContain(r.priority);
    expect(r.priorityReasons.join(" ")).toMatch(/BAIXADA/);
    expect(collectFacts(s).issues.map((i) => i.code)).toContain("business.inactive");
  });

  it("CNAE de outro segmento não força o segmento; categoria continua tendo preferência", () => {
    expect(detectSegment({ name: "X", category: "Contabilidade", cnae: "L-6821-8/01" })?.segment.id).toBe("contabilidade");
    expect(detectSegment({ name: "X", cnae: "6920-6/01" })?.segment.id).toBe("contabilidade");
    expect(detectSegment({ name: "X", cnae: "4711-3/02" })).toBeNull();
  });

  it("o perfil normalizado vira instantâneo sem contatos nem pessoas", () => {
    const p = normalizeEconodata({ cnpj: "47960950000121", cadastro: { situacao: "ATIVA" }, contatosAvancados: { decisores: { itens: [{ nome: "Pessoa", cargos: ["Diretora"] }] } } }, { ...CTX, buckets: ["cadastro", "contatosAvancados"] });
    expect(JSON.stringify(businessSnapshot(p))).not.toContain("Pessoa");
  });
});
