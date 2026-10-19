import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { badRequest, conflict, notFound } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { orgId } from "../../plugins/auth.ts";

const idParams = z.object({ id: z.uuid() });

async function defaultPipeline(organizationId: string) {
  const p = await prisma.pipeline.findFirst({ where: { organizationId }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], include: { stages: { orderBy: { position: "asc" } } } });
  if (!p) throw notFound("Nenhum pipeline configurado.");
  return p;
}

async function loadDeal(organizationId: string, id: string) {
  const d = await prisma.deal.findFirst({ where: { id, organizationId }, include: { stage: true, company: { select: { id: true, name: true } } } });
  if (!d) throw notFound("Negociação não encontrada.");
  return d;
}

const dealSelect = {
  id: true, title: true, valueCents: true, currency: true, status: true, position: true, stageId: true, pipelineId: true, expectedCloseDate: true, lostReason: true,
  stageChangedAt: true, createdAt: true, updatedAt: true, closedAt: true,
  owner: { select: { id: true, name: true } },
  company: {
    select: {
      id: true, name: true, category: true, city: true, primaryPhone: true, primaryEmail: true, website: true,
      scores: { where: { kind: { in: ["OPPORTUNITY", "DATA_QUALITY"] } }, select: { kind: true, score: true } },
      tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
    },
  },
  tasks: { where: { status: "OPEN" as const }, orderBy: { dueAt: { sort: "asc" as const, nulls: "last" as const } }, take: 1, select: { id: true, title: true, dueAt: true } },
} satisfies Prisma.DealSelect;

