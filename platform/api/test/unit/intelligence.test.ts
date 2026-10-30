import { describe, expect, it } from "vitest";
import { analyzePhones, parsePhone } from "../../src/modules/intelligence/phones.ts";
import { collectFacts, type CompanySnapshot } from "../../src/modules/intelligence/evidence.ts";
import { DEFAULT_INTELLIGENCE_CONFIG, INTELLIGENCE_CRITERIA, scoreCompany } from "../../src/modules/intelligence/scoring.ts";
import { detectSegment } from "../../src/modules/intelligence/segments.ts";

const NOW = new Date("2026-10-29T12:00:00Z");
const FIXO = "+554436221234";
const CEL = "+5544999123456";
const CEL2 = "+5544988776655";

const contact = (type: "PHONE" | "WHATSAPP" | "EMAIL", value: string, source = "GOOGLE_MAPS_SCRAPER", status = "FOUND") => ({
  type,
  value,
  normalizedValue: value,
  source,
  sourceUrl: source === "WEBSITE" ? "https://exemplo.com.br/contato" : "https://maps.google.com/?cid=1",
  status,
  collectedAt: new Date("2026-10-20"),
  lastVerifiedAt: null,
});

function snapshot(over: Partial<CompanySnapshot> = {}): CompanySnapshot {
  return {
    id: "c1",
    name: "Imobiliária Exemplo",
    category: "Imobiliária",
    categories: [],
    city: "Umuarama",
    state: "PR",
    address: "Rua A, 100",
    website: "https://exemplo.com.br",
    cnpj: null,
    sourceUrl: "https://maps.google.com/?cid=1",
    rating: 4.7,
    reviewCount: 45,
    publicProfile: {},
    enrichmentStatus: "DONE",
    lastEnrichedAt: new Date("2026-10-20"),
    lastVerifiedAt: null,
    collectedAt: new Date("2026-10-01"),
    hasGoogleSource: true,
    contacts: [contact("PHONE", FIXO)],
    websites: [{ url: "https://exemplo.com.br", finalUrl: "https://exemplo.com.br/", isReachable: true, robotsAllowed: true, title: "Exemplo Imóveis", metaDescription: null, lastCheckedAt: new Date("2026-10-20") }],
    socialProfiles: [],
    fieldSources: [],
    auditSignals: null,
    auditAt: null,
    duplicateCandidates: [],
    ...over,
  };
}

const run = (s: CompanySnapshot, cfg = DEFAULT_INTELLIGENCE_CONFIG) => {
  const facts = collectFacts(s);
  return { facts, result: scoreCompany(s, facts, cfg, NOW) };
};
const crit = (r: ReturnType<typeof run>["result"], key: string) => Object.values(r.indicators).flatMap((i) => i.criteria).find((c) => c.key === key)!;

describe("telefones", () => {
  it("classifica fixo, celular e 0800 e valida o DDD", () => {
    expect(parsePhone("(44) 3622-1234")).toMatchObject({ ok: true, phone: { e164: FIXO, kind: "FIXED", areaCode: "44" } });
    expect(parsePhone("44 99912-3456")).toMatchObject({ ok: true, phone: { e164: CEL, kind: "MOBILE" } });
    expect(parsePhone("0800 777 1234")).toMatchObject({ ok: true, phone: { kind: "TOLL_FREE", areaCode: null } });
    expect(parsePhone("+351 912 345 678")).toMatchObject({ ok: true, phone: { countryCode: "351", kind: "MOBILE", areaCode: null } });
    expect(parsePhone("(20) 1234-5678").ok).toBe(false);
    expect(parsePhone("1234").ok).toBe(false);
  });

  it("consolida o mesmo número vindo de fontes e canais diferentes", () => {
    const a = analyzePhones([
      { raw: FIXO, channel: "PHONE", source: "GOOGLE_MAPS_SCRAPER" },
      { raw: "(44) 3622-1234", channel: "PHONE", source: "WEBSITE" },
      { raw: FIXO, channel: "WHATSAPP", source: "WEBSITE" },
    ]);
    expect(a.phones).toHaveLength(1);
    expect(a.duplicatesMerged).toBe(2);
    expect(a.phones[0]).toMatchObject({ whatsapp: "CONFIRMED", sourceCount: 2, kind: "FIXED" });
  });

  it("celular sem link de WhatsApp não vira WhatsApp", () => {
    const a = analyzePhones([{ raw: CEL, channel: "PHONE", source: "GOOGLE_MAPS_SCRAPER" }]);
    expect(a.phones[0]!.whatsapp).toBe("NOT_CONFIRMED");
  });

  it("descarta números marcados como inválidos ou impossíveis", () => {
    const a = analyzePhones([
      { raw: "(20) 1234-5678", channel: "PHONE", source: "CSV_IMPORT" },
      { raw: CEL, channel: "PHONE", source: "WEBSITE", status: "INVALID" },
    ]);
    expect(a.phones).toHaveLength(0);
    expect(a.rejected).toHaveLength(2);
  });
});

