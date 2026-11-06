import { describe, expect, it } from "vitest";
import { buildDiagnostics } from "../../src/modules/audit/diagnostics.ts";
import { asLighthouse, parsePsi, runPageSpeed } from "../../src/modules/audit/pagespeed.ts";
import { detectTechnologies } from "../../src/modules/audit/technologies.ts";
import { checkTls } from "../../src/modules/audit/tls.ts";
import type { CrawlResult } from "../../src/modules/enrichment/crawler.ts";
import { collectFacts, type CompanySnapshot } from "../../src/modules/intelligence/evidence.ts";
import { DEFAULT_INTELLIGENCE_CONFIG, INTELLIGENCE_CRITERIA, scoreCompany } from "../../src/modules/intelligence/scoring.ts";
import { offerConfig } from "../../src/modules/intelligence/service.ts";
import { DEFAULT_RADAR_SEGMENTS } from "../../src/modules/orgs/settings.ts";
import { summarize } from "../../src/modules/public-data/comex.ts";
import { SourceError, withRetry } from "../../src/modules/public-data/http.ts";
import { parseIbgeValue, sectionOfCnae } from "../../src/modules/public-data/ibge.ts";
import { cagedColumns } from "../../src/modules/public-data/importers/caged.ts";
import { dfpFileInfo } from "../../src/modules/public-data/importers/cvm.ts";
import { toEstabelecimento } from "../../src/modules/public-data/importers/receita.ts";
import { columnSkeleton, parseCsvLine } from "../../src/modules/public-data/importers/runner.ts";
import { classify, toOpportunity } from "../../src/modules/public-data/pncp.ts";
import { brDay, fromContrato, fromSancao, sanctionStatus } from "../../src/modules/public-data/transparencia.ts";

describe("IBGE", () => {
  it("segue as convenções de valor (zero, sigilo, indisponível)", () => {
    expect(parseIbgeValue("124077")).toEqual({ value: 124077, status: "ok" });
    expect(parseIbgeValue("-")).toEqual({ value: 0, status: "zero" });
    expect(parseIbgeValue("X")).toEqual({ value: null, status: "sigilo" });
    expect(parseIbgeValue("...")).toEqual({ value: null, status: "indisponivel" });
    expect(parseIbgeValue(undefined)).toEqual({ value: null, status: "indisponivel" });
  });
  it("leva a CNAE da empresa à seção do CEMPRE (só para destacar o setor)", () => {
    expect(sectionOfCnae("6821-8/01")).toBe("L");
    expect(sectionOfCnae("7311-4/00")).toBe("M");
    expect(sectionOfCnae("4711302")).toBe("G");
    expect(sectionOfCnae(null)).toBeNull();
  });
});

describe("Comex Stat", () => {
  it("resume por ano, compara o acumulado com o mesmo período e lista produtos e países", () => {
    const rows = [
      { year: "2025", monthNumber: "01", headingCode: "0207", heading: "Carnes", metricFOB: "100", metricKG: "10" },
      { year: "2025", monthNumber: "02", headingCode: "0207", heading: "Carnes", metricFOB: "100", metricKG: "10" },
      { year: "2025", monthNumber: "03", headingCode: "4104", heading: "Couros", metricFOB: "50", metricKG: "5" },
      { year: "2026", monthNumber: "01", headingCode: "0207", heading: "Carnes", metricFOB: "150", metricKG: "15" },
      { year: "2026", monthNumber: "02", headingCode: "0207", heading: "Carnes", metricFOB: "150", metricKG: "15" },
    ];
    const s = summarize("export", rows, [{ year: "2025", country: "China", metricFOB: "200", metricKG: "20" }], 2025, 2026, 2);
    expect(s.years).toEqual([
      { year: "2025", fob: 250, kg: 25, partial: false },
      { year: "2026", fob: 300, kg: 30, partial: true },
    ]);
    // jan+fev de 2026 (300) contra jan+fev de 2025 (200)
    expect(s.ytd).toMatchObject({ fob: 300, previousFob: 200, changePct: 50 });
    expect(s.topProducts[0]).toMatchObject({ code: "0207", fob: 200 });
    expect(s.topCountries).toEqual([{ name: "China", fob: 200 }]);
  });
  it("sem registros: nada de zero inventado", () => {
    const s = summarize("import", [], [], 2025, 2026, 9);
    expect(s.years).toEqual([]);
    expect(s.ytd).toBeNull();
  });
});

