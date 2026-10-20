import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { redis } from "../../lib/redis.ts";
import { badRequest, conflict, notFound, unprocessable } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { randomToken } from "../../lib/crypto.ts";
import { toCsv } from "../../lib/csv.ts";
import { pageQuery, pageResult, paginate } from "../../lib/pagination.ts";
import { enqueueSearch } from "../../queues/index.ts";
import { orgId } from "../../plugins/auth.ts";
import { geocode, tryGeocode } from "../geo/geocode.ts";
import { readOrgSettings } from "../orgs/settings.ts";
import { searchFiltersSchema, searchParamsSchema } from "../sources/types.ts";
import { detectMapping, mapCsvRow, mappingSchema, parseCsv } from "../imports/csv-import.ts";
import { ADAPTERS, DEFAULT_SOURCE } from "./registry.ts";
import { csvRowsKey } from "./processor.ts";

const ACTIVE = ["QUEUED", "SUBMITTED", "RUNNING", "DOWNLOADING", "IMPORTING"] as const;
const idParams = z.object({ id: z.uuid() });

async function loadJob(organizationId: string, id: string) {
  const job = await prisma.searchJob.findFirst({ where: { id, organizationId } });
  if (!job) throw notFound("Busca não encontrada.");
  return job;
}

/** Confere se a fonte está habilitada e, no Google Maps, os limites de uso da organização. */
async function assertCanRun(organizationId: string, provider: string) {
  if (!ADAPTERS[provider]) throw unprocessable("Esta fonte de busca está desativada. Use o Google Maps.");
  if (provider !== "GOOGLE_MAPS_SCRAPER") return;
  const settings = readOrgSettings((await prisma.organization.findUnique({ where: { id: organizationId } }))?.settings);
  if (!settings.discovery.googleMapsEnabled) throw unprocessable("O adaptador do Google Maps está desativado nas configurações.");
  const running = await prisma.searchJob.count({ where: { organizationId, provider: "GOOGLE_MAPS_SCRAPER", status: { in: [...ACTIVE] } } });
  if (running >= 2) throw conflict("Já existem buscas do Google Maps em andamento. Por segurança contra bloqueios, aguarde terminarem.");
}

