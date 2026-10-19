import type { Job } from "bullmq";
import { prisma, type Prisma, type ScoreKind } from "../../lib/prisma.ts";
import { logger } from "../../lib/logger.ts";
import type { AuditJobData } from "../../queues/index.ts";
import { crawlWebsite, type CrawlResult } from "../enrichment/crawler.ts";
import { processEnrichmentJob } from "../enrichment/service.ts";
import { readOrgSettings } from "../orgs/settings.ts";
import { evaluate, type AuditContext } from "./evaluate.ts";
import { checkInternalLinks, runLighthouse } from "./lighthouse.ts";
import { buildReport } from "./report.ts";
import { CRITERIA, METHODOLOGY_VERSION, computeScores, effectiveWeights } from "./scoring.ts";

const KINDS: ScoreKind[] = ["DATA_QUALITY", "GOOGLE_PRESENCE", "WEBSITE_QUALITY", "MULTICHANNEL", "OPPORTUNITY"];

async function loadContext(companyId: string) {
  const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId }, include: { contacts: true, socialProfiles: true, leadSources: { select: { sourceType: true } } } });
  const { leadSources, ...rest } = company;
  return { ...rest, hasGoogleSource: leadSources.some((s) => s.sourceType === "GOOGLE_MAPS_SCRAPER") || !!company.googlePlaceId };
}

/** Recalcula só o indicador de qualidade dos dados (sem rede). Usado após importações e enriquecimentos. */
export async function recomputeDataQuality(companyId: string) {
  const company = await loadContext(companyId);
  const org = await prisma.organization.findUnique({ where: { id: company.organizationId }, select: { settings: true } });
  const weights = effectiveWeights(readOrgSettings(org?.settings).scoring);
  const evals = evaluate({ company, crawl: null, lighthouse: null, brokenLinks: null, now: new Date() }).filter((e) => e.key.startsWith("dq."));
  // dq.website/dq.social dependem de verificação do site; sem crawl, usa o resultado salvo do último enriquecimento
  const site = await prisma.companyWebsite.findFirst({ where: { companyId }, orderBy: { lastCheckedAt: "desc" } });
  if (company.website && site?.isReachable) {
    const idx = evals.findIndex((e) => e.key === "dq.website");
    if (idx >= 0) evals[idx] = { key: "dq.website", result: "PASS", detail: site.finalUrl ?? company.website, url: site.finalUrl };
  }
  const s = computeScores(evals, weights).DATA_QUALITY;
  await prisma.companyScore.upsert({
    where: { companyId_kind: { companyId, kind: "DATA_QUALITY" } },
    create: { organizationId: company.organizationId, companyId, kind: "DATA_QUALITY", score: s.score, confidence: s.confidence, breakdown: { evaluations: evals } as unknown as Prisma.InputJsonValue },
    update: { score: s.score, confidence: s.confidence, breakdown: { evaluations: evals } as unknown as Prisma.InputJsonValue, computedAt: new Date() },
  });
  return s;
}

