import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { badRequest, forbidden, notFound } from "../../lib/errors.ts";
import { pageResult, paginate } from "../../lib/pagination.ts";
import { orgId } from "../../plugins/auth.ts";

const idParams = z.object({ id: z.uuid() });

async function assertCompany(organizationId: string, companyId?: string | null) {
  if (!companyId) return null;
  const c = await prisma.company.findFirst({ where: { id: companyId, organizationId }, select: { id: true } });
  if (!c) throw notFound("Empresa não encontrada.");
  return c.id;
}
async function assertDeal(organizationId: string, dealId?: string | null) {
  if (!dealId) return null;
  const d = await prisma.deal.findFirst({ where: { id: dealId, organizationId }, select: { id: true, companyId: true } });
  if (!d) throw notFound("Negociação não encontrada.");
  return d;
}
async function assertMember(organizationId: string, userId?: string | null) {
  if (!userId) return null;
  const m = await prisma.membership.findFirst({ where: { organizationId, userId } });
  if (!m) throw badRequest("Responsável não pertence à organização.");
  return userId;
}

const taskBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(4000).nullable().optional(),
  type: z.enum(["TODO", "CALL", "MEETING", "EMAIL", "WHATSAPP", "FOLLOW_UP"]).default("TODO"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH"]).default("MEDIUM"),
  dueAt: z.coerce.date().nullable().optional(),
  remindAt: z.coerce.date().nullable().optional(),
  companyId: z.uuid().nullable().optional(),
  dealId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
});

