import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { notFound } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { orgId } from "../../plugins/auth.ts";
import { toAiError } from "../ai/errors.ts";
import { providerCatalog, getAdapter } from "../ai/registry.ts";
import { PRICING } from "../ai/pricing.ts";
import { AI_PROVIDERS } from "../ai/types.ts";
import { aiSettingsSchema, readOrgSettings } from "../orgs/settings.ts";
import { INTELLIGENCE_CRITERIA, INTELLIGENCE_METHODOLOGY } from "./scoring.ts";
import { SEGMENTS } from "./segments.ts";
import { computeIntelligence } from "./service.ts";
import { estimateAnalysis, generateAnalysis, toDto } from "./analysis/service.ts";

const idParams = z.object({ id: z.uuid() });
const choice = z.object({ provider: z.enum(AI_PROVIDERS).optional(), model: z.string().trim().min(1).max(80).optional() });

export const intelligenceRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/companies/:id/intelligence", { schema: { tags: ["intelligence"], summary: "Indicadores de aderência, oportunidade e confiabilidade, com evidências", params: idParams } }, async (req) => {
    const { facts, result } = await computeIntelligence(orgId(req), req.params.id);
    const segment = facts.segment?.segment ?? null;
    return {
      ...result,
      evidence: facts.evidence,
      phones: facts.phones.phones.map((p) => ({ e164: p.e164, national: p.national, countryCode: p.countryCode, areaCode: p.areaCode, kind: p.kind, whatsapp: p.whatsapp, sourceCount: p.sourceCount, origins: p.origins })),
      rejectedPhones: facts.phones.rejected,
      duplicatesMerged: facts.phones.duplicatesMerged,
      website: facts.website,
      issues: facts.issues,
      segment: segment ? { id: segment.id, label: segment.label, matchedTerm: facts.segment!.matchedTerm, painHypotheses: segment.painHypotheses, diagnosticQuestions: segment.diagnosticQuestions } : null,
    };
  });

  app.get("/companies/:id/ai-analyses", { schema: { tags: ["intelligence"], summary: "Histórico de análises com IA da empresa", params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    const company = await prisma.company.findFirst({ where: { id: req.params.id, organizationId }, select: { id: true } });
    if (!company) throw notFound("Empresa não encontrada.");
    const rows = await prisma.aiAnalysis.findMany({ where: { organizationId, companyId: company.id }, orderBy: { createdAt: "desc" }, take: 10 });
    return rows.map((r) => toDto(r));
  });

  app.post(
    "/companies/:id/ai-analyses/estimate",
    { config: { permission: "ai:run" }, schema: { tags: ["intelligence"], summary: "Estimativa de consumo e custo antes de gerar (não chama a IA)", params: idParams, body: choice } },
    async (req) => estimateAnalysis(orgId(req), req.params.id, req.body),
  );

  app.post(
    "/companies/:id/ai-analyses",
    {
      config: { permission: "ai:run", rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: { tags: ["intelligence"], summary: "Gera (ou reaproveita) a Análise Comercial com IA", params: idParams, body: choice.extend({ force: z.boolean().default(false) }) },
    },
    async (req, reply) => {
      const controller = new AbortController();
      // se o navegador cancelar ou cair, a chamada ao provedor também é cancelada
      reply.raw.on("close", () => {
        if (!reply.raw.writableFinished) controller.abort(new DOMException("cliente desconectou", "AbortError"));
      });
      const dto = await generateAnalysis({ organizationId: orgId(req), companyId: req.params.id, userId: req.auth!.userId, choice: { provider: req.body.provider, model: req.body.model }, force: req.body.force, signal: controller.signal });
      if (!dto.cached) await writeAudit(req, { action: dto.status === "SUCCEEDED" ? "ai.analysis.generated" : "ai.analysis.failed", entityType: "company", entityId: req.params.id, metadata: { provider: dto.provider, model: dto.model, costUsd: dto.estimatedCost.usd, errorCode: dto.errorCode } });
      return dto;
    },
  );

  app.patch(
    "/ai-analyses/:id",
    { config: { permission: "ai:run" }, schema: { tags: ["intelligence"], summary: "Salva a mensagem revisada por uma pessoa", params: idParams, body: z.object({ editedMessage: z.string().trim().min(1).max(2000).nullable() }) } },
    async (req) => {
      const organizationId = orgId(req);
      const row = await prisma.aiAnalysis.findFirst({ where: { id: req.params.id, organizationId, status: "SUCCEEDED" } });
      if (!row) throw notFound("Análise não encontrada.");
      const updated = await prisma.aiAnalysis.update({ where: { id: row.id }, data: { editedMessage: req.body.editedMessage, editedById: req.body.editedMessage ? req.auth!.userId : null, editedAt: req.body.editedMessage ? new Date() : null } });
      return toDto(updated);
    },
  );

  app.get("/ai/settings", { schema: { tags: ["intelligence"], summary: "Provedores de IA disponíveis e configuração da conta (sem chaves)" } }, async (req) => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: orgId(req) }, select: { settings: true } });
    const settings = readOrgSettings(org.settings);
    return {
      settings: settings.ai,
      intelligence: settings.intelligence,
      providers: providerCatalog(),
      pricing: PRICING,
      segments: SEGMENTS.map((s) => ({ id: s.id, label: s.label })),
      criteria: INTELLIGENCE_CRITERIA,
      methodology: INTELLIGENCE_METHODOLOGY,
    };
  });

  app.put("/ai/settings", { config: { permission: "settings:manage" }, schema: { tags: ["intelligence"], summary: "Atualiza a configuração de IA da conta", body: aiSettingsSchema } }, async (req) => {
    const organizationId = orgId(req);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    const current = readOrgSettings(org.settings);
    const next = { ...current, ai: req.body };
    await prisma.organization.update({ where: { id: organizationId }, data: { settings: next as unknown as Prisma.InputJsonValue } });
    await writeAudit(req, { action: "ai.settings.updated", entityType: "organization", entityId: organizationId, metadata: { enabled: req.body.enabled, mode: req.body.mode, primaryProvider: req.body.primaryProvider, fallbackProviders: req.body.fallbackProviders } });
    return { settings: req.body };
  });

  app.post(
    "/ai/providers/:provider/test",
    { config: { permission: "settings:manage", rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["intelligence"], summary: "Testa a conexão listando os modelos (não consome tokens)", params: z.object({ provider: z.enum(AI_PROVIDERS) }) } },
    async (req) => {
      const adapter = getAdapter(req.params.provider);
      if (!adapter.isConfigured()) return { ok: false, code: "NOT_CONFIGURED", message: "Sem chave configurada no servidor.", detail: null, models: [] };
      const signal = AbortSignal.timeout(15_000);
      try {
        const models = await adapter.listModels(signal);
        return { ok: true, code: null, message: `${models.length} modelo(s) disponível(is) para esta chave.`, detail: null, models };
      } catch (err) {
        const e = toAiError(err, req.params.provider, signal);
        // detail já passou por redactSecrets: é a explicação do provedor, sem a chave
        return { ok: false, code: e.code, message: e.message, detail: e.detail, models: [] };
      }
    },
  );
};
