import { existsSync } from "node:fs";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { writeAudit } from "../../lib/audit-log.ts";
import { AppError } from "../../lib/errors.ts";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { orgId } from "../../plugins/auth.ts";
import { chromePath } from "../audit/lighthouse.ts";
import { runPageSpeed } from "../audit/pagespeed.ts";
import { cnpjDigits, isValidCnpj } from "../company-data/cnpj.ts";
import type { BusinessProfile } from "../company-data/types.ts";
import { lookupCnpj } from "../enrichment/verify.ts";
import { computeOffers } from "../intelligence/service.ts";
import { integrationConfigSchema, radarSettingsSchema, readOrgSettings } from "../orgs/settings.ts";
import { comexPanel } from "./comex.ts";
import { deleteSourceKey, KEYED_SOURCES, saveSourceKey, sourceKey, sourceKeyStatus, type KeyedSource } from "./credentials.ts";
import { cvmPanel } from "./cvm.ts";
import { integrationConfig, publicMockActive, requestJson, SourceError, sourceHttpError, tracked, usageToday } from "./http.ts";
import { ibgePanel, resolveCity, sectionOfCnae } from "./ibge.ts";
import { enqueueRadarSync } from "./jobs.ts";
import { laborPanel } from "./labor.ts";
import { listRadar, PNCP_MODALITIES } from "./pncp.ts";
import { currentReceita, receitaForCompany } from "./receita.ts";
import { PUBLIC_SOURCE_IDS, PUBLIC_SOURCES, sourceDef, type PublicSourceId } from "./sources.ts";
import { checkCompanyRecords, publicRecords } from "./transparencia.ts";

const idParams = z.object({ id: z.uuid() });
const sourceParams = z.object({ id: z.enum(PUBLIC_SOURCE_IDS) });
const DAY = 86_400_000;

const settingsOf = async (organizationId: string) => (await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } })).settings;
const isKeyed = (id: PublicSourceId): id is KeyedSource => (KEYED_SOURCES as readonly string[]).includes(id);
const message = (err: unknown) => (err instanceof SourceError ? (err.code === "INVALID_REQUEST" && err.detail ? err.detail : err.message) : "Falha inesperada ao consultar a fonte.");

async function companyOf(organizationId: string, id: string) {
  const c = await prisma.company.findFirst({ where: { id, organizationId }, select: { id: true, cnpj: true, city: true, state: true } });
  if (!c) throw new AppError(404, "NOT_FOUND", "Empresa não encontrada.");
  return c;
}

/** Base local importada (Receita, CAGED, CVM): quantos registros e a última importação. */
async function localBase(id: PublicSourceId) {
  const kinds: Partial<Record<PublicSourceId, () => Promise<number>>> = {
    receita_aberta: () => prisma.rfEstabelecimento.count(),
    caged: () => prisma.laborStat.count(),
    cvm: () => prisma.cvmCompany.count(),
  };
  if (!kinds[id]) return null;
  const [records, last] = await Promise.all([kinds[id]!(), prisma.publicImportRun.findFirst({ where: { source: id }, orderBy: { startedAt: "desc" }, select: { kind: true, file: true, status: true, linesImported: true, finishedAt: true, startedAt: true } })]);
  return { records, lastImport: last };
}

