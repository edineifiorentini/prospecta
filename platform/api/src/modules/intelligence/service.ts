import { prisma } from "../../lib/prisma.ts";
import { notFound } from "../../lib/errors.ts";
import { readOrgSettings, type Offer } from "../orgs/settings.ts";
import { simulationActive } from "../company-data/service.ts";
import { RECEITA_PROVIDER } from "../public-data/sources.ts";
import type { BusinessProfile, DataPoint, Range } from "../company-data/types.ts";
import { collectFacts, type BusinessRange, type BusinessSnapshot, type CompanySnapshot } from "./evidence.ts";
import { scoreCompany, type IntelligenceConfig } from "./scoring.ts";

const asRange = (d: DataPoint<Range> | undefined): BusinessRange | null => (d ? { ...d.value, nature: d.nature } : null);

/** Do perfil normalizado, só o que os indicadores e a IA usam (nada de contatos ou dados pessoais). */
export function businessSnapshot(p: BusinessProfile): BusinessSnapshot {
  const units = p.branches?.value.length ?? null;
  return {
    provider: p.provider,
    simulated: p.simulated,
    fetchedAt: p.fetchedAt,
    cnpj: p.cnpj,
    registrationStatus: p.registrationStatus?.value ?? null,
    openedAt: p.openedAt?.value ?? null,
    primaryCnae: p.primaryCnae?.value ?? null,
    size: p.size?.value ?? null,
    employees: asRange(p.employees),
    revenue: asRange(p.revenue),
    foreignTrade: p.foreignTrade?.value ?? null,
    units: units && units > 0 ? units : null,
  };
}

/** Carrega do banco o instantâneo usado pela inteligência comercial (sempre filtrado pela organização). */
export async function loadSnapshot(organizationId: string, companyId: string): Promise<CompanySnapshot> {
  const c = await prisma.company.findFirst({
    where: { id: companyId, organizationId },
    include: {
      contacts: true,
      websites: { orderBy: { lastCheckedAt: { sort: "desc", nulls: "last" } }, take: 1 },
      socialProfiles: true,
      leadSources: { select: { sourceType: true }, take: 20 },
    },
  });
  if (!c) throw notFound("Empresa não encontrada.");
  const [fieldSources, audit, duplicates, dataProfiles] = await Promise.all([
    prisma.companyFieldSource.findMany({ where: { companyId: c.id, organizationId }, orderBy: { observedAt: "desc" }, take: 400, select: { field: true, value: true, source: true, status: true, observedAt: true } }),
    prisma.digitalAudit.findFirst({ where: { companyId: c.id, organizationId, status: "COMPLETED" }, orderBy: { createdAt: "desc" }, select: { finishedAt: true, createdAt: true, evidence: { select: { criterion: true, result: true } } } }),
    prisma.company.findMany({
      where: {
        organizationId,
        status: "ACTIVE",
        id: { not: c.id },
        OR: [...(c.normPhone ? [{ normPhone: c.normPhone }] : []), ...(c.normDomain ? [{ normDomain: c.normDomain }] : []), ...(c.city ? [{ normName: c.normName, city: c.city }] : [])],
      },
      select: { id: true, name: true, normPhone: true, normDomain: true },
      take: 5,
    }),
    // só perfil confirmado (MATCHED) e do modo atual: dado simulado nunca entra com o real. Sem Econodata,
    // vale o cadastro oficial da base local da Receita (dados abertos), quando a conta usa essa fonte.
    prisma.companyDataProfile.findMany({ where: { organizationId, companyId: c.id, status: "MATCHED", provider: { in: [simulationActive() ? "econodata-mock" : "econodata", RECEITA_PROVIDER] } }, select: { provider: true, profile: true } }),
  ]);
  const dataProfile = dataProfiles.find((p) => p.provider !== RECEITA_PROVIDER) ?? dataProfiles[0];
  return {
    id: c.id,
    name: c.name,
    category: c.category,
    categories: c.categories,
    city: c.city,
    state: c.state,
    address: c.address,
    website: c.website,
    cnpj: c.cnpj,
    sourceUrl: c.sourceUrl,
    rating: c.rating,
    reviewCount: c.reviewCount,
    publicProfile: (c.publicProfile as Record<string, unknown> | null) ?? null,
    enrichmentStatus: c.enrichmentStatus,
    lastEnrichedAt: c.lastEnrichedAt,
    lastVerifiedAt: c.lastVerifiedAt,
    collectedAt: c.collectedAt,
    hasGoogleSource: c.leadSources.some((s) => s.sourceType === "GOOGLE_MAPS_SCRAPER") || !!c.googlePlaceId,
    contacts: c.contacts.map((x) => ({ type: x.type, value: x.value, normalizedValue: x.normalizedValue, source: x.source, sourceUrl: x.sourceUrl, status: x.status, collectedAt: x.collectedAt, lastVerifiedAt: x.lastVerifiedAt })),
    websites: c.websites.map((w) => ({ url: w.url, finalUrl: w.finalUrl, isReachable: w.isReachable, robotsAllowed: w.robotsAllowed, title: w.title, metaDescription: w.metaDescription, lastCheckedAt: w.lastCheckedAt })),
    socialProfiles: c.socialProfiles.map((s) => ({ network: s.network, url: s.url, handle: s.handle, status: s.status, source: s.source, sourceUrl: s.sourceUrl, lastCheckedAt: s.lastCheckedAt, createdAt: s.createdAt })),
    fieldSources,
    auditSignals: audit?.evidence.length ? Object.fromEntries(audit.evidence.map((e) => [e.criterion, e.result])) : null,
    auditAt: audit?.finishedAt ?? audit?.createdAt ?? null,
    duplicateCandidates: duplicates.map((d) => ({
      id: d.id,
      name: d.name,
      reason: c.normPhone && d.normPhone === c.normPhone ? "mesmo telefone" : c.normDomain && d.normDomain === c.normDomain ? "mesmo domínio" : "mesmo nome na mesma cidade",
    })),
    business: dataProfile?.profile ? businessSnapshot(dataProfile.profile as unknown as BusinessProfile) : null,
  };
}