export const crmRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── pipelines e etapas ──
  app.get("/pipelines", { schema: { tags: ["crm"], summary: "Pipelines e etapas" } }, async (req) =>
    prisma.pipeline.findMany({ where: { organizationId: orgId(req) }, orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }], include: { stages: { orderBy: { position: "asc" }, include: { _count: { select: { deals: { where: { status: "OPEN" } } } } } } } }),
  );

  app.post(
    "/pipelines/:id/stages",
    { config: { permission: "settings:manage" }, schema: { tags: ["crm"], summary: "Cria etapa personalizada", params: idParams, body: z.object({ name: z.string().trim().min(1).max(60), color: z.string().max(20).default("slate"), kind: z.enum(["OPEN", "WON", "LOST"]).default("OPEN") }) } },
    async (req, reply) => {
      const p = await prisma.pipeline.findFirst({ where: { id: req.params.id, organizationId: orgId(req) }, include: { stages: true } });
      if (!p) throw notFound();
      // novas etapas abertas entram antes das etapas finais (Ganho/Perdido)
      const finals = p.stages.filter((s) => s.kind !== "OPEN").sort((a, b) => a.position - b.position);
      const position = req.body.kind === "OPEN" && finals.length ? finals[0]!.position : p.stages.length;
      await prisma.$transaction([
        ...finals.filter((s) => s.position >= position).map((s) => prisma.pipelineStage.update({ where: { id: s.id }, data: { position: s.position + 1 } })),
        prisma.pipelineStage.create({ data: { pipelineId: p.id, name: req.body.name, color: req.body.color, kind: req.body.kind, position } }),
      ]);
      await writeAudit(req, { action: "pipeline.stage_created", entityType: "pipeline", entityId: p.id, metadata: { name: req.body.name } });
      return reply.code(201).send({ ok: true });
    },
  );

  app.patch(
    "/stages/:id",
    { config: { permission: "settings:manage" }, schema: { tags: ["crm"], params: idParams, body: z.object({ name: z.string().trim().min(1).max(60).optional(), color: z.string().max(20).optional() }) } },
    async (req) => {
      const s = await prisma.pipelineStage.findFirst({ where: { id: req.params.id, pipeline: { organizationId: orgId(req) } } });
      if (!s) throw notFound();
      await prisma.pipelineStage.update({ where: { id: s.id }, data: req.body });
      return { ok: true };
    },
  );

  app.post(
    "/pipelines/:id/reorder",
    { config: { permission: "settings:manage" }, schema: { tags: ["crm"], summary: "Reordena as etapas", params: idParams, body: z.object({ stageIds: z.array(z.uuid()).min(1) }) } },
    async (req) => {
      const p = await prisma.pipeline.findFirst({ where: { id: req.params.id, organizationId: orgId(req) }, include: { stages: true } });
      if (!p) throw notFound();
      const ids = new Set(p.stages.map((s) => s.id));
      if (req.body.stageIds.length !== ids.size || !req.body.stageIds.every((id) => ids.has(id))) throw badRequest("Envie todas as etapas do pipeline.");
      await prisma.$transaction(req.body.stageIds.map((id, position) => prisma.pipelineStage.update({ where: { id }, data: { position } })));
      await writeAudit(req, { action: "pipeline.reordered", entityType: "pipeline", entityId: p.id });
      return { ok: true };
    },
  );

  app.delete(
    "/stages/:id",
    { config: { permission: "settings:manage" }, schema: { tags: ["crm"], summary: "Remove etapa (move negociações para outra)", params: idParams, body: z.object({ moveToStageId: z.uuid().optional() }) } },
    async (req) => {
      const organizationId = orgId(req);
      const s = await prisma.pipelineStage.findFirst({ where: { id: req.params.id, pipeline: { organizationId } }, include: { _count: { select: { deals: true } }, pipeline: { include: { stages: true } } } });
      if (!s) throw notFound();
      if (s.pipeline.stages.length <= 2) throw badRequest("O pipeline precisa de pelo menos duas etapas.");
      if (s._count.deals > 0) {
        const target = s.pipeline.stages.find((x) => x.id === req.body.moveToStageId && x.id !== s.id);
        if (!target) throw conflict("Esta etapa tem negociações. Escolha para qual etapa movê-las.");
        await prisma.deal.updateMany({ where: { stageId: s.id }, data: { stageId: target.id, stageChangedAt: new Date() } });
      }
      await prisma.pipelineStage.delete({ where: { id: s.id } });
      const rest = s.pipeline.stages.filter((x) => x.id !== s.id).sort((a, b) => a.position - b.position);
      await prisma.$transaction(rest.map((x, i) => prisma.pipelineStage.update({ where: { id: x.id }, data: { position: i } })));
      await writeAudit(req, { action: "pipeline.stage_deleted", entityType: "pipeline_stage", entityId: s.id, metadata: { name: s.name } });
      return { ok: true };
    },
  );

  // ── negociações ──
  app.get(
    "/deals",
    {
      schema: {
        tags: ["crm"],
        summary: "Negociações do pipeline (Kanban)",
        querystring: z.object({ pipelineId: z.uuid().optional(), status: z.enum(["OPEN", "WON", "LOST", "ARCHIVED", "ALL"]).default("ALL"), ownerId: z.uuid().optional(), q: z.string().max(100).optional(), companyId: z.uuid().optional() }),
      },
    },
    async (req) => {
      const organizationId = orgId(req);
      const pipeline = req.query.pipelineId ? await prisma.pipeline.findFirst({ where: { id: req.query.pipelineId, organizationId } }) : await defaultPipeline(organizationId);
      if (!pipeline) throw notFound();
      const where: Prisma.DealWhereInput = {
        organizationId,
        pipelineId: pipeline.id,
        ...(req.query.status === "ALL" ? { status: { not: "ARCHIVED" } } : { status: req.query.status }),
        ...(req.query.ownerId ? { ownerId: req.query.ownerId } : {}),
        ...(req.query.companyId ? { companyId: req.query.companyId } : {}),
        ...(req.query.q ? { OR: [{ title: { contains: req.query.q, mode: "insensitive" } }, { company: { name: { contains: req.query.q, mode: "insensitive" } } }] } : {}),
      };
      const deals = await prisma.deal.findMany({ where, select: dealSelect, orderBy: [{ stageId: "asc" }, { position: "asc" }, { createdAt: "desc" }], take: 2000 });
      return { pipelineId: pipeline.id, deals };
    },
  );

  const createDeal = z.object({
    companyId: z.uuid(),
    title: z.string().trim().max(200).optional(),
    stageId: z.uuid().optional(),
    valueCents: z.number().int().min(0).max(1e12).optional(),
    ownerId: z.uuid().optional(),
    expectedCloseDate: z.coerce.date().optional(),
  });

  app.post("/deals", { config: { permission: "crm:write" }, schema: { tags: ["crm"], summary: "Cria negociação para uma empresa", body: createDeal } }, async (req, reply) => {
    const organizationId = orgId(req);
    const company = await prisma.company.findFirst({ where: { id: req.body.companyId, organizationId } });
    if (!company) throw notFound("Empresa não encontrada.");
    const pipeline = await defaultPipeline(organizationId);
    const stage = req.body.stageId ? pipeline.stages.find((s) => s.id === req.body.stageId) : pipeline.stages[0];
    if (!stage) throw badRequest("Etapa inválida.");
    const deal = await prisma.deal.create({
      data: {
        organizationId, companyId: company.id, pipelineId: pipeline.id, stageId: stage.id, title: req.body.title || company.name, valueCents: req.body.valueCents,
        ownerId: req.body.ownerId ?? req.auth!.userId, expectedCloseDate: req.body.expectedCloseDate, position: Date.now() / 1000,
      },
    });
    await prisma.activity.create({ data: { organizationId, companyId: company.id, dealId: deal.id, userId: req.auth!.userId, type: "DEAL", title: "Lead enviado ao CRM", body: `Etapa: ${stage.name}` } });
    await writeAudit(req, { action: "deal.created", entityType: "deal", entityId: deal.id });
    return reply.code(201).send(deal);
  });

  app.post("/deals/bulk", { config: { permission: "crm:write" }, schema: { tags: ["crm"], summary: "Envia várias empresas ao CRM (ignora as que já têm negociação aberta)", body: z.object({ companyIds: z.array(z.uuid()).min(1).max(1000), stageId: z.uuid().optional() }) } }, async (req) => {
    const organizationId = orgId(req);
    const pipeline = await defaultPipeline(organizationId);
    const stage = req.body.stageId ? pipeline.stages.find((s) => s.id === req.body.stageId) : pipeline.stages[0];
    if (!stage) throw badRequest("Etapa inválida.");
    const companies = await prisma.company.findMany({ where: { organizationId, id: { in: req.body.companyIds } }, select: { id: true, name: true, deals: { where: { status: "OPEN" }, select: { id: true } } } });
    let created = 0;
    let base = Date.now() / 1000;
    for (const c of companies) {
      if (c.deals.length) continue;
      const deal = await prisma.deal.create({ data: { organizationId, companyId: c.id, pipelineId: pipeline.id, stageId: stage.id, title: c.name, ownerId: req.auth!.userId, position: base++ } });
      await prisma.activity.create({ data: { organizationId, companyId: c.id, dealId: deal.id, userId: req.auth!.userId, type: "DEAL", title: "Lead enviado ao CRM", body: `Etapa: ${stage.name}` } });
      created++;
    }
    await writeAudit(req, { action: "deal.bulk_created", metadata: { created } });
    return { created, skipped: req.body.companyIds.length - created };
  });

  app.patch(
    "/deals/:id",
    {
      config: { permission: "crm:write" },
      schema: {
        tags: ["crm"],
        summary: "Atualiza negociação (etapa, posição, valor, responsável, resultado)",
        params: idParams,
        body: z.object({
          stageId: z.uuid().optional(),
          position: z.number().optional(),
          title: z.string().trim().min(1).max(200).optional(),
          valueCents: z.number().int().min(0).max(1e12).nullable().optional(),
          ownerId: z.uuid().nullable().optional(),
          expectedCloseDate: z.coerce.date().nullable().optional(),
          status: z.enum(["OPEN", "WON", "LOST", "ARCHIVED"]).optional(),
          lostReason: z.string().max(300).nullable().optional(),
        }),
      },
    },
    async (req) => {
      const organizationId = orgId(req);
      const deal = await loadDeal(organizationId, req.params.id);
      const b = req.body;
      const data: Prisma.DealUncheckedUpdateInput = {};
      const activities: Prisma.ActivityCreateManyInput[] = [];
      if (b.stageId && b.stageId !== deal.stageId) {
        const stage = await prisma.pipelineStage.findFirst({ where: { id: b.stageId, pipelineId: deal.pipelineId } });
        if (!stage) throw badRequest("Etapa inválida para este pipeline.");
        data.stageId = stage.id;
        data.stageChangedAt = new Date();
        if (stage.kind === "WON") Object.assign(data, { status: "WON", closedAt: new Date() });
        else if (stage.kind === "LOST") Object.assign(data, { status: "LOST", closedAt: new Date() });
        else if (deal.status !== "OPEN") Object.assign(data, { status: "OPEN", closedAt: null });
        activities.push({ organizationId, companyId: deal.companyId, dealId: deal.id, userId: req.auth!.userId, type: "STAGE_CHANGE", title: `${deal.stage.name} → ${stage.name}`, metadata: { from: deal.stage.name, to: stage.name, fromStageId: deal.stageId, toStageId: stage.id } });
      }
      if (b.position !== undefined) data.position = b.position;
      if (b.title !== undefined) data.title = b.title;
      if (b.valueCents !== undefined && b.valueCents !== deal.valueCents) {
        data.valueCents = b.valueCents;
        activities.push({ organizationId, companyId: deal.companyId, dealId: deal.id, userId: req.auth!.userId, type: "DEAL", title: "Valor estimado alterado", metadata: { from: deal.valueCents, to: b.valueCents } });
      }
      if (b.ownerId !== undefined) {
        if (b.ownerId && !(await prisma.membership.findFirst({ where: { organizationId, userId: b.ownerId } }))) throw badRequest("Responsável inválido.");
        data.ownerId = b.ownerId;
      }
      if (b.expectedCloseDate !== undefined) data.expectedCloseDate = b.expectedCloseDate;
      if (b.status && b.status !== deal.status) {
        data.status = b.status;
        data.closedAt = b.status === "WON" || b.status === "LOST" ? new Date() : null;
        activities.push({ organizationId, companyId: deal.companyId, dealId: deal.id, userId: req.auth!.userId, type: "DEAL", title: { WON: "Negociação ganha", LOST: "Negociação perdida", OPEN: "Negociação reaberta", ARCHIVED: "Negociação arquivada" }[b.status], body: b.lostReason ?? undefined });
      }
      if (b.lostReason !== undefined) data.lostReason = b.lostReason;
      await prisma.$transaction([prisma.deal.update({ where: { id: deal.id }, data }), prisma.activity.createMany({ data: activities })]);
      if (activities.length) await writeAudit(req, { action: "deal.updated", entityType: "deal", entityId: deal.id, metadata: { fields: Object.keys(data) } });
      return prisma.deal.findUnique({ where: { id: deal.id }, select: dealSelect });
    },
  );

  app.get("/deals/:id/history", { schema: { tags: ["crm"], summary: "Histórico da negociação", params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    const deal = await loadDeal(organizationId, req.params.id);
    return prisma.activity.findMany({ where: { organizationId, dealId: deal.id }, orderBy: { occurredAt: "desc" }, include: { user: { select: { name: true } } } });
  });
};
