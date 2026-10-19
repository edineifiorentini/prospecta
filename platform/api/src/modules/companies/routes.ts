import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { badRequest, notFound } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { toCsv } from "../../lib/csv.ts";
import { pageResult, paginate } from "../../lib/pagination.ts";
import { normAddress, normDomain, normName, normalizeEmail, normalizePhone, safeHttpUrl } from "../../lib/normalize.ts";
import { orgId } from "../../plugins/auth.ts";
import { upsertDiscovered } from "./upsert.ts";

const idParams = z.object({ id: z.uuid() });
const tri = z.enum(["any", "with", "without"]).optional();

export const companyListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "ARCHIVED", "ALL"]).default("ACTIVE"),
  city: z.string().max(80).optional(),
  category: z.string().max(80).optional(),
  website: tri,
  phone: tri,
  email: tri,
  social: tri,
  minRating: z.coerce.number().min(0).max(5).optional(),
  maxRating: z.coerce.number().min(0).max(5).optional(),
  minReviews: z.coerce.number().int().min(0).optional(),
  maxReviews: z.coerce.number().int().min(0).optional(),
  enrichment: z.string().max(20).optional(),
  source: z.string().max(30).optional(),
  inCrm: z.enum(["yes", "no"]).optional(),
  tagId: z.uuid().optional(),
  listId: z.uuid().optional(),
  ownerId: z.uuid().optional(),
  minOpportunity: z.coerce.number().int().min(0).max(100).optional(),
  minDataQuality: z.coerce.number().int().min(0).max(100).optional(),
  maxDataQuality: z.coerce.number().int().min(0).max(100).optional(),
  sort: z.enum(["name", "createdAt", "rating", "reviewCount", "city", "updatedAt"]).default("createdAt"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});
export type CompanyListQuery = z.infer<typeof companyListQuery>;

export function companyWhere(organizationId: string, q: Partial<CompanyListQuery>): Prisma.CompanyWhereInput {
  const and: Prisma.CompanyWhereInput[] = [{ organizationId }];
  if (q.status && q.status !== "ALL") and.push({ status: q.status });
  if (q.q) {
    const term = q.q;
    and.push({
      OR: [
        { name: { contains: term, mode: "insensitive" } },
        { legalName: { contains: term, mode: "insensitive" } },
        { domain: { contains: term.toLowerCase() } },
        { contacts: { some: { normalizedValue: { contains: term.toLowerCase().replace(/[^\d+a-z@._-]/g, "") || term } } } },
        { category: { contains: term, mode: "insensitive" } },
      ],
    });
  }
  if (q.city) and.push({ city: { equals: q.city, mode: "insensitive" } });
  if (q.category) and.push({ category: { contains: q.category, mode: "insensitive" } });
  if (q.website === "with") and.push({ website: { not: null } });
  if (q.website === "without") and.push({ website: null });
  if (q.phone === "with") and.push({ contacts: { some: { type: { in: ["PHONE", "WHATSAPP"] }, status: { not: "INVALID" } } } });
  if (q.phone === "without") and.push({ contacts: { none: { type: { in: ["PHONE", "WHATSAPP"] }, status: { not: "INVALID" } } } });
  if (q.email === "with") and.push({ contacts: { some: { type: "EMAIL", status: { not: "INVALID" } } } });
  if (q.email === "without") and.push({ contacts: { none: { type: "EMAIL", status: { not: "INVALID" } } } });
  if (q.social === "with") and.push({ socialProfiles: { some: { status: { not: "INVALID" } } } });
  if (q.social === "without") and.push({ socialProfiles: { none: { status: { not: "INVALID" } } } });
  if (q.minRating !== undefined) and.push({ rating: { gte: q.minRating } });
  if (q.maxRating !== undefined) and.push({ rating: { lte: q.maxRating } });
  if (q.minReviews !== undefined) and.push({ reviewCount: { gte: q.minReviews } });
  if (q.maxReviews !== undefined) and.push({ reviewCount: { lte: q.maxReviews } });
  if (q.enrichment) and.push({ enrichmentStatus: q.enrichment as never });
  if (q.source) and.push({ leadSources: { some: { sourceType: q.source as never } } });
  if (q.inCrm === "yes") and.push({ deals: { some: {} } });
  if (q.inCrm === "no") and.push({ deals: { none: {} } });
  if (q.tagId) and.push({ tags: { some: { tagId: q.tagId } } });
  if (q.listId) and.push({ listItems: { some: { listId: q.listId } } });
  if (q.ownerId) and.push({ ownerId: q.ownerId });
  if (q.minOpportunity !== undefined) and.push({ scores: { some: { kind: "OPPORTUNITY", score: { gte: q.minOpportunity } } } });
  if (q.minDataQuality !== undefined) and.push({ scores: { some: { kind: "DATA_QUALITY", score: { gte: q.minDataQuality } } } });
  if (q.maxDataQuality !== undefined) and.push({ scores: { some: { kind: "DATA_QUALITY", score: { lte: q.maxDataQuality } } } });
  return { AND: and };
}