export const workRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── tarefas e lembretes ──
  app.get(
    "/tasks",
    {
      schema: {
        tags: ["tasks"],
        summary: "Lista tarefas (minhas, atrasadas, hoje, próximas)",
        querystring: z.object({
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(200).default(50),
          scope: z.enum(["mine", "all"]).default("mine"),
          when: z.enum(["overdue", "today", "upcoming", "nodate", "all"]).default("all"),
          status: z.enum(["OPEN", "DONE", "CANCELLED", "ALL"]).default("OPEN"),
          companyId: z.uuid().optional(),
          dealId: z.uuid().optional(),
        }),
      },
    },
    async (req) => {
      const organizationId = orgId(req);
      const q = req.query;
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      const end = new Date(start.getTime() + 24 * 3600 * 1000);
      const where: Prisma.TaskWhereInput = {
        organizationId,
        ...(q.status !== "ALL" ? { status: q.status } : {}),
        ...(q.scope === "mine" && !q.companyId && !q.dealId ? { OR: [{ assigneeId: req.auth!.userId }, { assigneeId: null, createdById: req.auth!.userId }] } : {}),
        ...(q.companyId ? { companyId: q.companyId } : {}),
        ...(q.dealId ? { dealId: q.dealId } : {}),
        ...(q.when === "overdue" ? { dueAt: { lt: new Date() } } : q.when === "today" ? { dueAt: { gte: start, lt: end } } : q.when === "upcoming" ? { dueAt: { gte: end } } : q.when === "nodate" ? { dueAt: null } : {}),
      };
      const [items, total] = await Promise.all([
        prisma.task.findMany({
          where,
          orderBy: [{ status: "asc" }, { dueAt: { sort: "asc", nulls: "last" } }, { priority: "desc" }, { createdAt: "desc" }],
          ...paginate(q.page, q.pageSize),
          include: { company: { select: { id: true, name: true } }, deal: { select: { id: true, title: true } }, assignee: { select: { id: true, name: true } } },
        }),
        prisma.task.count({ where }),
      ]);
      return pageResult(items, total, q.page, q.pageSize);
    },
  );

  app.get("/tasks/summary", { schema: { tags: ["tasks"], summary: "Contagens de tarefas do usuário" } }, async (req) => {
    const organizationId = orgId(req);
    const mine = { organizationId, status: "OPEN" as const, OR: [{ assigneeId: req.auth!.userId }, { assigneeId: null, createdById: req.auth!.userId }] };
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start.getTime() + 24 * 3600 * 1000);
    const [overdue, today, open] = await Promise.all([
      prisma.task.count({ where: { ...mine, dueAt: { lt: new Date() } } }),
      prisma.task.count({ where: { ...mine, dueAt: { gte: start, lt: end } } }),
      prisma.task.count({ where: mine }),
    ]);
    return { overdue, today, open };
  });

  app.post("/tasks", { config: { permission: "tasks:write" }, schema: { tags: ["tasks"], body: taskBody } }, async (req, reply) => {
    const organizationId = orgId(req);
    const b = req.body;
    const deal = await assertDeal(organizationId, b.dealId);
    const companyId = (await assertCompany(organizationId, b.companyId)) ?? deal?.companyId ?? null;
    const assigneeId = (await assertMember(organizationId, b.assigneeId)) ?? req.auth!.userId;
    const task = await prisma.task.create({
      data: { organizationId, title: b.title, description: b.description ?? null, type: b.type, priority: b.priority, dueAt: b.dueAt ?? null, remindAt: b.remindAt ?? b.dueAt ?? null, companyId, dealId: deal?.id ?? null, assigneeId, createdById: req.auth!.userId },
    });
    if (companyId) await prisma.activity.create({ data: { organizationId, companyId, dealId: deal?.id, userId: req.auth!.userId, type: "TASK", title: `Tarefa criada: ${b.title}`, metadata: { taskId: task.id, dueAt: b.dueAt ?? null } } });
    return reply.code(201).send(task);
  });

  app.patch("/tasks/:id", { config: { permission: "tasks:write" }, schema: { tags: ["tasks"], params: idParams, body: taskBody.partial().extend({ status: z.enum(["OPEN", "DONE", "CANCELLED"]).optional() }) } }, async (req) => {
    const organizationId = orgId(req);
    const task = await prisma.task.findFirst({ where: { id: req.params.id, organizationId } });
    if (!task) throw notFound("Tarefa não encontrada.");
    const b = req.body;
    if (b.assigneeId !== undefined) await assertMember(organizationId, b.assigneeId);
    const data: Prisma.TaskUncheckedUpdateInput = { ...b, companyId: undefined, dealId: undefined };
    if (b.status && b.status !== task.status) {
      data.completedAt = b.status === "DONE" ? new Date() : null;
      if (b.status === "DONE" && task.companyId) {
        await prisma.activity.create({ data: { organizationId, companyId: task.companyId, dealId: task.dealId, userId: req.auth!.userId, type: "TASK", title: `Tarefa concluída: ${task.title}`, metadata: { taskId: task.id } } });
      }
    }
    if (b.dueAt !== undefined && b.remindAt === undefined) {
      data.remindAt = b.dueAt;
      data.remindedAt = null;
    }
    return prisma.task.update({ where: { id: task.id }, data });
  });

  app.delete("/tasks/:id", { config: { permission: "tasks:write" }, schema: { tags: ["tasks"], params: idParams } }, async (req) => {
    const task = await prisma.task.findFirst({ where: { id: req.params.id, organizationId: orgId(req) } });
    if (!task) throw notFound();
    if (task.createdById !== req.auth!.userId && !["OWNER", "ADMIN", "MANAGER"].includes(req.auth!.role)) throw forbidden("Só quem criou a tarefa ou um gestor pode excluí-la.");
    await prisma.task.delete({ where: { id: task.id } });
    return { ok: true };
  });

  // ── atividades: ligações, reuniões, e-mails registrados manualmente ──
  app.post(
    "/activities",
    {
      config: { permission: "crm:write" },
      schema: {
        tags: ["activities"],
        summary: "Registra ligação, reunião, e-mail ou anotação na linha do tempo",
        body: z.object({
          companyId: z.uuid(),
          dealId: z.uuid().optional(),
          type: z.enum(["CALL", "MEETING", "EMAIL", "NOTE", "WHATSAPP"]),
          title: z.string().trim().min(1).max(200),
          body: z.string().max(5000).optional(),
          occurredAt: z.coerce.date().optional(),
          durationMin: z.number().int().min(0).max(1440).optional(),
          outcome: z.enum(["CONNECTED", "NO_ANSWER", "VOICEMAIL", "WRONG_NUMBER", "SCHEDULED", "DONE", "CANCELLED", "OTHER"]).optional(),
          participants: z.string().max(300).optional(),
        }),
      },
    },
    async (req, reply) => {
      const organizationId = orgId(req);
      const b = req.body;
      const companyId = await assertCompany(organizationId, b.companyId);
      const deal = await assertDeal(organizationId, b.dealId);
      const a = await prisma.activity.create({
        data: {
          organizationId, companyId, dealId: deal?.id, userId: req.auth!.userId, type: b.type, title: b.title, body: b.body,
          occurredAt: b.occurredAt ?? new Date(), metadata: { durationMin: b.durationMin ?? null, outcome: b.outcome ?? null, participants: b.participants ?? null },
        },
      });
      return reply.code(201).send(a);
    },
  );

  app.get("/activities/recent", { schema: { tags: ["activities"], querystring: z.object({ take: z.coerce.number().int().min(1).max(100).default(20) }) } }, async (req) =>
    prisma.activity.findMany({
      where: { organizationId: orgId(req) },
      orderBy: { occurredAt: "desc" },
      take: req.query.take,
      include: { user: { select: { name: true } }, company: { select: { id: true, name: true } } },
    }),
  );

  // ── anotações ──
  app.get("/companies/:id/notes", { schema: { tags: ["notes"], params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    await assertCompany(organizationId, req.params.id);
    return prisma.note.findMany({ where: { companyId: req.params.id, organizationId }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], include: { author: { select: { id: true, name: true } } } });
  });

  app.post("/companies/:id/notes", { config: { permission: "crm:write" }, schema: { tags: ["notes"], params: idParams, body: z.object({ body: z.string().trim().min(1).max(10_000), dealId: z.uuid().optional(), pinned: z.boolean().default(false) }) } }, async (req, reply) => {
    const organizationId = orgId(req);
    const companyId = (await assertCompany(organizationId, req.params.id))!;
    const deal = await assertDeal(organizationId, req.body.dealId);
    const note = await prisma.note.create({ data: { organizationId, companyId, dealId: deal?.id, authorId: req.auth!.userId, body: req.body.body, pinned: req.body.pinned } });
    await prisma.activity.create({ data: { organizationId, companyId, dealId: deal?.id, userId: req.auth!.userId, type: "NOTE", title: "Anotação adicionada", body: req.body.body.slice(0, 280), metadata: { noteId: note.id } } });
    return reply.code(201).send(note);
  });

  app.patch("/notes/:id", { config: { permission: "crm:write" }, schema: { tags: ["notes"], params: idParams, body: z.object({ body: z.string().trim().min(1).max(10_000).optional(), pinned: z.boolean().optional() }) } }, async (req) => {
    const note = await prisma.note.findFirst({ where: { id: req.params.id, organizationId: orgId(req) } });
    if (!note) throw notFound();
    if (req.body.body !== undefined && note.authorId !== req.auth!.userId) throw forbidden("Só o autor pode editar o texto da anotação.");
    return prisma.note.update({ where: { id: note.id }, data: req.body });
  });

  app.delete("/notes/:id", { config: { permission: "crm:write" }, schema: { tags: ["notes"], params: idParams } }, async (req) => {
    const note = await prisma.note.findFirst({ where: { id: req.params.id, organizationId: orgId(req) } });
    if (!note) throw notFound();
    if (note.authorId !== req.auth!.userId && !["OWNER", "ADMIN"].includes(req.auth!.role)) throw forbidden();
    await prisma.note.delete({ where: { id: note.id } });
    return { ok: true };
  });
};