describe("PNCP", () => {
  it("classifica pelo segmento com palavra inteira e sem acento", () => {
    const seg = DEFAULT_RADAR_SEGMENTS;
    expect(classify("contratacao de agencia de publicidade e propaganda", seg).map((s) => s.id)).toEqual(["marketing"]);
    expect(classify("desenvolvimento de site institucional", seg).map((s) => s.id)).toContain("sites");
    // "site" dentro de outra palavra não conta
    expect(classify("aquisicao de requisitos e suprimentos", seg)).toEqual([]);
    expect(classify("agencia de publicidade", seg.map((s) => ({ ...s, enabled: s.id !== "marketing" })))).toEqual([]);
  });
  it("converte a contratação com fuso de Brasília e link público do edital", () => {
    const o = toOpportunity({ numeroControlePNCP: "76247378000156-1-000180/2026", objetoCompra: "Seguro predial", orgaoEntidade: { cnpj: "76247378000156", razaoSocial: "MUNICIPIO DE UMUARAMA" }, anoCompra: 2026, sequencialCompra: 180, dataEncerramentoProposta: "2026-11-12T08:00:00", valorTotalEstimado: null, unidadeOrgao: { ufSigla: "PR", codigoIbge: "4128104" } })!;
    expect(new Date(o.proposalClosesAt!).toISOString()).toBe("2026-11-12T11:00:00.000Z");
    expect(o.url).toBe("https://pncp.gov.br/app/editais/76247378000156/2026/180");
    expect(o.estimatedValue).toBeNull();
    expect(o.objectFolded).toBe("seguro predial");
  });
});

describe("Portal da Transparência", () => {
  it("lê datas dd/mm/aaaa e diz se a sanção ainda vale, sem juízo de valor", () => {
    expect(brDay("15/03/2023")?.toISOString().slice(0, 10)).toBe("2023-03-15");
    const now = new Date("2026-11-05T12:00:00Z");
    expect(sanctionStatus(brDay("15/03/2023"), now)).toBe("prazo encerrado");
    expect(sanctionStatus(brDay("15/03/2030"), now)).toBe("vigente");
    expect(sanctionStatus(null, now)).toBe("sem data de término informada");
    const r = fromSancao("CNEP", { id: 7, dataInicioSancao: "01/02/2024", dataFimSancao: "01/02/2025", tipoSancao: { descricaoResumida: "Multa" }, orgaoSancionador: { nome: "CGU", siglaUf: "DF" }, valorMulta: "12.345,67" }, now);
    expect(r).toMatchObject({ kind: "CNEP", agency: "CGU (DF)", recordType: "Multa", status: "prazo encerrado", value: 12345.67 });
    expect(fromContrato({ id: 9, numero: "1/2025", objeto: "Suporte", valorFinalCompra: 1000, unidadeGestora: { orgaoMaximo: { nome: "Ministério" } } })).toMatchObject({ kind: "CONTRATO_FEDERAL", agency: "Ministério", value: 1000, description: "Contrato 1/2025: Suporte" });
  });
});

