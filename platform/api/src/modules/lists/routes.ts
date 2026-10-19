import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../lib/prisma.ts";
import { notFound } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { orgId } from "../../plugins/auth.ts";

const idParams = z.object({ id: z.uuid() });

async function loadList(organizationId: string, id: string) {
  const list = await prisma.companyList.findFirst({ where: { id, organizationId } });
  if (!list) throw notFound("Lista não encontrada.");
  return list;
}

/** Garante que todas as empresas pertencem à organização (autorização por recurso). */
async function ownedCompanyIds(organizationId: string, ids: string[]) {
  const rows = await prisma.company.findMany({ where: { organizationId, id: { in: ids } }, select: { id: true } });
  return rows.map((r) => r.id);
}

export const listRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/lists", { schema: { tags: ["lists"], summary: "Listas de empresas da organização" } }, async (req) => {
    const lists = await prisma.companyList.findMany({ where: { organizationId: orgId(req) }, orderBy: { updatedAt: "desc" }, include: { _count: { select: { items: true } } } });
    return lists.map((l) => ({ id: l.id, name: l.name, description: l.description, createdAt: l.createdAt, updatedAt: l.updatedAt, count: l._count.items }));
  });

  app.post(
    "/lists",
    { config: { permission: "companies:write" }, schema: { tags: ["lists"], summary: "Cria uma lista (opcionalmente já com empresas)", body: z.object({ name: z.string().trim().min(1).max(120), description: z.string().max(500).optional(), companyIds: z.array(z.uuid()).max(5000).optional() }) } },
    async (req, reply) => {
      const organizationId = orgId(req);
      const ids = req.body.companyIds?.length ? await ownedCompanyIds(organizationId, req.body.companyIds) : [];
      const list = await prisma.companyList.create({
        data: { organizationId, name: req.body.name, description: req.body.description, createdById: req.auth!.userId, items: { create: ids.map((companyId) => ({ companyId })) } },
      });
      await writeAudit(req, { action: "list.created", entityType: "company_list", entityId: list.id, metadata: { items: ids.length } });
      return reply.code(201).send({ id: list.id, added: ids.length });
    },
  );

  app.get("/lists/:id", { schema: { tags: ["lists"], summary: "Empresas de uma lista", params: idParams } }, async (req) => {
    const list = await loadList(orgId(req), req.params.id);
    const items = await prisma.companyListItem.findMany({
      where: { listId: list.id },
      orderBy: { addedAt: "desc" },
      include: { company: { select: { id: true, name: true, category: true, city: true, state: true, website: true, primaryPhone: true, primaryEmail: true, rating: true, reviewCount: true, enrichmentStatus: true, status: true } } },
    });
    return { ...list, items: items.map((i) => ({ ...i.company, addedAt: i.addedAt })) };
  });

  app.patch("/lists/:id", { config: { permission: "companies:write" }, schema: { tags: ["lists"], params: idParams, body: z.object({ name: z.string().trim().min(1).max(120).optional(), description: z.string().max(500).nullable().optional() }) } }, async (req) => {
    const list = await loadList(orgId(req), req.params.id);
    await prisma.companyList.update({ where: { id: list.id }, data: req.body });
    return { ok: true };
  });

  app.post("/lists/:id/items", { config: { permission: "companies:write" }, schema: { tags: ["lists"], summary: "Adiciona empresas à lista", params: idParams, body: z.object({ companyIds: z.array(z.uuid()).min(1).max(5000) }) } }, async (req) => {
    const organizationId = orgId(req);
    const list = await loadList(organizationId, req.params.id);
    const ids = await ownedCompanyIds(organizationId, req.body.companyIds);
    const res = await prisma.companyListItem.createMany({ data: ids.map((companyId) => ({ listId: list.id, companyId })), skipDuplicates: true });
    await prisma.companyList.update({ where: { id: list.id }, data: { updatedAt: new Date() } });
    return { added: res.count };
  });

  app.delete("/lists/:id/items/:companyId", { config: { permission: "companies:write" }, schema: { tags: ["lists"], params: z.object({ id: z.uuid(), companyId: z.uuid() }) } }, async (req) => {
    const list = await loadList(orgId(req), req.params.id);
    await prisma.companyListItem.deleteMany({ where: { listId: list.id, companyId: req.params.companyId } });
    return { ok: true };
  });

  app.delete("/lists/:id", { config: { permission: "companies:write" }, schema: { tags: ["lists"], summary: "Exclui a lista (as empresas permanecem)", params: idParams } }, async (req) => {
    const list = await loadList(orgId(req), req.params.id);
    await prisma.companyList.delete({ where: { id: list.id } });
    await writeAudit(req, { action: "list.deleted", entityType: "company_list", entityId: list.id });
    return { ok: true };
  });
};
