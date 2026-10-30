import { prisma } from "../../lib/prisma.ts";
import { notFound } from "../../lib/errors.ts";
import { readOrgSettings } from "../orgs/settings.ts";
import { collectFacts, type CompanySnapshot } from "./evidence.ts";
import { scoreCompany, type IntelligenceConfig } from "./scoring.ts";

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
  const [fieldSources, audit, duplicates] = await Promise.all([
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
  ]);
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