describe("Auditoria: tecnologias, PageSpeed, TLS e diagnóstico", () => {
  it("detecta tecnologias por assinatura (e não inventa ausência)", () => {
    const html = `<meta name="generator" content="WordPress 6.6"><script async src="https://www.googletagmanager.com/gtag/js?id=G-ABC123"></script><script>fbq('init','1')</script><script src="https://embed.tawk.to/x/y"></script>`;
    const names = detectTechnologies(html).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(["WordPress", "Google Analytics 4", "Meta Pixel", "Tawk.to"]));
    expect(detectTechnologies("<html><body>Olá</body></html>")).toEqual([]);
  });
  it("lê o PageSpeed (CLS do CrUX vem multiplicado por 100) e vira resumo do Lighthouse com a origem", () => {
    const r = parsePsi({ lighthouseResult: { categories: { performance: { score: 0.42 }, seo: { score: 0.9 } }, audits: { "largest-contentful-paint": { numericValue: 3456.7 } } }, loadingExperience: { metrics: { INTERACTION_TO_NEXT_PAINT: { percentile: 250, category: "AVERAGE" }, CUMULATIVE_LAYOUT_SHIFT_SCORE: { percentile: 12, category: "AVERAGE" } } } }, "mobile", "https://exemplo.com.br/", false);
    expect(r).toMatchObject({ performance: 0.42, seo: 0.9, lcpMs: 3457 });
    expect(r.field).toMatchObject({ inpMs: 250, cls: 0.12 });
    expect(asLighthouse(r)).toMatchObject({ performance: 0.42, source: "pagespeed", formFactor: "mobile" });
    expect(parsePsi({ lighthouseResult: {} }, "desktop", "https://x.com/", false).field).toBeNull();
  });
  it.each(["http://127.0.0.1/", "http://169.254.169.254/latest/meta-data/", "http://localhost:4000/", "http://postgres:5432/"])("bloqueia SSRF no PageSpeed e no TLS: %s", async (url) => {
    await expect(runPageSpeed("org", null, url, "mobile", 10)).rejects.toMatchObject({ code: "BLOCKED" });
    expect((await checkTls(url)).checked).toBe(false);
  });
  it("domínio inexistente: TLS não verificado, sem quebrar", async () => {
    const t = await checkTls("https://dominio-que-nao-existe-prospecta.invalid/");
    expect(t).toMatchObject({ checked: false, valid: null });
  });

  const crawl = (over: Partial<CrawlResult> = {}): CrawlResult => ({
    startUrl: "http://exemplo.test/",
    finalUrl: "https://exemplo.test/",
    reachable: true,
    httpStatus: 200,
    https: true,
    httpRedirectsToHttps: false,
    httpsAvailable: true,
    responseTimeMs: 300,
    robots: { found: true, allowedHome: true, blocked: [], sitemaps: [] },
    sitemapFound: false,
    pages: [{ canonical: null, technologies: [{ name: "Wix", category: "cms", evidence: "static.wixstatic.com" }] } as never],
    method: "cheerio",
    errors: [],
    blockedReason: null,
    robotsAllows: () => true,
    ...over,
  });
  it("só aponta achados comprovados, com gravidade, fonte e por que pode ser oportunidade", () => {
    const d = buildDiagnostics({
      crawl: crawl(),
      tls: { checked: true, valid: false, error: "CERT_HAS_EXPIRED", issuer: null, validTo: null, daysLeft: -3, protocol: "TLSv1.3" },
      lighthouse: null,
      pagespeed: { enabled: true, mobile: { strategy: "mobile", performance: 0.25, seo: 0.6, accessibility: null, bestPractices: null, lcpMs: 7000, cls: 0.3, tbtMs: 900, fcpMs: 3000, field: { overall: "SLOW", originFallback: false, inpMs: 600, inpCategory: "SLOW", lcpMs: 6000, lcpCategory: "SLOW", cls: 0.3, clsCategory: "SLOW" }, finalUrl: "https://exemplo.test/", fetchedAt: "", simulated: true }, desktop: null, error: null },
    });
    const keys = d.findings.map((f) => f.key);
    expect(keys).toEqual(expect.arrayContaining(["https.redirecionamento", "tls.invalido", "seo.canonical", "perf.celular", "campo.lcp", "campo.inp", "seo.nota"]));
    expect(d.findings[0]!.severity).toBe("alta");
    for (const f of d.findings) {
      expect(f.opportunity.length).toBeGreaterThan(20);
      expect(f.opportunity).not.toMatch(/precisa contratar/i);
    }
    expect(d.technologies.map((t) => t.name)).toEqual(["Wix"]);
    // tecnologia ausente nunca vira achado
    expect(keys.some((k) => /analytics|pixel|tecnolog/.test(k))).toBe(false);
  });
  it("site que não responde: nenhum achado de site, nada inventado", () => {
    const d = buildDiagnostics({ crawl: crawl({ reachable: false, pages: [], https: false, httpsAvailable: null, httpRedirectsToHttps: null }), tls: null, lighthouse: null, pagespeed: { enabled: false, mobile: null, desktop: null, error: null } });
    expect(d.findings).toEqual([]);
    expect(d.pagesRead).toBe(0);
  });
});