const LIST_SELECT = {
  id: true, name: true, legalName: true, category: true, website: true, domain: true, primaryPhone: true, primaryEmail: true, address: true, neighborhood: true,
  city: true, state: true, rating: true, reviewCount: true, enrichmentStatus: true, status: true, createdAt: true, updatedAt: true, lastEnrichedAt: true, lastAuditedAt: true,
  owner: { select: { id: true, name: true } },
  tags: { select: { tag: { select: { id: true, name: true, color: true } } } },
  scores: { select: { kind: true, score: true, confidence: true } },
  deals: { where: { status: "OPEN" as const }, select: { id: true, stage: { select: { name: true } } }, take: 1 },
  _count: { select: { socialProfiles: true } },
} satisfies Prisma.CompanySelect;

/** Campos editáveis manualmente (a edição vira procedência MANUAL e entra no histórico). */
const editableSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  legalName: z.string().trim().max(200).nullable().optional(),
  cnpj: z.string().trim().max(20).nullable().optional(),
  category: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  website: z.string().trim().max(500).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  neighborhood: z.string().trim().max(120).nullable().optional(),
  city: z.string().trim().max(120).nullable().optional(),
  state: z.string().trim().max(60).nullable().optional(),
  postalCode: z.string().trim().max(20).nullable().optional(),
  country: z.string().trim().max(60).nullable().optional(),
  ownerId: z.uuid().nullable().optional(),
});