export const searchRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/sources", { schema: { tags: ["search"], summary: "Fontes de descoberta disponíveis, licenças e avisos" } }, async (req) => {
    const settings = readOrgSettings((await prisma.organization.findUnique({ where: { id: orgId(req) } }))?.settings);
    const list = await Promise.all(
      Object.values(ADAPTERS).map(async (a) => {
        const avail = await a.available();
        const disabledByOrg = a.id === "GOOGLE_MAPS_SCRAPER" && !settings.discovery.googleMapsEnabled;
        return { id: a.id, label: a.label, license: a.license, warning: a.warning ?? null, available: avail.ok && !disabledByOrg, reason: disabledByOrg ? "Desativado nas configurações da organização." : (avail.reason ?? null) };
      }),
    );
    return [...list, { id: "CSV_IMPORT", label: "Importação de CSV", license: "Dados fornecidos por você; garanta que o uso e o armazenamento são permitidos.", warning: null, available: true, reason: null }];
  });

  app.post(
    "/geocode",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: { tags: ["search"], summary: "Pré-visualiza a localização (Nominatim/OSM)", body: z.object({ country: z.string().max(60).optional(), state: z.string().max(60).optional(), city: z.string().min(2).max(80), neighborhood: z.string().max(80).optional() }) },
    },
    async (req) => geocode(req.body),
  );

  app.post(
    "/searches",
    { config: { permission: "search:run", rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["search"], summary: "Cria e enfileira uma busca de empresas", body: searchParamsSchema } },
    async (req, reply) => {
      const organizationId = orgId(req);
      const params = req.body;
      await assertCanRun(organizationId, params.provider);
      const where = [params.neighborhood, params.city, params.state].filter(Boolean).join(", ");
      const job = await prisma.searchJob.create({
        data: {
          organizationId,
          createdById: req.auth!.userId,
          provider: params.provider,
          name: `${params.keyword}${params.nameContains ? ` "${params.nameContains}"` : ""} · ${where}`.slice(0, 200),
          params: params as unknown as Prisma.InputJsonValue,
          progress: { phase: "queued", message: "Na fila de processamento." },
        },
      });
      await enqueueSearch({ searchJobId: job.id });
      await writeAudit(req, { action: "search.created", entityType: "search_job", entityId: job.id, metadata: { provider: params.provider, keyword: params.keyword, city: params.city, limit: params.limit } });
      return reply.code(201).send({ id: job.id });
    },
  );

  app.get("/searches", { schema: { tags: ["search"], summary: "Lista buscas e importações", querystring: pageQuery.extend({ status: z.string().optional() }) } }, async (req) => {
    const { page, pageSize, status } = req.query;
    const where: Prisma.SearchJobWhereInput = { organizationId: orgId(req), ...(status === "active" ? { status: { in: [...ACTIVE] } } : status ? { status: status as never } : {}) };
    const [items, total] = await Promise.all([
      prisma.searchJob.findMany({ where, orderBy: { createdAt: "desc" }, ...paginate(page, pageSize), include: { createdBy: { select: { name: true } } } }),
      prisma.searchJob.count({ where }),
    ]);
    return pageResult(items.map(({ params: _p, ...j }) => ({ ...j, createdBy: j.createdBy?.name ?? null })), total, page, pageSize);
  });

  app.get("/searches/:id", { schema: { tags: ["search"], summary: "Detalhes e andamento de uma busca", params: idParams } }, async (req) => {
    const job = await loadJob(orgId(req), req.params.id);
    return job;
  });

  app.post("/searches/:id/cancel", { config: { permission: "search:run" }, schema: { tags: ["search"], summary: "Cancela uma busca em andamento", params: idParams } }, async (req) => {
    const job = await loadJob(orgId(req), req.params.id);
    if (!ACTIVE.includes(job.status as (typeof ACTIVE)[number])) throw badRequest("Esta busca não está em andamento.");
    await prisma.searchJob.update({
      where: { id: job.id },
      data: job.status === "QUEUED" ? { cancelRequested: true, status: "CANCELLED", finishedAt: new Date(), progress: { phase: "cancelled", message: "Cancelada antes de iniciar." } } : { cancelRequested: true },
    });
    await writeAudit(req, { action: "search.cancelled", entityType: "search_job", entityId: job.id });
    return { ok: true };
  });

  app.post("/searches/:id/retry", { config: { permission: "search:run" }, schema: { tags: ["search"], summary: "Reexecuta uma busca que falhou ou foi cancelada", params: idParams } }, async (req, reply) => {
    const job = await loadJob(orgId(req), req.params.id);
    if (job.provider === "CSV_IMPORT") throw badRequest("Para importar novamente, envie o arquivo outra vez.");
    if (!["FAILED", "CANCELLED"].includes(job.status)) throw badRequest("Só é possível repetir buscas que falharam ou foram canceladas.");
    // buscas de uma fonte desativada (ex.: OpenStreetMap) são repetidas pela fonte habilitada
    const provider = ADAPTERS[job.provider] ? job.provider : DEFAULT_SOURCE;
    await assertCanRun(job.organizationId, provider);
    const params = { ...(job.params as Record<string, unknown>), provider };
    const copy = await prisma.searchJob.create({
      data: { organizationId: job.organizationId, createdById: req.auth!.userId, provider: provider as typeof job.provider, name: job.name, params: params as Prisma.InputJsonValue, progress: { phase: "queued", message: "Na fila de processamento." } },
    });
    await enqueueSearch({ searchJobId: copy.id });
    return reply.code(201).send({ id: copy.id });
  });

  const resultsQuery = pageQuery.extend({
    onlyMatching: z.coerce.boolean().optional(),
    website: z.enum(["any", "with", "without"]).optional(),
    phone: z.enum(["any", "with", "without"]).optional(),
    email: z.enum(["any", "with", "without"]).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    maxRating: z.coerce.number().min(0).max(5).optional(),
    minReviews: z.coerce.number().int().min(0).optional(),
    maxReviews: z.coerce.number().int().min(0).optional(),
    q: z.string().max(100).optional(),
  });

  function companyFilter(q: z.infer<typeof resultsQuery>): Prisma.CompanyWhereInput {
    const and: Prisma.CompanyWhereInput[] = [];
    if (q.website === "with") and.push({ website: { not: null } });
    if (q.website === "without") and.push({ website: null });
    if (q.phone === "with") and.push({ primaryPhone: { not: null } });
    if (q.phone === "without") and.push({ primaryPhone: null });
    if (q.email === "with") and.push({ contacts: { some: { type: "EMAIL" } } });
    if (q.email === "without") and.push({ contacts: { none: { type: "EMAIL" } } });
    if (q.minRating !== undefined) and.push({ rating: { gte: q.minRating } });
    if (q.maxRating !== undefined) and.push({ rating: { lte: q.maxRating } });
    if (q.minReviews !== undefined) and.push({ reviewCount: { gte: q.minReviews } });
    if (q.maxReviews !== undefined) and.push({ reviewCount: { lte: q.maxReviews } });
    if (q.q) and.push({ name: { contains: q.q, mode: "insensitive" } });
    return and.length ? { AND: and } : {};
  }

  app.get("/searches/:id/results", { schema: { tags: ["search"], summary: "Resultados de uma busca com filtros combináveis", params: idParams, querystring: resultsQuery } }, async (req) => {
    const job = await loadJob(orgId(req), req.params.id);
    const q = req.query;
    const cf = companyFilter(q);
    const hasCompanyFilter = Object.keys(cf).length > 0;
    const where: Prisma.SearchResultWhereInput = {
      searchJobId: job.id,
      ...(q.onlyMatching || hasCompanyFilter ? { companyId: { not: null } } : {}),
      ...(hasCompanyFilter ? { company: cf } : {}),
    };
    const [rows, total, filteredOut] = await Promise.all([
      prisma.searchResult.findMany({
        where,
        orderBy: { position: "asc" },
        ...paginate(q.page, q.pageSize),
        include: {
          company: {
            select: {
              id: true, name: true, category: true, website: true, primaryPhone: true, primaryEmail: true, address: true, city: true, state: true, neighborhood: true,
              rating: true, reviewCount: true, sourceUrl: true, enrichmentStatus: true, status: true,
              _count: { select: { contacts: { where: { type: "EMAIL" } }, socialProfiles: true, deals: true } },
            },
          },
        },
      }),
      prisma.searchResult.count({ where }),
      prisma.searchResult.count({ where: { searchJobId: job.id, matchedBy: "filtered_out" } }),
    ]);
    return { ...pageResult(rows.map(({ rawData: _r, ...r }) => r), total, q.page, q.pageSize), filteredOut };
  });

  app.get("/searches/:id/map", { schema: { tags: ["search"], summary: "Centro, raio e empresas com coordenadas para o mapa da busca", params: idParams } }, async (req) => {
    const job = await loadJob(orgId(req), req.params.id);
    // importações CSV têm outros parâmetros: sem cidade, o mapa mostra só os pontos
    const parsed = searchParamsSchema.partial().safeParse(job.params);
    const params = parsed.success ? parsed.data : {};
    const progress = (job.progress ?? {}) as { area?: { lat: number; lon: number; label: string; radiusKm: number } };
    // buscas antigas não guardavam a área: localiza de novo (normalmente vem do cache)
    let area = progress.area ?? null;
    if (!area && params.city) {
      const geo = await tryGeocode({ country: params.country, state: params.state, city: params.city, neighborhood: params.neighborhood });
      if (geo.place) area = { lat: geo.place.latitude, lon: geo.place.longitude, label: geo.place.label, radiusKm: params.radiusKm ?? 5 };
    }
    const rows = await prisma.searchResult.findMany({
      where: { searchJobId: job.id, companyId: { not: null } },
      orderBy: { position: "asc" },
      take: 2000,
      select: {
        company: {
          select: { id: true, name: true, category: true, rating: true, reviewCount: true, primaryPhone: true, latitude: true, longitude: true, _count: { select: { deals: true } } },
        },
      },
    });
    const seen = new Set<string>();
    const points: { id: string; name: string; category: string | null; rating: number | null; reviewCount: number | null; phone: string | null; lat: number; lon: number; inCrm: boolean }[] = [];
    let withoutLocation = 0;
    for (const { company: c } of rows) {
      if (!c || seen.has(c.id)) continue;
      seen.add(c.id);
      if (c.latitude == null || c.longitude == null) {
        withoutLocation++;
        continue;
      }
      points.push({ id: c.id, name: c.name, category: c.category, rating: c.rating, reviewCount: c.reviewCount, phone: c.primaryPhone, lat: c.latitude, lon: c.longitude, inCrm: c._count.deals > 0 });
    }
    return { area, points, withoutLocation };
  });

  app.get("/searches/:id/export.csv", { config: { permission: "export:run" }, schema: { tags: ["search"], summary: "Exporta os resultados salvos da busca em CSV", params: idParams } }, async (req, reply) => {
    const job = await loadJob(orgId(req), req.params.id);
    const rows = await prisma.searchResult.findMany({
      where: { searchJobId: job.id, companyId: { not: null } },
      orderBy: { position: "asc" },
      include: { company: { include: { contacts: true, socialProfiles: true } } },
    });
    const data = rows.map((r) => {
      const c = r.company!;
      return {
        name: c.name, category: c.category, phone: c.contacts.filter((x) => x.type === "PHONE").map((x) => x.normalizedValue), email: c.contacts.filter((x) => x.type === "EMAIL").map((x) => x.normalizedValue),
        website: c.website, address: c.address, neighborhood: c.neighborhood, city: c.city, state: c.state, postalCode: c.postalCode, rating: c.rating, reviewCount: c.reviewCount,
        socials: c.socialProfiles.map((s) => s.url), sourceUrl: c.sourceUrl, isNew: r.isNew ? "nova" : `já existia (${r.matchedBy})`, collectedAt: c.collectedAt.toISOString(),
      };
    });
    const csv = toCsv(
      [
        { key: "name", label: "Nome" }, { key: "category", label: "Categoria" }, { key: "phone", label: "Telefones" }, { key: "email", label: "E-mails" }, { key: "website", label: "Site" },
        { key: "address", label: "Endereço" }, { key: "neighborhood", label: "Bairro" }, { key: "city", label: "Cidade" }, { key: "state", label: "UF" }, { key: "postalCode", label: "CEP" },
        { key: "rating", label: "Nota pública" }, { key: "reviewCount", label: "Avaliações" }, { key: "socials", label: "Redes sociais" }, { key: "sourceUrl", label: "Ficha pública" },
        { key: "isNew", label: "Situação" }, { key: "collectedAt", label: "Coletado em" },
      ],
      data,
    );
    await writeAudit(req, { action: "search.exported", entityType: "search_job", entityId: job.id, metadata: { rows: data.length } });
    return reply
      .header("Content-Type", "text/csv; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="busca-${job.id.slice(0, 8)}.csv"`)
      .send(csv);
  });

  // ── importação de CSV (prévia → confirmação → fila) ──
  app.post("/imports/csv/preview", { config: { permission: "import:run", rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["import"], summary: "Envia um CSV e devolve colunas, mapeamento sugerido e amostra" } }, async (req) => {
    const file = await req.file();
    if (!file) throw badRequest("Envie um arquivo CSV no campo 'file'.");
    if (!/\.(csv|txt)$/i.test(file.filename)) throw badRequest("Formato não suportado. Use .csv.");
    const buf = await file.toBuffer();
    if (file.file.truncated) throw badRequest("Arquivo maior que o limite de 15 MB.");
    const content = buf.toString("utf8");
    const { rows, headers } = parseCsv(content, 5000);
    if (!rows.length) throw unprocessable("Nenhuma linha encontrada no arquivo.");
    const { format, mapping } = detectMapping(headers);
    const token = randomToken(18);
    await redis.set(`pp:csv:${token}`, JSON.stringify({ organizationId: orgId(req), fileName: file.filename.slice(0, 120), rows, format }), "EX", 3600);
    const sample = rows.slice(0, 8).map((r) => mapCsvRow(r, mapping, format)).map((r) => (r ? { name: r.name, category: r.category, phones: r.phones, emails: r.emails, website: r.website, city: r.city, state: r.state } : null));
    return { token, fileName: file.filename, headers, format, mapping, totalRows: rows.length, truncated: rows.length >= 5000, sample };
  });

  app.post(
    "/imports/csv/commit",
    {
      config: { permission: "import:run" },
      schema: {
        tags: ["import"],
        summary: "Confirma a importação de um CSV pré-visualizado",
        body: z.object({ token: z.string().min(10).max(64), mapping: mappingSchema, filters: searchFiltersSchema.optional(), saveOnlyMatching: z.boolean().default(false), legalBasisNote: z.string().max(500).optional() }),
      },
    },
    async (req, reply) => {
      const organizationId = orgId(req);
      const raw = await redis.get(`pp:csv:${req.body.token}`);
      if (!raw) throw badRequest("A prévia expirou. Envie o arquivo novamente.");
      const stash = JSON.parse(raw) as { organizationId: string; fileName: string; rows: Record<string, string>[]; format: "gosom" | "generic" };
      if (stash.organizationId !== organizationId) throw notFound();
      if (stash.format === "generic" && !req.body.mapping.name && !req.body.mapping.legalName) throw unprocessable("Indique qual coluna contém o nome da empresa.");
      const job = await prisma.searchJob.create({
        data: {
          organizationId,
          createdById: req.auth!.userId,
          provider: "CSV_IMPORT",
          name: `Importação: ${stash.fileName}`,
          params: { fileName: stash.fileName, format: stash.format, mapping: req.body.mapping, totalRows: stash.rows.length, filters: req.body.filters ?? {}, saveOnlyMatching: req.body.saveOnlyMatching, legalBasisNote: req.body.legalBasisNote ?? null } as Prisma.InputJsonValue,
          progress: { phase: "queued", message: "Na fila de importação." },
        },
      });
      await redis.set(csvRowsKey(job.id), JSON.stringify(stash.rows), "EX", 24 * 3600);
      await redis.del(`pp:csv:${req.body.token}`);
      await enqueueSearch({ searchJobId: job.id });
      await writeAudit(req, { action: "import.csv", entityType: "search_job", entityId: job.id, metadata: { fileName: stash.fileName, rows: stash.rows.length } });
      return reply.code(201).send({ id: job.id });
    },
  );
};