export async function processAuditJob(job: Job<AuditJobData>) {
  const audit = await prisma.digitalAudit.findUnique({ where: { id: job.data.auditId } });
  if (!audit || ["COMPLETED", "CANCELLED"].includes(audit.status)) return;
  const log = logger.child({ auditId: audit.id, companyId: audit.companyId });
  await prisma.digitalAudit.update({ where: { id: audit.id }, data: { status: "RUNNING", startedAt: new Date() } });

  try {
    let company = await loadContext(audit.companyId);
    // enriquece antes se o site nunca foi analisado (contatos e redes alimentam a auditoria)
    if (company.website && company.domain && (!company.lastEnrichedAt || Date.now() - company.lastEnrichedAt.getTime() > 7 * 86400000)) {
      const ej = await prisma.enrichmentJob.create({ data: { organizationId: company.organizationId, companyId: company.id, requestedById: audit.requestedById } });
      await processEnrichmentJob({ data: { enrichmentJobId: ej.id } } as Job).catch((err) => log.warn({ err: (err as Error).message }, "enriquecimento prévio falhou"));
      company = await loadContext(audit.companyId);
    }

    let crawl: CrawlResult | null = null;
    let lighthouse = null;
    let brokenLinks = null;
    if (company.website && company.domain) {
      crawl = await crawlWebsite(company.website, { maxPages: 6 });
      if (crawl.reachable && crawl.robots.allowedHome && crawl.finalUrl) {
        lighthouse = await runLighthouse(crawl.finalUrl);
        const links = crawl.pages.flatMap((p) => p.internalLinks.map((l) => l.url)).filter((u) => !crawl!.pages.some((p) => p.finalUrl === u) && crawl!.robotsAllows(u));
        brokenLinks = await checkInternalLinks(links, 15);
      }
    }

    const ctx: AuditContext = { company, crawl, lighthouse, brokenLinks, now: new Date() };
    const evals = evaluate(ctx);
    const org = await prisma.organization.findUnique({ where: { id: company.organizationId }, select: { settings: true } });
    const weights = effectiveWeights(readOrgSettings(org?.settings).scoring);
    const scores = computeScores(evals, weights);
    const report = buildReport(company.name, evals, scores);
    const now = new Date();

    await prisma.$transaction([
      prisma.auditEvidence.deleteMany({ where: { auditId: audit.id } }),
      prisma.auditEvidence.createMany({
        data: evals.map((e) => {
          const def = CRITERIA.find((c) => c.key === e.key)!;
          return {
            auditId: audit.id,
            dimension: def.dimension,
            criterion: e.key,
            label: def.label,
            result: e.result,
            weight: weights.get(e.key) ?? def.weight,
            value: e.value === undefined ? undefined : (e.value as Prisma.InputJsonValue),
            detail: e.detail?.slice(0, 1000),
            url: e.url ?? null,
            observedAt: now,
          };
        }),
      }),
      prisma.digitalAudit.update({
        where: { id: audit.id },
        data: {
          status: "COMPLETED",
          finishedAt: now,
          methodologyVersion: METHODOLOGY_VERSION,
          scores: scores as unknown as Prisma.InputJsonValue,
          summary: report.summary,
          positives: report.positives as unknown as Prisma.InputJsonValue,
          problems: report.problems as unknown as Prisma.InputJsonValue,
          recommendations: report.recommendations as unknown as Prisma.InputJsonValue,
          services: report.services as unknown as Prisma.InputJsonValue,
          lighthouse: (lighthouse ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      }),
      ...KINDS.map((kind) =>
        prisma.companyScore.upsert({
          where: { companyId_kind: { companyId: company.id, kind } },
          create: { organizationId: company.organizationId, companyId: company.id, kind, score: scores[kind].score, confidence: scores[kind].confidence, auditId: audit.id, breakdown: scores[kind] as unknown as Prisma.InputJsonValue },
          update: { score: scores[kind].score, confidence: scores[kind].confidence, auditId: audit.id, breakdown: scores[kind] as unknown as Prisma.InputJsonValue, computedAt: now },
        }),
      ),
      prisma.company.update({ where: { id: company.id }, data: { lastAuditedAt: now } }),
      prisma.activity.create({
        data: {
          organizationId: company.organizationId,
          companyId: company.id,
          userId: audit.requestedById,
          type: "AUDIT",
          title: "Auditoria digital concluída",
          body: `Oportunidade ${scores.OPPORTUNITY.score ?? "N/A"} · Site ${scores.WEBSITE_QUALITY.score ?? "N/A"} · Multicanal ${scores.MULTICHANNEL.score ?? "N/A"} · Google ${scores.GOOGLE_PRESENCE.score ?? "N/A"}`,
          metadata: { auditId: audit.id },
        },
      }),
    ]);
    log.info({ scores: Object.fromEntries(KINDS.map((k) => [k, scores[k].score])) }, "auditoria concluída");
  } catch (err) {
    const message = (err as Error).message.slice(0, 500);
    log.error({ err: message }, "auditoria falhou");
    await prisma.digitalAudit.update({ where: { id: audit.id }, data: { status: "FAILED", finishedAt: new Date(), error: message } });
  }
}