export const companyRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/companies", { schema: { tags: ["companies"], summary: "Lista empresas com filtros combináveis", querystring: companyListQuery } }, async (req) => {
    const q = req.query;
    const where = companyWhere(orgId(req), q);
    const [items, total] = await Promise.all([
      prisma.company.findMany({ where, select: LIST_SELECT, orderBy: [{ [q.sort]: { sort: q.dir, nulls: "last" } }, { id: "asc" }] as Prisma.CompanyOrderByWithRelationInput[], ...paginate(q.page, q.pageSize) }),
      prisma.company.count({ where }),
    ]);
    return pageResult(items, total, q.page, q.pageSize);
  });

  app.get("/companies/facets", { schema: { tags: ["companies"], summary: "Valores para filtros (cidades, categorias, etiquetas, responsáveis)" } }, async (req) => {
    const organizationId = orgId(req);
    const [cities, categories, tags, members] = await Promise.all([
      prisma.company.groupBy({ by: ["city"], where: { organizationId, status: "ACTIVE", city: { not: null } }, _count: true, orderBy: { _count: { city: "desc" } }, take: 50 }),
      prisma.company.groupBy({ by: ["category"], where: { organizationId, status: "ACTIVE", category: { not: null } }, _count: true, orderBy: { _count: { category: "desc" } }, take: 50 }),
      prisma.tag.findMany({ where: { organizationId }, orderBy: { name: "asc" } }),
      prisma.membership.findMany({ where: { organizationId }, select: { user: { select: { id: true, name: true } } } }),
    ]);
    return {
      cities: cities.map((c) => ({ value: c.city!, count: c._count })),
      categories: categories.map((c) => ({ value: c.category!, count: c._count })),
      tags,
      owners: members.map((m) => m.user),
    };
  });

  app.get("/companies/export.csv", { config: { permission: "export:run" }, schema: { tags: ["companies"], summary: "Exporta empresas filtradas (CSV)", querystring: companyListQuery.omit({ page: true, pageSize: true }) } }, async (req, reply) => {
    const where = companyWhere(orgId(req), req.query);
    const rows = await prisma.company.findMany({
      where,
      take: 20_000,
      orderBy: { name: "asc" },
      include: { contacts: true, socialProfiles: true, scores: true, tags: { include: { tag: true } }, deals: { where: { status: "OPEN" }, include: { stage: true } } },
    });
    const score = (c: (typeof rows)[number], k: string) => c.scores.find((s) => s.kind === k)?.score ?? "não avaliado";
    const contacts = (c: (typeof rows)[number], t: string) => c.contacts.filter((x) => x.type === t && x.status !== "INVALID").map((x) => `${x.normalizedValue} (${x.status.toLowerCase()})`);
    const csv = toCsv(
      [
        { key: "name", label: "Nome comercial" }, { key: "legalName", label: "Razão social" }, { key: "cnpj", label: "CNPJ" }, { key: "category", label: "Categoria" },
        { key: "phones", label: "Telefones" }, { key: "whatsapp", label: "WhatsApp" }, { key: "emails", label: "E-mails" }, { key: "website", label: "Site" },
        { key: "address", label: "Endereço" }, { key: "neighborhood", label: "Bairro" }, { key: "city", label: "Cidade" }, { key: "state", label: "UF" }, { key: "postalCode", label: "CEP" },
        { key: "rating", label: "Nota pública" }, { key: "reviewCount", label: "Avaliações" }, { key: "socials", label: "Redes sociais" }, { key: "tags", label: "Etiquetas" },
        { key: "stage", label: "Etapa no CRM" }, { key: "dq", label: "Qualidade dos dados" }, { key: "opp", label: "Oportunidade" }, { key: "sourceUrl", label: "Ficha pública" }, { key: "collectedAt", label: "Coletado em" },
      ],
      rows.map((c) => ({
        ...c,
        phones: contacts(c, "PHONE"),
        whatsapp: contacts(c, "WHATSAPP"),
        emails: contacts(c, "EMAIL"),
        socials: c.socialProfiles.filter((s) => s.status !== "INVALID").map((s) => s.url),
        tags: c.tags.map((t) => t.tag.name),
        stage: c.deals[0]?.stage.name ?? "",
        dq: score(c, "DATA_QUALITY"),
        opp: score(c, "OPPORTUNITY"),
        collectedAt: c.collectedAt.toISOString(),
      })),
    );
    await writeAudit(req, { action: "companies.exported", metadata: { rows: rows.length, filters: req.query } });
    return reply.header("Content-Type", "text/csv; charset=utf-8").header("Content-Disposition", `attachment; filename="empresas-${new Date().toISOString().slice(0, 10)}.csv"`).send(csv);
  });

  app.get("/companies/:id", { schema: { tags: ["companies"], summary: "Ficha completa da empresa", params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    const c = await prisma.company.findFirst({
      where: { id: req.params.id, organizationId },
      include: {
        owner: { select: { id: true, name: true } },
        contacts: { orderBy: [{ type: "asc" }, { isPrimary: "desc" }, { confidence: "desc" }] },
        websites: true,
        socialProfiles: { orderBy: [{ status: "asc" }, { confidence: "desc" }] },
        leadSources: { orderBy: { collectedAt: "desc" }, select: { id: true, sourceType: true, sourceRef: true, sourceUrl: true, collectedAt: true, searchJob: { select: { id: true, name: true } } } },
        scores: true,
        tags: { include: { tag: true } },
        listItems: { include: { list: { select: { id: true, name: true } } } },
        deals: { orderBy: { createdAt: "desc" }, include: { stage: true, pipeline: { select: { id: true, name: true } }, owner: { select: { id: true, name: true } } } },
        enrichmentJobs: { orderBy: { createdAt: "desc" }, take: 1 },
        audits: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, scores: true, summary: true, createdAt: true, finishedAt: true } },
        searchResults: { orderBy: { createdAt: "desc" }, take: 20, select: { searchJob: { select: { id: true, name: true, createdAt: true, provider: true } } } },
      },
    });
    if (!c) throw notFound("Empresa não encontrada.");
    // última procedência conhecida por campo
    const fieldRows = await prisma.companyFieldSource.findMany({ where: { companyId: c.id }, orderBy: { observedAt: "desc" }, take: 400 });
    const provenance: Record<string, (typeof fieldRows)[number]> = {};
    for (const f of fieldRows) provenance[f.field] ??= f;
    const searches = [...new Map(c.searchResults.map((r) => [r.searchJob.id, r.searchJob])).values()];
    const { searchResults: _sr, ...rest } = c;
    return { ...rest, provenance, searches };
  });

  app.post(
    "/companies",
    {
      config: { permission: "companies:write" },
      schema: {
        tags: ["companies"],
        summary: "Cadastro manual de empresa (com deduplicação)",
        body: editableSchema.extend({ name: z.string().trim().min(1).max(200), phone: z.string().max(40).optional(), email: z.string().max(200).optional() }),
      },
    },
    async (req, reply) => {
      const b = req.body;
      const website = b.website ? safeHttpUrl(b.website) : null;
      if (b.website && !website) throw badRequest("Site inválido. Use um endereço http(s).");
      const r = await upsertDiscovered(
        { organizationId: orgId(req), source: "MANUAL", sourceRef: `usuário ${req.auth!.name}`, userId: req.auth!.userId },
        {
          name: b.name, legalName: b.legalName ?? null, cnpj: b.cnpj?.replace(/\D/g, "") || null, category: b.category ?? null, description: b.description ?? null, website,
          phones: b.phone ? [b.phone] : [], emails: b.email ? [b.email] : [], address: b.address ?? null, neighborhood: b.neighborhood ?? null, city: b.city ?? null,
          state: b.state ?? null, postalCode: b.postalCode ?? null, country: b.country ?? "BR", raw: { manual: true },
        },
      );
      if (b.ownerId) await prisma.company.update({ where: { id: r.companyId }, data: { ownerId: b.ownerId } });
      await writeAudit(req, { action: r.isNew ? "company.created" : "company.merged_manual", entityType: "company", entityId: r.companyId });
      return reply.code(r.isNew ? 201 : 200).send({ id: r.companyId, isNew: r.isNew, matchedBy: r.matchedBy });
    },
  );

  app.patch("/companies/:id", { config: { permission: "companies:write" }, schema: { tags: ["companies"], summary: "Edição de campos (registra histórico e procedência manual)", params: idParams, body: editableSchema } }, async (req) => {
    const organizationId = orgId(req);
    const c = await prisma.company.findFirst({ where: { id: req.params.id, organizationId } });
    if (!c) throw notFound();
    const b = req.body;
    const data: Prisma.CompanyUncheckedUpdateInput = {};
    const diff: Record<string, { from: unknown; to: unknown }> = {};
    for (const [k, v] of Object.entries(b)) {
      if (v === undefined) continue;
      let value = v as string | null;
      if (k === "website" && value) {
        value = safeHttpUrl(value);
        if (!value) throw badRequest("Site inválido.");
      }
      if (k === "cnpj" && value) value = value.replace(/\D/g, "") || null;
      if (k === "ownerId" && value) {
        const member = await prisma.membership.findFirst({ where: { organizationId, userId: value } });
        if (!member) throw badRequest("Responsável não pertence à organização.");
      }
      if ((c as Record<string, unknown>)[k] === value) continue;
      diff[k] = { from: (c as Record<string, unknown>)[k] ?? null, to: value };
      (data as Record<string, unknown>)[k] = value;
    }
    if (!Object.keys(diff).length) return { ok: true, changed: 0 };
    if ("name" in data) data.normName = normName(String(data.name));
    if ("address" in data) data.normAddress = normAddress(data.address as string | null);
    if ("website" in data) {
      data.domain = normDomain(data.website as string | null);
      data.normDomain = data.domain;
      data.enrichmentStatus = data.website ? "NOT_STARTED" : "SKIPPED";
    }
    await prisma.$transaction([
      prisma.company.update({ where: { id: c.id }, data }),
      prisma.companyFieldSource.createMany({
        data: Object.entries(diff)
          .filter(([k]) => k !== "ownerId")
          .map(([field, d]) => ({ organizationId, companyId: c.id, field, value: d.to == null ? null : String(d.to).slice(0, 1000), source: "MANUAL" as const, sourceRef: req.auth!.name, status: "VERIFIED" as const, confidence: 0.9 })),
      }),
      prisma.activity.create({ data: { organizationId, companyId: c.id, userId: req.auth!.userId, type: "FIELD_CHANGE", title: "Dados alterados", body: Object.keys(diff).join(", "), metadata: { diff } as Prisma.InputJsonValue } }),
    ]);
    await writeAudit(req, { action: "company.updated", entityType: "company", entityId: c.id, metadata: { fields: Object.keys(diff) } });
    return { ok: true, changed: Object.keys(diff).length };
  });

  app.post("/companies/:id/archive", { config: { permission: "companies:write" }, schema: { tags: ["companies"], params: idParams, body: z.object({ archived: z.boolean() }) } }, async (req) => {
    const organizationId = orgId(req);
    const c = await prisma.company.findFirst({ where: { id: req.params.id, organizationId } });
    if (!c) throw notFound();
    await prisma.company.update({ where: { id: c.id }, data: { status: req.body.archived ? "ARCHIVED" : "ACTIVE", archivedAt: req.body.archived ? new Date() : null } });
    await prisma.activity.create({ data: { organizationId, companyId: c.id, userId: req.auth!.userId, type: "SYSTEM", title: req.body.archived ? "Empresa arquivada" : "Empresa reativada" } });
    await writeAudit(req, { action: req.body.archived ? "company.archived" : "company.unarchived", entityType: "company", entityId: c.id });
    return { ok: true };
  });

  app.post("/companies/bulk-archive", { config: { permission: "companies:write" }, schema: { tags: ["companies"], body: z.object({ companyIds: z.array(z.uuid()).min(1).max(1000), archived: z.boolean() }) } }, async (req) => {
    const r = await prisma.company.updateMany({ where: { organizationId: orgId(req), id: { in: req.body.companyIds } }, data: { status: req.body.archived ? "ARCHIVED" : "ACTIVE", archivedAt: req.body.archived ? new Date() : null } });
    await writeAudit(req, { action: "company.bulk_archive", metadata: { count: r.count, archived: req.body.archived } });
    return { updated: r.count };
  });

  // exclusão definitiva: só para administradores; preserva trilha de auditoria (sem dados pessoais)
  app.delete("/companies/:id", { config: { permission: "companies:delete" }, schema: { tags: ["companies"], summary: "Exclusão definitiva (política de retenção/LGPD)", params: idParams, body: z.object({ reason: z.string().trim().min(3).max(300) }) } }, async (req) => {
    const organizationId = orgId(req);
    const c = await prisma.company.findFirst({ where: { id: req.params.id, organizationId }, select: { id: true, name: true } });
    if (!c) throw notFound();
    await prisma.company.delete({ where: { id: c.id } });
    await writeAudit(req, { action: "company.deleted", entityType: "company", entityId: c.id, metadata: { reason: req.body.reason } });
    return { ok: true };
  });

  // ── contatos manuais ──
  app.post(
    "/companies/:id/contacts",
    { config: { permission: "companies:write" }, schema: { tags: ["companies"], params: idParams, body: z.object({ type: z.enum(["EMAIL", "PHONE", "WHATSAPP"]), value: z.string().trim().min(3).max(200), label: z.string().max(60).optional() }) } },
    async (req, reply) => {
      const organizationId = orgId(req);
      const c = await prisma.company.findFirst({ where: { id: req.params.id, organizationId } });
      if (!c) throw notFound();
      const { type, value, label } = req.body;
      let normalized: string | null;
      let verification: Prisma.InputJsonValue = { manual: true, recordedBy: req.auth!.name };
      if (type === "EMAIL") normalized = normalizeEmail(value);
      else {
        const p = normalizePhone(value);
        normalized = p?.valid ? p.e164 : null;
        verification = { ...verification as object, e164Valid: !!p?.valid, numberType: p?.type ?? null };
      }
      if (!normalized) throw badRequest(type === "EMAIL" ? "E-mail inválido." : "Telefone inválido. Inclua o DDD.");
      const contact = await prisma.contact.upsert({
        where: { companyId_type_normalizedValue: { companyId: c.id, type, normalizedValue: normalized } },
        create: { organizationId, companyId: c.id, type, value, normalizedValue: normalized, label, source: "MANUAL", status: "FOUND", confidence: 0.85, verification },
        update: { label },
      });
      if (type === "EMAIL" && !c.primaryEmail) await prisma.company.update({ where: { id: c.id }, data: { primaryEmail: normalized } });
      if (type !== "EMAIL" && !c.primaryPhone) await prisma.company.update({ where: { id: c.id }, data: { primaryPhone: normalized, normPhone: normalized } });
      await prisma.companyFieldSource.create({ data: { organizationId, companyId: c.id, field: type.toLowerCase(), value: normalized, source: "MANUAL", sourceRef: req.auth!.name, status: "FOUND", confidence: 0.85 } });
      return reply.code(201).send(contact);
    },
  );

  app.delete("/companies/:id/contacts/:contactId", { config: { permission: "companies:write" }, schema: { tags: ["companies"], params: z.object({ id: z.uuid(), contactId: z.uuid() }) } }, async (req) => {
    const organizationId = orgId(req);
    const contact = await prisma.contact.findFirst({ where: { id: req.params.contactId, companyId: req.params.id, organizationId } });
    if (!contact) throw notFound();
    await prisma.contact.delete({ where: { id: contact.id } });
    await writeAudit(req, { action: "contact.deleted", entityType: "contact", entityId: contact.id, metadata: { type: contact.type } });
    return { ok: true };
  });

  // ── etiquetas ──
  app.get("/tags", { schema: { tags: ["companies"] } }, async (req) => prisma.tag.findMany({ where: { organizationId: orgId(req) }, orderBy: { name: "asc" }, include: { _count: { select: { companies: true } } } }));

  app.post("/companies/:id/tags", { config: { permission: "companies:write" }, schema: { tags: ["companies"], params: idParams, body: z.object({ name: z.string().trim().min(1).max(40), color: z.string().max(20).optional() }) } }, async (req) => {
    const organizationId = orgId(req);
    const c = await prisma.company.findFirst({ where: { id: req.params.id, organizationId }, select: { id: true } });
    if (!c) throw notFound();
    const tag = await prisma.tag.upsert({ where: { organizationId_name: { organizationId, name: req.body.name } }, create: { organizationId, name: req.body.name, color: req.body.color ?? "emerald" }, update: {} });
    await prisma.companyTag.upsert({ where: { companyId_tagId: { companyId: c.id, tagId: tag.id } }, create: { companyId: c.id, tagId: tag.id }, update: {} });
    return tag;
  });

  app.delete("/companies/:id/tags/:tagId", { config: { permission: "companies:write" }, schema: { tags: ["companies"], params: z.object({ id: z.uuid(), tagId: z.uuid() }) } }, async (req) => {
    const organizationId = orgId(req);
    const c = await prisma.company.findFirst({ where: { id: req.params.id, organizationId }, select: { id: true } });
    if (!c) throw notFound();
    await prisma.companyTag.deleteMany({ where: { companyId: c.id, tagId: req.params.tagId } });
    return { ok: true };
  });

  // ── histórico (atividades + alterações) ──
  app.get("/companies/:id/timeline", { schema: { tags: ["companies"], params: idParams, querystring: z.object({ type: z.string().optional(), take: z.coerce.number().int().min(1).max(200).default(60) }) } }, async (req) => {
    const organizationId = orgId(req);
    const c = await prisma.company.findFirst({ where: { id: req.params.id, organizationId }, select: { id: true } });
    if (!c) throw notFound();
    return prisma.activity.findMany({
      where: { companyId: c.id, organizationId, ...(req.query.type ? { type: req.query.type as never } : {}) },
      orderBy: { occurredAt: "desc" },
      take: req.query.take,
      include: { user: { select: { id: true, name: true } }, deal: { select: { id: true, title: true } } },
    });
  });

  // ── busca global ──
  app.get("/search/global", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } }, schema: { tags: ["companies"], summary: "Busca rápida em empresas, negociações e tarefas", querystring: z.object({ q: z.string().trim().min(2).max(100) }) } }, async (req) => {
    const organizationId = orgId(req);
    const q = req.query.q;
    const [companies, deals, tasks] = await Promise.all([
      prisma.company.findMany({ where: companyWhere(organizationId, { q, status: "ACTIVE" }), take: 8, select: { id: true, name: true, city: true, category: true }, orderBy: { updatedAt: "desc" } }),
      prisma.deal.findMany({ where: { organizationId, OR: [{ title: { contains: q, mode: "insensitive" } }, { company: { name: { contains: q, mode: "insensitive" } } }] }, take: 5, select: { id: true, title: true, companyId: true, stage: { select: { name: true } } } }),
      prisma.task.findMany({ where: { organizationId, status: "OPEN", title: { contains: q, mode: "insensitive" } }, take: 5, select: { id: true, title: true, companyId: true } }),
    ]);
    return { companies, deals: deals.map((d) => ({ id: d.id, title: d.title, companyId: d.companyId, stage: d.stage.name })), tasks };
  });
};