describe("Importação de arquivos públicos", () => {
  it("lê CSV com aspas e separador da Receita", () => {
    expect(parseCsvLine(`"00000000";"BANCO DO BRASIL; SA";"2038";"10";"120000,00";"05";""`, ";")).toEqual(["00000000", "BANCO DO BRASIL; SA", "2038", "10", "120000,00", "05", ""]);
    expect(parseCsvLine(`a;"b ""c""";d`, ";")).toEqual(["a", 'b "c"', "d"]);
  });
  it("estabelecimento: aplica o recorte e guarda só o domínio do e-mail (minimização)", () => {
    const line = parseCsvLine(`"12345678";"0001";"95";"1";"PADARIA PAO BOM";"02";"20150101";"00";"";"";"20100315";"1091102";"4721102,5611201";"RUA";"DAS FLORES";"10";"";"CENTRO";"87501000";"PR";"7691";"44";"36221234";"";"";"";"";"Joao.Silva@PadariaPaoBom.com.br";"";""`, ";");
    const e = toEstabelecimento(line, { uf: "PR" })!;
    expect(e).toMatchObject({ cnpj: "12345678000195", situacao: "02", cnaePrincipal: "1091102", telefones: ["4436221234"], emailDominio: "padariapaobom.com.br", uf: "PR" });
    expect(JSON.stringify(e)).not.toMatch(/joao/i);
    expect(toEstabelecimento(line, { uf: "SP" })).toBeNull();
    // e-mail de provedor genérico não serve para identificar
    expect(toEstabelecimento(line.map((v, i) => (i === 27 ? "fulano@gmail.com" : v)), {})!.emailDominio).toBeNull();
  });
  it("acha as colunas do CAGED mesmo com o arquivo lido na codificação errada", () => {
    expect(columnSkeleton("seção")).toBe("seo");
    const utf8 = cagedColumns(["competênciamov", "região", "uf", "município", "seção", "subclasse", "saldomovimentação"]);
    const latin1 = cagedColumns(["competÃªnciamov", "regiÃ£o", "uf", "municÃ­pio", "seÃ§Ã£o", "subclasse", "saldomovimentaÃ§Ã£o"]);
    expect(utf8).toEqual({ period: 0, city: 3, section: 4, balance: 6 });
    expect(latin1).toEqual(utf8);
    expect(() => cagedColumns(["a", "b"])).toThrow(/sem as colunas/);
  });
  it("reconhece os arquivos da DFP", () => {
    expect(dfpFileInfo("dfp_cia_aberta_DRE_con_2024.csv")).toEqual({ statement: "DRE", consolidated: true, year: 2024 });
    expect(dfpFileInfo("outro.csv")).toBeNull();
  });
});

describe("Nova tentativa", () => {
  it("tenta de novo em 429/indisponível e desiste em erro de chave", async () => {
    let n = 0;
    const ok = await withRetry(
      async () => {
        if (++n < 3) throw new SourceError("RATE_LIMIT", null, 429, 0);
        return "ok";
      },
      { sleep: async () => {} },
    );
    expect([ok, n]).toEqual(["ok", 3]);
    let m = 0;
    await expect(
      withRetry(
        async () => {
          m++;
          throw new SourceError("AUTH");
        },
        { sleep: async () => {} },
      ),
    ).rejects.toMatchObject({ code: "AUTH" });
    expect(m).toBe(1);
  });
});

