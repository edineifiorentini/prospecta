import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { notFound, unprocessable } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { enqueueEnrichment } from "../../queues/index.ts";
import { orgId } from "../../plugins/auth.ts";

/** Enfileira o enriquecimento de empresas da organização, ignorando as sem site ou já em processamento. */
export async function queueEnrichment(organizationId: string, companyIds: string[], userId: string | null) {
  const companies = await prisma.company.findMany({
    where: { organizationId, id: { in: companyIds } },
    select: { id: true, website: true, enrichmentJobs: { where: { status: { in: ["QUEUED", "RUNNING"] } }, select: { id: true } } },
  });
  let queued = 0;
  let skipped = companyIds.length - companies.length;
  const jobIds: string[] = [];
  for (const c of companies) {
    if (!c.website || c.enrichmentJobs.length) {
      skipped++;
      continue;
    }
    const ej = await prisma.enrichmentJob.create({ data: { organizationId, companyId: c.id, requestedById: userId } });
    await prisma.company.update({ where: { id: c.id }, data: { enrichmentStatus: "QUEUED" } });
    await enqueueEnrichment({ enrichmentJobId: ej.id });
    jobIds.push(ej.id);
    queued++;
  }
  return { queued, skipped, jobIds };
}

export const enrichmentRoutes: FastifyPluginAsyncZod = async (app) => {
  app.post(
    "/companies/:id/enrich",
    { config: { permission: "enrich:run" }, schema: { tags: ["enrichment"], summary: "Enfileira o enriquecimento do site oficial de uma empresa", params: z.object({ id: z.uuid() }) } },
    async (req, reply) => {
      const organizationId = orgId(req);
      const company = await prisma.company.findFirst({ where: { id: req.params.id, organizationId }, select: { id: true, website: true } });
      if (!company) throw notFound("Empresa não encontrada.");
      if (!company.website) throw unprocessable("Esta empresa não tem site cadastrado. Informe o site na ficha antes de enriquecer.");
      const r = await queueEnrichment(organizationId, [company.id], req.auth!.userId);
      if (!r.queued) throw unprocessable("Já existe um enriquecimento em andamento para esta empresa.");
      await writeAudit(req, { action: "enrichment.queued", entityType: "company", entityId: company.id });
      return reply.code(202).send({ enrichmentJobId: r.jobIds[0] });
    },
  );

  app.post(
    "/enrichment/bulk",
    { config: { permission: "enrich:run", rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["enrichment"], summary: "Enfileira enriquecimento em lote (até 200 empresas)", body: z.object({ companyIds: z.array(z.uuid()).min(1).max(200) }) } },
    async (req, reply) => {
      const r = await queueEnrichment(orgId(req), req.body.companyIds, req.auth!.userId);
      await writeAudit(req, { action: "enrichment.bulk", metadata: { queued: r.queued, skipped: r.skipped } });
      return reply.code(202).send({ queued: r.queued, skipped: r.skipped });
    },
  );

  app.get("/companies/:id/enrichment-jobs", { schema: { tags: ["enrichment"], summary: "Histórico de enriquecimentos da empresa", params: z.object({ id: z.uuid() }) } }, async (req) => {
    const organizationId = orgId(req);
    return prisma.enrichmentJob.findMany({ where: { companyId: req.params.id, organizationId }, orderBy: { createdAt: "desc" }, take: 20 });
  });
};
