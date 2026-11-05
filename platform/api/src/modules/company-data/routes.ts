import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { encryptSecret } from "../../lib/crypto.ts";
import { AppError } from "../../lib/errors.ts";
import { writeAudit } from "../../lib/audit-log.ts";
import { orgId } from "../../plugins/auth.ts";
import { keyHint } from "../ai/credentials.ts";
import { dataEnrichmentSettingsSchema, readOrgSettings } from "../orgs/settings.ts";
import { cnpjDigits, isValidCnpj } from "./cnpj.ts";
import { CREDENTIAL_PROVIDER, currentProfile, dataSettingsView, enqueueBatch, enrichCompany, estimateEnrichment, profileDto, providerBalance, simulationActive } from "./service.ts";
import { ProviderError } from "./types.ts";

const idParams = z.object({ id: z.uuid() });

export const companyDataRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/companies/:id/business-data", { schema: { tags: ["company-data"], summary: "Dados empresariais da empresa (perfil normalizado, candidatos e estado da consulta)", params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    const company = await prisma.company.findFirst({ where: { id: req.params.id, organizationId }, select: { id: true, cnpj: true } });
    if (!company) throw new AppError(404, "NOT_FOUND", "Empresa não encontrada.");
    const view = await dataSettingsView(organizationId);
    return {
      enabled: view.settings.enabled,
      configured: view.configured,
      simulated: view.simulated,
      companyCnpj: isValidCnpj(company.cnpj) ? cnpjDigits(company.cnpj) : null,
      data: profileDto(await currentProfile(organizationId, company.id)),
    };
  });

  app.post(
    "/companies/:id/business-data/estimate",
    { config: { permission: "enrich:run", rateLimit: { max: 30, timeWindow: "1 minute" } }, schema: { tags: ["company-data"], summary: "Prévia de custo em tokens (X-Estimate-Only: não cobra)", params: idParams } },
    async (req) => estimateEnrichment(orgId(req), req.params.id, req.auth!.userId),
  );

  app.post(
    "/companies/:id/business-data",
    { config: { permission: "enrich:run", rateLimit: { max: 20, timeWindow: "1 minute" } }, schema: { tags: ["company-data"], summary: "Identifica e enriquece a empresa (consulta paga, com limites da conta)", params: idParams, body: z.object({ force: z.boolean().default(false) }) } },
    async (req) => {
      const dto = await enrichCompany({ organizationId: orgId(req), companyId: req.params.id, userId: req.auth!.userId, force: req.body.force, source: "manual" });
      return dto;
    },
  );

  app.post(
    "/companies/:id/business-data/confirm",
    {
      config: { permission: "enrich:run", rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: { tags: ["company-data"], summary: "Confirma qual candidato é a empresa e faz a consulta completa", params: idParams, body: z.object({ cnpj: z.string().trim().min(14).max(20) }) },
    },
    async (req) => {
      const dto = await enrichCompany({ organizationId: orgId(req), companyId: req.params.id, userId: req.auth!.userId, chosenCnpj: req.body.cnpj, source: "manual" });
      await writeAudit(req, { action: "company.data_match_confirmed", entityType: "company", entityId: req.params.id, metadata: { cnpj: cnpjDigits(req.body.cnpj) } });
      return dto;
    },
  );

  app.post(
    "/business-data/batch",
    {
      config: { permission: "enrich:run", rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { tags: ["company-data"], summary: "Enriquece várias empresas pela fila (ritmo controlado)", body: z.object({ companyIds: z.array(z.uuid()).min(1).max(100) }) },
    },
    async (req) => {
      const r = await enqueueBatch(orgId(req), req.body.companyIds, req.auth!.userId);
      await writeAudit(req, { action: "company.data_batch", entityType: "organization", entityId: orgId(req), metadata: r });
      return r;
    },
  );

  app.get("/business-data/settings", { schema: { tags: ["company-data"], summary: "Configuração, consumo de hoje e estado da chave (sem a chave)" } }, async (req) => dataSettingsView(orgId(req)));

  app.put("/business-data/settings", { config: { permission: "settings:manage" }, schema: { tags: ["company-data"], summary: "Atualiza a configuração de dados empresariais da conta", body: dataEnrichmentSettingsSchema } }, async (req) => {
    const organizationId = orgId(req);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    const next = { ...readOrgSettings(org.settings), dataEnrichment: req.body };
    await prisma.organization.update({ where: { id: organizationId }, data: { settings: next as unknown as Prisma.InputJsonValue } });
    await writeAudit(req, { action: "company_data.settings_updated", entityType: "organization", entityId: organizationId, metadata: { enabled: req.body.enabled, autoEnrich: req.body.autoEnrich, buckets: req.body.buckets, maxDailyRequests: req.body.maxDailyRequests, maxDailyTokens: req.body.maxDailyTokens } });
    return dataSettingsView(organizationId);
  });

  app.put(
    "/business-data/credential",
    {
      config: { permission: "settings:manage", rateLimit: { max: 10, timeWindow: "1 minute" } },
      schema: { tags: ["company-data"], summary: "Cadastra a chave da Econodata desta conta (validada pelo saldo, que não cobra)", body: z.object({ apiKey: z.string().trim().min(8, "Chave curta demais.").max(400, "Chave longa demais.").regex(/^\S+$/, "A chave não pode ter espaços.") }) },
    },
    async (req) => {
      const organizationId = orgId(req);
      let balance: number;
      try {
        balance = (await providerBalance(organizationId, req.auth!.userId, req.body.apiKey)).tokens;
      } catch (err) {
        const e = err instanceof ProviderError ? err : new ProviderError("UNAVAILABLE");
        throw new AppError(422, `DATA_${e.code}`, `Chave não salva. ${e.message}${e.detail ? ` Resposta do provedor: ${e.detail}` : ""}`);
      }
      const data = { encryptedKey: encryptSecret(req.body.apiKey), keyHint: keyHint(req.body.apiKey), updatedById: req.auth!.userId };
      await prisma.aiCredential.upsert({
        where: { organizationId_provider: { organizationId, provider: CREDENTIAL_PROVIDER } },
        create: { organizationId, provider: CREDENTIAL_PROVIDER, createdById: req.auth!.userId, ...data },
        update: data,
      });
      await writeAudit(req, { action: "company_data.credential_saved", entityType: "organization", entityId: organizationId, metadata: { provider: CREDENTIAL_PROVIDER, keyHint: data.keyHint } });
      return { ...(await dataSettingsView(organizationId)), balance };
    },
  );

  app.delete("/business-data/credential", { config: { permission: "settings:manage" }, schema: { tags: ["company-data"], summary: "Remove a chave da Econodata desta conta" } }, async (req) => {
    const organizationId = orgId(req);
    const r = await prisma.aiCredential.deleteMany({ where: { organizationId, provider: CREDENTIAL_PROVIDER } });
    if (r.count) await writeAudit(req, { action: "company_data.credential_removed", entityType: "organization", entityId: organizationId, metadata: { provider: CREDENTIAL_PROVIDER } });
    return { ...(await dataSettingsView(organizationId)), removed: r.count > 0 };
  });

  app.get("/business-data/balance", { config: { permission: "settings:manage", rateLimit: { max: 10, timeWindow: "1 minute" } }, schema: { tags: ["company-data"], summary: "Saldo de tokens no fornecedor (não cobra)" } }, async (req) => {
    try {
      return await providerBalance(orgId(req), req.auth!.userId);
    } catch (err) {
      const e = err instanceof ProviderError ? err : new ProviderError("UNAVAILABLE");
      throw new AppError(e.code === "NOT_CONFIGURED" ? 422 : 502, `DATA_${e.code}`, `${e.message}${e.detail ? ` ${e.detail}` : ""}${simulationActive() ? " (modo simulado)" : ""}`);
    }
  });
};
