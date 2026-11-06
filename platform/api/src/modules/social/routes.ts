import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { notFound } from "../../lib/errors.ts";
import { prisma } from "../../lib/prisma.ts";
import { orgId } from "../../plugins/auth.ts";
import { sourceKeyStatus } from "../public-data/credentials.ts";
import { integrationConfig, publicMockActive, sourceHttpError } from "../public-data/http.ts";
import { instagramAccount, instagramForCompany, instagramHandle } from "./instagram.ts";

const idParams = z.object({ id: z.uuid() });

/** Perfil do Instagram da empresa pela API oficial (Business Discovery). */
export const socialRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/companies/:id/instagram", { schema: { tags: ["social"], summary: "Perfil do Instagram lido pela API oficial e situação da integração", params: idParams } }, async (req) => {
    const organizationId = orgId(req);
    const c = await prisma.company.findFirst({ where: { id: req.params.id, organizationId }, select: { website: true, socialProfiles: { where: { network: "INSTAGRAM" }, orderBy: { confidence: "desc" } } } });
    if (!c) throw notFound("Empresa não encontrada.");
    const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
    const cfg = integrationConfig(org.settings, "instagram");
    const [key, account] = await Promise.all([sourceKeyStatus(organizationId, "instagram"), instagramAccount(organizationId)]);
    const p = c.socialProfiles.find((s) => s.status !== "INVALID") ?? null;
    return {
      enabled: cfg.enabled,
      configured: key.hasKey || publicMockActive(),
      simulated: publicMockActive(),
      account: account?.username ?? null,
      suggestedHandle: p ? null : instagramHandle(c.website),
      profile: p ? { handle: p.handle, url: p.url, status: p.status, confidence: p.confidence, evidence: p.evidence, details: p.details, lastCheckedAt: p.lastCheckedAt } : null,
    };
  });

  app.post(
    "/companies/:id/instagram",
    {
      config: { permission: "enrich:run", rateLimit: { max: 20, timeWindow: "1 minute" } },
      schema: { tags: ["social"], summary: "Lê o perfil comercial do Instagram (bio, site, contatos) pela API oficial", params: idParams, body: z.object({ handle: z.string().trim().max(200).optional(), force: z.boolean().default(false) }) },
    },
    async (req) => {
      try {
        return await instagramForCompany({ organizationId: orgId(req), companyId: req.params.id, userId: req.auth!.userId, handle: req.body.handle || null, force: req.body.force });
      } catch (err) {
        throw sourceHttpError(err);
      }
    },
  );
};