describe("Score: critérios opcionais e ofertas", () => {
  const snap = (over: Partial<CompanySnapshot> = {}): CompanySnapshot => ({
    id: "c1",
    name: "Imobiliária Teste",
    category: "Imobiliária",
    categories: [],
    city: "Umuarama",
    state: "PR",
    address: null,
    website: null,
    cnpj: null,
    sourceUrl: null,
    rating: 4.5,
    reviewCount: 30,
    publicProfile: null,
    enrichmentStatus: "NOT_STARTED",
    lastEnrichedAt: null,
    lastVerifiedAt: null,
    collectedAt: new Date("2026-11-01T12:00:00Z"),
    hasGoogleSource: true,
    contacts: [{ type: "PHONE", value: "(44) 3622-1000", normalizedValue: "+554436221000", source: "GOOGLE_MAPS_SCRAPER", sourceUrl: null, status: "FOUND", collectedAt: new Date("2026-11-01T12:00:00Z"), lastVerifiedAt: null }],
    websites: [],
    socialProfiles: [],
    fieldSources: [],
    auditSignals: null,
    auditAt: null,
    duplicateCandidates: [],
    business: null,
    ...over,
  });
  const now = new Date("2026-11-05T12:00:00Z");

  it("sem peso explícito, os critérios opcionais nem existem: a nota padrão não muda", () => {
    const s = snap();
    const r = scoreCompany(s, collectFacts(s), DEFAULT_INTELLIGENCE_CONFIG, now);
    const keys = r.indicators.OPPORTUNITY.criteria.map((c) => c.key);
    expect(keys).not.toContain("opp.site_gaps");
    expect(keys).not.toContain("opp.no_website");
    expect(INTELLIGENCE_CRITERIA.filter((c) => c.optIn).every((c) => c.weight === 0)).toBe(true);
  });

  it("a mesma empresa tem notas diferentes por oferta (sem site → boa para sites)", () => {
    const s = snap();
    const f = collectFacts(s);
    const sites = scoreCompany(s, f, offerConfig(DEFAULT_INTELLIGENCE_CONFIG, { id: "sites", name: "Sites", criteriaWeights: { "opp.no_website": 40, "opp.site_gaps": 30 } }), now);
    const base = scoreCompany(s, f, DEFAULT_INTELLIGENCE_CONFIG, now);
    const noSite = sites.indicators.OPPORTUNITY.criteria.find((c) => c.key === "opp.no_website")!;
    expect(noSite.result).toBe("MET");
    expect(sites.indicators.OPPORTUNITY.criteria.find((c) => c.key === "opp.site_gaps")!.result).toBe("NOT_EVALUATED");
    expect(sites.indicators.OPPORTUNITY.score).not.toBe(base.indicators.OPPORTUNITY.score);
  });

  it("falhas comprovadas na auditoria pontuam; ausência de auditoria não pesa", () => {
    const s = snap({ website: "https://imobteste.com.br/", auditSignals: { "site.https": "FAIL", "site.performance": "FAIL", "site.title": "PASS" }, auditAt: now });
    const r = scoreCompany(s, collectFacts(s), offerConfig(DEFAULT_INTELLIGENCE_CONFIG, { id: "sites", name: "Sites", criteriaWeights: { "opp.site_gaps": 30 } }), now);
    const c = r.indicators.OPPORTUNITY.criteria.find((x) => x.key === "opp.site_gaps")!;
    expect(c.result).toBe("MET");
    expect(c.justification).toMatch(/sem HTTPS.*carregamento lento/);
  });

  it("oferta herda o que não muda e substitui o que define", () => {
    const cfg = offerConfig({ ...DEFAULT_INTELLIGENCE_CONFIG, criteriaWeights: { "fit.segment": 10 } }, { id: "x", name: "X", targetSizes: ["GRANDE"], criteriaWeights: { "fit.size": 40 } });
    expect(cfg.targetSizes).toEqual(["GRANDE"]);
    expect(cfg.targetSegments).toEqual(DEFAULT_INTELLIGENCE_CONFIG.targetSegments);
    expect(cfg.criteriaWeights).toEqual({ "fit.segment": 10, "fit.size": 40 });
  });
});
