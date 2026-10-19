import { describe, expect, it } from "vitest";
import { computeScores, effectiveWeights, type Evaluation } from "../../src/modules/audit/scoring.ts";
import { evaluate, type AuditContext } from "../../src/modules/audit/evaluate.ts";
import { buildReport } from "../../src/modules/audit/report.ts";

const now = new Date("2026-10-19T12:00:00Z");

function company(over: Partial<AuditContext["company"]> = {}): AuditContext["company"] {
  return {
    id: "c1", organizationId: "o1", name: "Clínica Teste", legalName: null, cnpj: null, category: "Dentista", categories: [], description: null,
    website: null, domain: null, primaryPhone: "+551933334444", primaryEmail: null, address: "Rua A, 1", neighborhood: null, city: "Campinas", state: "SP",
    postalCode: null, country: "BR", latitude: null, longitude: null, sourceUrl: "https://maps.google.com/?cid=1", googlePlaceId: "p1", googleCid: "1", osmId: null,
    rating: 4.9, reviewCount: 8, openingHours: null, priceRange: null, publicProfile: { hasDescription: false, photoCount: 2 }, status: "ACTIVE", archivedAt: null,
    enrichmentStatus: "SKIPPED", lastEnrichedAt: null, lastAuditedAt: null, collectedAt: now, lastVerifiedAt: now, ownerId: null, normName: "clinica teste",
    normPhone: null, normDomain: null, normAddress: null, createdAt: now, updatedAt: now,
    contacts: [
      { id: "k1", organizationId: "o1", companyId: "c1", type: "PHONE", value: "(19) 3333-4444", normalizedValue: "+551933334444", label: null, isPrimary: true, source: "GOOGLE_MAPS_SCRAPER", sourceUrl: null, status: "FOUND", confidence: 0.8, verification: null, collectedAt: now, lastVerifiedAt: null },
    ],
    socialProfiles: [],
    hasGoogleSource: true,
    ...over,
  } as AuditContext["company"];
}

describe("pontuação", () => {
  it("exclui critérios não avaliados do denominador", () => {
    const evals: Evaluation[] = [
      { key: "dq.name", result: "PASS" },
      { key: "dq.address", result: "PASS" },
      { key: "dq.phone", result: "FAIL" },
      { key: "dq.email", result: "WARN" },
      { key: "dq.website", result: "NOT_EVALUATED" },
    ];
    const s = computeScores(evals).DATA_QUALITY;
    // avaliados: name 5 + address 10 + phone 15 + email 15 = 45; ganho: 5 + 10 + 0 + 7,5 = 22,5 → 50
    expect(s.score).toBe(50);
    expect(s.evaluated).toBe(45);
    expect(s.confidence).toBe(0.45);
  });

  it("marca como 'Não avaliado' quando a confiança fica abaixo de 30%", () => {
    const s = computeScores([{ key: "dq.name", result: "PASS" }]).DATA_QUALITY;
    expect(s.score).toBeNull();
    expect(s.confidence).toBeLessThan(0.3);
  });

  it("aceita pesos configurados pela organização", () => {
    const evals: Evaluation[] = [
      { key: "mc.website", result: "PASS" },
      { key: "mc.instagram", result: "FAIL" },
      { key: "mc.whatsapp", result: "FAIL" },
      { key: "mc.email", result: "FAIL" },
    ];
    const base = computeScores(evals).MULTICHANNEL.score!;
    const boosted = computeScores(evals, effectiveWeights({ MULTICHANNEL: { "mc.website": 100 } })).MULTICHANNEL.score!;
    expect(boosted).toBeGreaterThan(base);
  });
});

describe("avaliação por evidências", () => {
  it("sem dados do Google, a presença no Google fica 'Não avaliado' (não zero)", () => {
    const evals = evaluate({ company: company({ hasGoogleSource: false, googlePlaceId: null }), crawl: null, lighthouse: null, brokenLinks: null, now });
    expect(evals.filter((e) => e.key.startsWith("gbp.")).every((e) => e.result === "NOT_EVALUATED")).toBe(true);
    expect(computeScores(evals).GOOGLE_PRESENCE.score).toBeNull();
  });

  it("empresa sem site: oportunidade de site identificada e qualidade do site não avaliada", () => {
    const evals = evaluate({ company: company(), crawl: null, lighthouse: null, brokenLinks: null, now });
    expect(evals.find((e) => e.key === "op.website")?.result).toBe("PASS");
    expect(computeScores(evals).WEBSITE_QUALITY.score).toBeNull();
    expect(evals.find((e) => e.key === "gbp.reviews")?.result).toBe("FAIL"); // 8 avaliações
    expect(evals.find((e) => e.key === "gbp.rating")?.result).toBe("PASS"); // nota 4,9
  });

  it("relatório só lista problemas com evidência e não declara verificação do Google", () => {
    const evals = evaluate({ company: company(), crawl: null, lighthouse: null, brokenLinks: null, now });
    const report = buildReport("Clínica Teste", evals, computeScores(evals));
    expect(report.problems.every((p) => p.detail)).toBe(true);
    expect(report.summary).toContain("não uma auditoria oficial do Google");
    expect(report.services.map((s) => s.key)).toContain("site");
  });
});