export const publicDataRoutes: FastifyPluginAsyncZod = async (app) => {
  // ── Central de integrações ──
  app.get("/integrations", { schema: { tags: ["public-data"], summary: "Fontes de dados: estado, limites, uso e execuções recentes (sem chaves)" } }, async (req) => {
    const organizationId = orgId(req);
    const raw = await settingsOf(organizationId);
    const since = new Date(Date.now() - 30 * DAY);
    const scope = { OR: [{ organizationId }, { organizationId: null }] };
    const sources = await Promise.all(
      PUBLIC_SOURCES.map(async (s) => {
        const where = { source: s.id, ...scope };
        const [lastRun, lastOk, runs, failures, recentErrors, credential, usage, base] = await Promise.all([
          prisma.integrationRun.findFirst({ where, orderBy: { createdAt: "desc" }, select: { createdAt: true, ok: true, operation: true, errorCode: true, mock: true } }),
          prisma.integrationRun.findFirst({ where: { ...where, ok: true }, orderBy: { createdAt: "desc" }, select: { createdAt: true, mock: true } }),
          prisma.integrationRun.count({ where: { ...where, createdAt: { gte: since } } }),
          prisma.integrationRun.count({ where: { ...where, ok: false, createdAt: { gte: since } } }),
          prisma.integrationRun.findMany({ where: { ...where, ok: false }, orderBy: { createdAt: "desc" }, take: 5, select: { createdAt: true, errorCode: true, error: true, operation: true, mock: true } }),
          isKeyed(s.id) ? sourceKeyStatus(organizationId, s.id) : Promise.resolve(null),
          usageToday(s.id, organizationId),
          localBase(s.id),
        ]);
        return { ...s, config: integrationConfig(raw, s.id), credential, usageToday: usage, lastRun, lastOk, runs30d: runs, failures30d: failures, recentErrors, localBase: base };
      }),
    );
    return { simulated: publicMockActive(), econodata: { enabled: readOrgSettings(raw).dataEnrichment.enabled }, sources };
  });

  app.put(
    "/integrations/:id",
    { config: { permission: "settings:manage" }, schema: { tags: ["public-data"], summary: "Liga/desliga e ajusta limites de uma fonte", params: sourceParams, body: integrationConfigSchema.partial() } },
    async (req) => {
      const organizationId = orgId(req);
      const current = readOrgSettings(await settingsOf(organizationId));
      const next = { ...current, integrations: { ...current.integrations, [req.params.id]: { ...(current.integrations[req.params.id] ?? {}), ...req.body } } };
      await prisma.organization.update({ where: { id: organizationId }, data: { settings: next as unknown as Prisma.InputJsonValue } });
      await writeAudit(req, { action: "integrations.updated", entityType: "organization", entityId: organizationId, metadata: { source: req.params.id, ...req.body } });
      return { config: integrationConfig(next, req.params.id) };
    },
  );

  app.put(
    "/integrations/:id/credential",
    {
      config: { permission: "settings:manage", rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { tags: ["public-data"], summary: "Cadastra a chave gratuita da fonte (cifrada; nunca volta ao navegador)", params: sourceParams, body: z.object({ apiKey: z.string().trim().min(8).max(300) }) },
    },
    async (req) => {
      if (!isKeyed(req.params.id)) throw new AppError(400, "BAD_REQUEST", "Esta fonte não usa chave.");
      const organizationId = orgId(req);
      const r = await saveSourceKey(organizationId, req.params.id, req.body.apiKey, req.auth!.userId);
      await writeAudit(req, { action: "integrations.credential_saved", entityType: "organization", entityId: organizationId, metadata: { source: req.params.id, keyHint: r.keyHint } });
      return sourceKeyStatus(organizationId, req.params.id);
    },
  );

  app.delete("/integrations/:id/credential", { config: { permission: "settings:manage" }, schema: { tags: ["public-data"], summary: "Remove a chave da fonte", params: sourceParams } }, async (req) => {
    if (!isKeyed(req.params.id)) throw new AppError(400, "BAD_REQUEST", "Esta fonte não usa chave.");
    const organizationId = orgId(req);
    const r = await deleteSourceKey(organizationId, req.params.id);
    if (r.count) await writeAudit(req, { action: "integrations.credential_removed", entityType: "organization", entityId: organizationId, metadata: { source: req.params.id } });
    return sourceKeyStatus(organizationId, req.params.id);
  });

  app.post(
    "/integrations/:id/test",
    { config: { permission: "settings:manage", rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["public-data"], summary: "Teste rápido da fonte (consulta pública barata, ou simulada no modo de teste)", params: sourceParams } },
    async (req) => {
      const organizationId = orgId(req);
      const id = req.params.id;
      const cfg = integrationConfig(await settingsOf(organizationId), id);
      const started = Date.now();
      const done = (ok: boolean, msg: string) => ({ ok, message: msg, simulated: publicMockActive(), durationMs: Date.now() - started });
      const ctx = { organizationId, maxDaily: cfg.maxDailyRequests };
      try {
        switch (id) {
          case "lighthouse": {
            const path = await chromePath();
            return done(!!path && existsSync(path), path && existsSync(path) ? "Chromium disponível: o Lighthouse roda neste servidor." : "Chromium não encontrado: as auditorias seguem sem Lighthouse local (use o PageSpeed ou a versão em Docker).");
          }
          case "brasilapi": {
            if (publicMockActive()) return done(true, "Modo simulado: a BrasilAPI não é consultada nos testes.");
            // CNPJ público do Banco do Brasil, só para conferir que a API responde
            const r = await lookupCnpj("00000000000191");
            return done(!!r, r ? "BrasilAPI respondeu." : "BrasilAPI não respondeu agora.");
          }
          case "receita_aberta":
          case "caged":
          case "cvm": {
            const base = await localBase(id);
            return done(!!base?.records, base?.records ? `Base local com ${base.records.toLocaleString("pt-BR")} registro(s).` : "Base local vazia: importe os arquivos oficiais (platform/docs/FONTES-PUBLICAS.md).");
          }
          case "ibge":
            return await tracked({ source: id, operation: "health", organizationId }, async () => {
              const r = await requestJson<unknown[]>("ibge", "https://servicodados.ibge.gov.br/api/v1/localidades/estados/PR/municipios", ctx);
              return { value: done(!!r?.length, `IBGE respondeu (${r?.length ?? 0} municípios no PR).`), records: r?.length ?? 0 };
            });
          case "comexstat":
            return await tracked({ source: id, operation: "health", organizationId }, async () => {
              const r = await requestJson<{ data?: { updated?: string } }>("comexstat", "https://api-comexstat.mdic.gov.br/general/dates/updated", ctx);
              return { value: done(!!r?.data?.updated, `Comex Stat respondeu (dados até ${r?.data?.updated ?? "?"}).`), records: 1 };
            });
          case "pncp":
            return await tracked({ source: id, operation: "health", organizationId }, async () => {
              const end = new Date(Date.now() + 30 * DAY).toISOString().slice(0, 10).replace(/-/g, "");
              const r = await requestJson<{ totalRegistros?: number }>("pncp", `https://pncp.gov.br/api/consulta/v1/contratacoes/proposta?dataFinal=${end}&uf=DF&pagina=1&tamanhoPagina=10`, { ...ctx, timeoutMs: 60_000 });
              return { value: done(true, `PNCP respondeu (${r?.totalRegistros ?? 0} contratações com proposta aberta no DF).`), records: r?.totalRegistros ?? 0 };
            });
          case "transparencia":
          case "pagespeed": {
            const key = await sourceKey(organizationId, id);
            if (!key && !publicMockActive()) return done(false, "Cadastre a chave gratuita antes de testar.");
            if (id === "transparencia")
              return await tracked({ source: id, operation: "health", organizationId }, async () => {
                await requestJson<unknown[]>("transparencia", "https://api.portaldatransparencia.gov.br/api-de-dados/ceis?codigoSancionado=00000000000191&pagina=1", { ...ctx, headers: { "chave-api-dados": key || "chave-simulada" } });
                return { value: done(true, "Portal da Transparência aceitou a chave."), records: 0 };
              });
            const r = await runPageSpeed(organizationId, null, "https://developers.google.com/", "mobile", cfg.maxDailyRequests);
            return done(true, `PageSpeed respondeu (desempenho ${Math.round((r.performance ?? 0) * 100)}/100 numa página de exemplo).`);
          }
        }
      } catch (err) {
        return done(false, message(err));
      }
    },
  );

  // ── Empresa ──
  app.get(
    "/companies/:id/regional",
    { schema: { tags: ["public-data"], summary: "Indicadores do MUNICÍPIO da empresa (IBGE, Comex Stat, CAGED); nunca atribuídos à empresa", params: idParams, querystring: z.object({ force: z.coerce.boolean().default(false) }) } },
    async (req) => {
      const organizationId = orgId(req);
      const c = await companyOf(organizationId, req.params.id);
      const raw = await settingsOf(organizationId);
      const cfg = { ibge: integrationConfig(raw, "ibge"), comex: integrationConfig(raw, "comexstat"), caged: integrationConfig(raw, "caged") };
      const out = {
        simulated: publicMockActive(),
        city: null as { ibge: string; name: string; uf: string } | null,
        reason: null as string | null,
        highlightSection: null as string | null,
        ibge: { enabled: cfg.ibge.enabled, data: null as unknown, error: null as string | null, fetchedAt: null as Date | null, cached: false },
        comex: { enabled: cfg.comex.enabled, data: null as unknown, error: null as string | null, fetchedAt: null as Date | null, cached: false },
        caged: { enabled: cfg.caged.enabled, data: null as unknown, error: null as string | null },
      };
      if (!cfg.ibge.enabled && !cfg.comex.enabled && !cfg.caged.enabled) return out;
      if (!c.city || !c.state) return { ...out, reason: "A empresa não tem cidade e UF cadastradas." };
      try {
        const city = await resolveCity(c.state, c.city, { organizationId, maxDaily: cfg.ibge.maxDailyRequests });
        if (!city) return { ...out, reason: `Município "${c.city}/${c.state}" não encontrado no IBGE.` };
        out.city = { ...city, uf: c.state };
      } catch (err) {
        return { ...out, reason: `Não foi possível identificar o município: ${message(err)}` };
      }
      const profile = await prisma.companyDataProfile.findFirst({ where: { organizationId, companyId: c.id, status: "MATCHED" }, orderBy: { updatedAt: "desc" }, select: { profile: true } });
      out.highlightSection = sectionOfCnae((profile?.profile as unknown as BusinessProfile | null)?.primaryCnae?.value.code);
      // uma fonte fora do ar não impede as outras
      if (cfg.ibge.enabled)
        try {
          const r = await ibgePanel({ ibge: out.city.ibge, name: out.city.name, uf: out.city.uf }, { organizationId, maxDaily: cfg.ibge.maxDailyRequests, cacheDays: cfg.ibge.cacheDays, force: req.query.force });
          out.ibge = { ...out.ibge, data: r.payload, fetchedAt: r.fetchedAt, cached: r.cached };
        } catch (err) {
          out.ibge.error = message(err);
        }
      if (cfg.comex.enabled)
        try {
          const r = await comexPanel(out.city.ibge, { organizationId, maxDaily: cfg.comex.maxDailyRequests, cacheDays: cfg.comex.cacheDays, force: req.query.force });
          out.comex = { ...out.comex, data: r.payload, fetchedAt: r.fetchedAt, cached: r.cached };
        } catch (err) {
          out.comex.error = message(err);
        }
      if (cfg.caged.enabled) out.caged.data = await laborPanel(out.city.ibge, out.highlightSection);
      return out;
    },
  );

  app.get("/companies/:id/public-records", { schema: { tags: ["public-data"], summary: "Registros públicos ligados ao CNPJ (Portal da Transparência)", params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    const c = await companyOf(organizationId, req.params.id);
    const cfg = integrationConfig(await settingsOf(organizationId), "transparencia");
    const key = await sourceKeyStatus(organizationId, "transparencia");
    return { enabled: cfg.enabled, configured: key.hasKey || publicMockActive(), simulated: publicMockActive(), credentialUrl: sourceDef("transparencia").credentialUrl, companyCnpj: isValidCnpj(c.cnpj) ? cnpjDigits(c.cnpj) : null, ...(await publicRecords(organizationId, c.id)) };
  });

  app.post(
    "/companies/:id/public-records",
    { config: { permission: "enrich:run", rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["public-data"], summary: "Consulta CEIS, CNEP e contratos federais pelo CNPJ validado", params: idParams, body: z.object({ force: z.boolean().default(false) }) } },
    async (req) => {
      try {
        return await checkCompanyRecords(orgId(req), req.params.id, { force: req.body.force });
      } catch (err) {
        throw sourceHttpError(err);
      }
    },
  );

  app.get("/companies/:id/receita", { schema: { tags: ["public-data"], summary: "Cadastro oficial da base local da Receita (dados abertos)", params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    const c = await companyOf(organizationId, req.params.id);
    const cfg = integrationConfig(await settingsOf(organizationId), "receita_aberta");
    return { enabled: cfg.enabled, base: await localBase("receita_aberta"), companyCnpj: isValidCnpj(c.cnpj) ? cnpjDigits(c.cnpj) : null, data: await currentReceita(organizationId, c.id) };
  });

  app.post("/companies/:id/receita", { config: { permission: "enrich:run", rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["public-data"], summary: "Identifica a empresa na base local da Receita", params: idParams } }, async (req) => {
    try {
      return await receitaForCompany({ organizationId: orgId(req), companyId: req.params.id, userId: req.auth!.userId });
    } catch (err) {
      throw sourceHttpError(err);
    }
  });

  app.post(
    "/companies/:id/receita/confirm",
    { config: { permission: "enrich:run", rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["public-data"], summary: "Confirma qual candidato da Receita é a empresa", params: idParams, body: z.object({ cnpj: z.string().trim().min(14).max(20) }) } },
    async (req) => {
      try {
        const dto = await receitaForCompany({ organizationId: orgId(req), companyId: req.params.id, userId: req.auth!.userId, chosenCnpj: req.body.cnpj });
        await writeAudit(req, { action: "company.receita_match_confirmed", entityType: "company", entityId: req.params.id, metadata: { cnpj: cnpjDigits(req.body.cnpj) } });
        return dto;
      } catch (err) {
        throw sourceHttpError(err);
      }
    },
  );

  app.get("/companies/:id/cvm", { schema: { tags: ["public-data"], summary: "Demonstrações financeiras (CVM) quando o CNPJ é de companhia aberta", params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    const c = await companyOf(organizationId, req.params.id);
    const cfg = integrationConfig(await settingsOf(organizationId), "cvm");
    return { enabled: cfg.enabled, hasCnpj: isValidCnpj(c.cnpj), data: cfg.enabled ? await cvmPanel(c.cnpj) : null };
  });

  app.get("/companies/:id/offers", { schema: { tags: ["public-data"], summary: "Aderência da empresa a cada oferta configurada (score por produto ou serviço)", params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    const c = await companyOf(organizationId, req.params.id);
    return { offers: await computeOffers(organizationId, c.id) };
  });

  // ── Radar de oportunidades públicas (PNCP) ──
  const radarQuery = z.object({
    segment: z.string().max(40).optional(),
    uf: z.string().regex(/^[A-Z]{2}$/).optional(),
    city: z.string().regex(/^\d{7}$/).optional(),
    open: z.coerce.boolean().optional(),
    days: z.coerce.number().int().min(1).max(365).optional(),
    q: z.string().trim().max(80).optional(),
    all: z.coerce.boolean().optional(),
  });
  app.get("/radar", { schema: { tags: ["public-data"], summary: "Contratações públicas classificadas pelos segmentos da conta", querystring: radarQuery } }, async (req) => {
    const organizationId = orgId(req);
    const raw = await settingsOf(organizationId);
    const cfg = integrationConfig(raw, "pncp");
    const radar = readOrgSettings(raw).radar;
    if (!cfg.enabled) return { enabled: false, simulated: publicMockActive(), items: [], total: 0, bySegment: {}, lastSync: null, settings: radar };
    const q = req.query;
    return { enabled: true, simulated: publicMockActive(), settings: radar, ...(await listRadar(radar, { segment: q.segment, uf: q.uf, cityIbge: q.city, open: q.open, days: q.days, q: q.q, all: q.all })) };
  });

  app.post("/radar/sync", { config: { permission: "search:run", rateLimit: { max: 5, timeWindow: "1 minute" } }, schema: { tags: ["public-data"], summary: "Busca no PNCP as contratações das UFs/municípios do radar (em segundo plano)" } }, async (req) => {
    const organizationId = orgId(req);
    const raw = await settingsOf(organizationId);
    if (!integrationConfig(raw, "pncp").enabled) throw sourceHttpError(new SourceError("DISABLED"));
    const radar = readOrgSettings(raw).radar;
    if (!radar.ufs.length && !radar.cityIbgeCodes.length) throw new AppError(422, "UNPROCESSABLE", "Escolha ao menos uma UF ou município no radar.");
    await enqueueRadarSync(organizationId);
    return { queued: true };
  });

  app.get("/radar/settings", { schema: { tags: ["public-data"], summary: "Segmentos, UFs e modalidades do radar" } }, async (req) => ({
    settings: readOrgSettings(await settingsOf(orgId(req))).radar,
    modalities: Object.entries(PNCP_MODALITIES).map(([id, name]) => ({ id: Number(id), name })),
  }));

  app.put("/radar/settings", { config: { permission: "settings:manage" }, schema: { tags: ["public-data"], summary: "Atualiza o radar de oportunidades públicas", body: radarSettingsSchema } }, async (req) => {
    const organizationId = orgId(req);
    const current = readOrgSettings(await settingsOf(organizationId));
    const next = { ...current, radar: req.body };
    await prisma.organization.update({ where: { id: organizationId }, data: { settings: next as unknown as Prisma.InputJsonValue } });
    await writeAudit(req, { action: "radar.settings_updated", entityType: "organization", entityId: organizationId, metadata: { ufs: req.body.ufs, segments: req.body.segments.length } });
    return { settings: req.body };
  });
};