export async function intelligenceConfig(organizationId: string): Promise<IntelligenceConfig> {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
  return readOrgSettings(org.settings).intelligence;
}

export async function computeIntelligence(organizationId: string, companyId: string, now = new Date()) {
  const [snapshot, config] = await Promise.all([loadSnapshot(organizationId, companyId), intelligenceConfig(organizationId)]);
  const facts = collectFacts(snapshot);
  const result = scoreCompany(snapshot, facts, config, now);
  return { snapshot, facts, result, config };
}

/** Configuração da conta com o que a oferta muda (segmentos, porte, pesos). O resto continua igual. */
export function offerConfig(base: IntelligenceConfig, o: Offer): IntelligenceConfig {
  return {
    ...base,
    targetSegments: o.targetSegments?.length ? o.targetSegments : base.targetSegments,
    targetSizes: o.targetSizes?.length ? o.targetSizes : base.targetSizes,
    idealEmployees: o.idealEmployees ?? base.idealEmployees,
    criteriaWeights: { ...base.criteriaWeights, ...o.criteriaWeights },
    indicatorWeights: o.indicatorWeights ?? base.indicatorWeights,
  };
}

/**
 * Aderência por oferta: as mesmas evidências pontuadas com os pesos de cada produto ou serviço. Determinístico;
 * a prioridade A/B/C da conta (sem oferta) continua sendo a de computeIntelligence.
 */
export async function computeOffers(organizationId: string, companyId: string, now = new Date()) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
  const { offers, ...base } = readOrgSettings(org.settings).intelligence;
  if (!offers.length) return [];
  const snapshot = await loadSnapshot(organizationId, companyId);
  const facts = collectFacts(snapshot);
  return offers.map((o) => {
    const r = scoreCompany(snapshot, facts, offerConfig(base, o), now);
    const decisive = [...r.indicators.FIT.criteria, ...r.indicators.OPPORTUNITY.criteria].filter((c) => c.weight > 0 && c.result !== "NOT_EVALUATED").sort((a, b) => b.weight - a.weight).slice(0, 4);
    return {
      id: o.id,
      name: o.name,
      priority: r.priority,
      composite: r.composite,
      fit: r.indicators.FIT.score,
      opportunity: r.indicators.OPPORTUNITY.score,
      reliability: r.indicators.RELIABILITY.score,
      reasons: r.priorityReasons,
      highlights: decisive.map((c) => ({ key: c.key, label: c.label, result: c.result, justification: c.justification })),
    };
  });
}