describe("segmentos", () => {
  it("usa a categoria antes do nome e aceita variações sem acento", () => {
    expect(detectSegment({ name: "Silva & Cia", category: "Escritório de contabilidade" })?.segment.id).toBe("contabilidade");
    expect(detectSegment({ name: "Advocacia Souza", category: null })).toMatchObject({ segment: { id: "advocacia" }, field: "name" });
    expect(detectSegment({ name: "Padaria Pão Bom", category: "Padaria" })).toBeNull();
  });
});

describe("três indicadores", () => {
  it("é determinístico", () => {
    const s = snapshot({ contacts: [contact("PHONE", FIXO), contact("WHATSAPP", CEL, "WEBSITE")] });
    expect(run(s).result).toEqual(run(s).result);
  });

  it("dentro de um indicador cada evidência pontua uma única vez", () => {
    const s = snapshot({
      contacts: [contact("PHONE", FIXO), contact("WHATSAPP", FIXO, "WEBSITE"), contact("WHATSAPP", CEL, "WEBSITE"), contact("EMAIL", "contato@exemplo.com.br", "WEBSITE")],
      socialProfiles: [{ network: "INSTAGRAM", url: "https://instagram.com/exemplo", handle: "exemplo", status: "VERIFIED", source: "WEBSITE", sourceUrl: "https://exemplo.com.br", lastCheckedAt: null, createdAt: new Date("2026-10-20") }],
    });
    const { result } = run(s);
    for (const ind of Object.values(result.indicators)) {
      const keys = ind.criteria.flatMap((c) => c.evidenceKeys);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("número repetido como telefone e WhatsApp conta como uma linha só", () => {
    const { result, facts } = run(snapshot({ contacts: [contact("PHONE", FIXO), contact("WHATSAPP", FIXO, "WEBSITE")] }));
    expect(facts.phones.phones).toHaveLength(1);
    expect(crit(result, "opp.whatsapp_lines").result).toBe("PARTIAL");
    expect(crit(result, "opp.other_lines").result).toBe("NOT_MET");
    expect(crit(result, "rel.cross_source").result).toBe("MET");
  });

  it("site bloqueado ou fora do ar não penaliza: os critérios ficam sem avaliação", () => {
    const blocked = snapshot({ websites: [{ url: "https://exemplo.com.br", finalUrl: null, isReachable: true, robotsAllowed: false, title: null, metaDescription: null, lastCheckedAt: new Date("2026-10-20") }] });
    const down = snapshot({ websites: [{ url: "https://exemplo.com.br", finalUrl: null, isReachable: false, robotsAllowed: null, title: null, metaDescription: null, lastCheckedAt: new Date("2026-10-20") }] });
    for (const s of [blocked, down]) {
      const { result } = run(s);
      expect(crit(result, "fit.whatsapp").result).toBe("NOT_EVALUATED");
      expect(crit(result, "rel.official").result).toBe("NOT_EVALUATED");
      expect(crit(result, "rel.collection").result).toBe("MET");
    }
    const noSite = run(snapshot({ website: null, websites: [] })).result;
    expect(run(blocked).result.indicators.RELIABILITY.score).toBe(noSite.indicators.RELIABILITY.score);
  });

  it("celular sem WhatsApp confirmado não pontua como WhatsApp", () => {
    const { result } = run(snapshot({ contacts: [contact("PHONE", CEL)] }));
    expect(crit(result, "fit.whatsapp").result).toBe("NOT_MET");
  });

  it("aponta contradições entre fontes e derruba a consistência", () => {
    const { result, facts } = run(
      snapshot({
        fieldSources: [
          { field: "city", value: "Umuarama", source: "GOOGLE_MAPS_SCRAPER", status: "FOUND", observedAt: new Date("2026-10-01") },
          { field: "city", value: "Maringá", source: "WEBSITE", status: "FOUND", observedAt: new Date("2026-10-20") },
          { field: "city", value: "UMUARAMA", source: "MANUAL", status: "FOUND", observedAt: new Date("2026-10-21") },
        ],
      }),
    );
    expect(facts.contradictions).toHaveLength(1);
    expect(facts.contradictions[0]!.values).toHaveLength(2);
    expect(crit(result, "rel.consistency").result).toBe("NOT_MET");
    expect(facts.issues.some((i) => i.code === "contradiction.city")).toBe(true);
  });

  it("dados ausentes levam a 'Necessita qualificação' em vez de nota baixa", () => {
    const { result, facts } = run(snapshot({ category: null, website: null, websites: [], contacts: [], reviewCount: null, rating: null, address: null, sourceUrl: null, hasGoogleSource: false }));
    expect(result.priority).toBe("NEEDS_QUALIFICATION");
    expect(result.composite).toBeNull();
    expect(result.priorityReasons.join(" ")).toMatch(/contato válido/);
    expect(facts.issues.some((i) => i.code === "record.incomplete")).toBe(true);
  });

  it("empresa do segmento com vários WhatsApp e canais chega à prioridade A", () => {
    const { result } = run(
      snapshot({
        contacts: [contact("PHONE", FIXO), contact("PHONE", FIXO, "WEBSITE"), contact("WHATSAPP", CEL, "WEBSITE"), contact("WHATSAPP", CEL2, "WEBSITE"), contact("EMAIL", "contato@exemplo.com.br", "WEBSITE")],
        socialProfiles: [{ network: "INSTAGRAM", url: "https://instagram.com/exemplo", handle: "exemplo", status: "VERIFIED", source: "WEBSITE", sourceUrl: null, lastCheckedAt: null, createdAt: new Date("2026-10-20") }],
        auditSignals: { "site.cta": "PASS", "site.contact_page": "PASS", "site.contact_buttons": "PASS" },
        auditAt: new Date("2026-10-21"),
      }),
    );
    expect(result.priority).toBe("A");
    expect(crit(result, "opp.segment_need").result).toBe("PARTIAL");
  });

  it("pesos são configuráveis e mudam o resultado de forma previsível", () => {
    const s = snapshot({ contacts: [contact("WHATSAPP", CEL, "WEBSITE")] });
    const base = run(s).result;
    const heavy = run(s, { ...DEFAULT_INTELLIGENCE_CONFIG, criteriaWeights: { "fit.segment": 100 } }).result;
    expect(heavy.indicators.FIT.criteria.find((c) => c.key === "fit.segment")!.weight).toBe(100);
    expect(heavy.indicators.FIT.score!).toBeGreaterThan(base.indicators.FIT.score!);
    const notTarget = run(s, { ...DEFAULT_INTELLIGENCE_CONFIG, targetSegments: ["advocacia"] }).result;
    expect(crit(notTarget, "fit.segment").result).toBe("NOT_MET");
  });

  it("todos os critérios têm rótulo e peso padrão", () => {
    for (const c of INTELLIGENCE_CRITERIA) expect(c.weight).toBeGreaterThan(0);
    const total = (id: string) => INTELLIGENCE_CRITERIA.filter((c) => c.indicator === id).reduce((a, c) => a + c.weight, 0);
    expect([total("FIT"), total("OPPORTUNITY"), total("RELIABILITY")]).toEqual([100, 100, 100]);
  });
});
