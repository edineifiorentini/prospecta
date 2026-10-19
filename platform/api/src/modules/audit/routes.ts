import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { notFound, unprocessable } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { pageResult, paginate } from "../../lib/pagination.ts";
import { enqueueAudit } from "../../queues/index.ts";
import { orgId } from "../../plugins/auth.ts";
import { readOrgSettings } from "../orgs/settings.ts";
import { CRITERIA, METHODOLOGY_VERSION, MIN_CONFIDENCE } from "./scoring.ts";
import { renderPdf, renderReportHtml } from "./pdf.ts";

const idParams = z.object({ id: z.uuid() });

/** Cria auditorias para empresas da organização, sem duplicar as que já estão em andamento. */
export async function queueAudits(organizationId: string, companyIds: string[], userId: string | null) {
  const companies = await prisma.company.findMany({ where: { organizationId, id: { in: companyIds } }, select: { id: true, audits: { where: { status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } } } });
  const ids: string[] = [];
  for (const c of companies) {
    if (c.audits.length) continue;
    const a = await prisma.digitalAudit.create({ data: { organizationId, companyId: c.id, methodologyVersion: METHODOLOGY_VERSION, requestedById: userId } });
    await enqueueAudit({ auditId: a.id });
    ids.push(a.id);
  }
  return { queued: ids.length, skipped: companyIds.length - ids.length, ids };
}

export const auditRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/scoring/criteria", { schema: { tags: ["audit"], summary: "Critérios, pesos padrão e pesos efetivos da organização" } }, async (req) => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId(req) } });
    const overrides = readOrgSettings(org.settings).scoring;
    return { version: METHODOLOGY_VERSION, minConfidence: MIN_CONFIDENCE, criteria: CRITERIA.map((c) => ({ ...c, defaultWeight: c.weight, weight: overrides[c.dimension]?.[c.key] ?? c.weight })) };
  });

  app.post("/companies/:id/audit", { config: { permission: "audit:run" }, schema: { tags: ["audit"], summary: "Enfileira auditoria digital de uma empresa", params: idParams } }, async (req, reply) => {
    const organizationId = orgId(req);
    const company = await prisma.company.findFirst({ where: { id: req.params.id, organizationId }, select: { id: true } });
    if (!company) throw notFound("Empresa não encontrada.");
    const r = await queueAudits(organizationId, [company.id], req.auth!.userId);
    if (!r.queued) throw unprocessable("Já existe uma auditoria em andamento para esta empresa.");
    await writeAudit(req, { action: "audit.queued", entityType: "company", entityId: company.id });
    return reply.code(202).send({ auditId: r.ids[0] });
  });

  app.post("/audits/bulk", { config: { permission: "audit:run", rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["audit"], body: z.object({ companyIds: z.array(z.uuid()).min(1).max(100) }) } }, async (req, reply) => {
    const r = await queueAudits(orgId(req), req.body.companyIds, req.auth!.userId);
    return reply.code(202).send({ queued: r.queued, skipped: r.skipped });
  });

  app.get(
    "/audits",
    {
      schema: {
        tags: ["audit"],
        summary: "Lista auditorias",
        querystring: z.object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25), status: z.string().optional(), minOpportunity: z.coerce.number().int().min(0).max(100).optional(), q: z.string().max(100).optional() }),
      },
    },
    async (req) => {
      const q = req.query;
      const where: Prisma.DigitalAuditWhereInput = {
        organizationId: orgId(req),
        ...(q.status ? { status: q.status as never } : {}),
        ...(q.q ? { company: { name: { contains: q.q, mode: "insensitive" } } } : {}),
        ...(q.minOpportunity !== undefined ? { company: { scores: { some: { kind: "OPPORTUNITY", score: { gte: q.minOpportunity } } } } } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.digitalAudit.findMany({
          where,
          orderBy: { createdAt: "desc" },
          ...paginate(q.page, q.pageSize),
          select: { id: true, status: true, scores: true, createdAt: true, finishedAt: true, error: true, company: { select: { id: true, name: true, category: true, city: true } }, services: true },
        }),
        prisma.digitalAudit.count({ where }),
      ]);
      return pageResult(items, total, q.page, q.pageSize);
    },
  );

  app.get("/companies/:id/audits", { schema: { tags: ["audit"], params: idParams } }, async (req) =>
    prisma.digitalAudit.findMany({ where: { companyId: req.params.id, organizationId: orgId(req) }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, status: true, scores: true, summary: true, createdAt: true, finishedAt: true, error: true } }),
  );

  app.get("/audits/:id", { schema: { tags: ["audit"], summary: "Relatório completo com evidências", params: idParams } }, async (req) => {
    const a = await prisma.digitalAudit.findFirst({
      where: { id: req.params.id, organizationId: orgId(req) },
      include: { evidence: { orderBy: [{ dimension: "asc" }, { weight: "desc" }] }, company: { select: { id: true, name: true, category: true, city: true, state: true, website: true, sourceUrl: true } } },
    });
    if (!a) throw notFound("Auditoria não encontrada.");
    return a;
  });

  app.get("/audits/:id/report.pdf", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["audit"], summary: "Exporta o relatório em PDF", params: idParams } }, async (req, reply) => {
    const organizationId = orgId(req);
    const a = await prisma.digitalAudit.findFirst({ where: { id: req.params.id, organizationId }, include: { evidence: { orderBy: [{ dimension: "asc" }, { weight: "desc" }] }, company: true, organization: { select: { name: true } } } });
    if (!a) throw notFound("Auditoria não encontrada.");
    if (a.status !== "COMPLETED") throw unprocessable("A auditoria ainda não foi concluída.");
    const html = renderReportHtml({
      organizationName: a.organization.name,
      company: a.company,
      audit: {
        id: a.id,
        finishedAt: a.finishedAt,
        methodologyVersion: a.methodologyVersion,
        scores: a.scores as never,
        summary: a.summary,
        positives: a.positives as never,
        problems: a.problems as never,
        recommendations: a.recommendations as never,
        services: a.services as never,
        lighthouse: a.lighthouse as never,
      },
      evidence: a.evidence,
    });
    if ((req.query as Record<string, string>).format === "html") return reply.header("Content-Type", "text/html; charset=utf-8").header("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'").send(html);
    const pdf = await renderPdf(html);
    await writeAudit(req, { action: "audit.pdf_exported", entityType: "digital_audit", entityId: a.id });
    const safeName = a.company.name.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).toLowerCase() || "empresa";
    return reply.header("Content-Type", "application/pdf").header("Content-Disposition", `attachment; filename="auditoria-${safeName}.pdf"`).send(pdf);
  });
};
