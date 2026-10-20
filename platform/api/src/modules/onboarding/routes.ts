import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma, type Prisma } from "../../lib/prisma.ts";
import { orgId } from "../../plugins/auth.ts";

const tourStatus = z.enum(["active", "completed", "dismissed"]);

/** Preferências do guia guardadas em users.preferences.onboarding. Usuário novo começa com o tour ativo. */
const onboardingPrefs = z
  .object({
    tour: z.object({ status: tourStatus, step: z.number().int().min(0).max(100) }).default({ status: "active", step: 0 }),
    checklistHidden: z.boolean().default(false),
  })
  .catch({ tour: { status: "active", step: 0 }, checklistHidden: false });

export function readOnboarding(preferences: unknown) {
  const p = (preferences && typeof preferences === "object" ? (preferences as Record<string, unknown>).onboarding : undefined) ?? {};
  return onboardingPrefs.parse(p);
}

/** Passos do guia de primeiros passos, concluídos a partir dos registros reais da organização. */
async function checklist(organizationId: string) {
  const [searches, companies, enriched, audits, deals, tasks, contacts, whatsapp, reports, members] = await Promise.all([
    prisma.searchJob.count({ where: { organizationId, status: "COMPLETED" } }),
    prisma.company.count({ where: { organizationId, status: "ACTIVE" } }),
    prisma.enrichmentJob.count({ where: { organizationId, status: "COMPLETED" } }),
    prisma.digitalAudit.count({ where: { organizationId, status: "COMPLETED" } }),
    prisma.deal.count({ where: { organizationId } }),
    prisma.task.count({ where: { organizationId } }),
    prisma.activity.count({ where: { organizationId, type: { in: ["CALL", "MEETING", "EMAIL"] } } }),
    prisma.messagingAccount.count({ where: { organizationId, status: "CONNECTED" } }),
    prisma.auditLog.count({ where: { organizationId, OR: [{ action: { startsWith: "report." } }, { action: { endsWith: "exported" } }] } }),
    prisma.membership.count({ where: { organizationId } }),
  ]);
  const step = (count: number, done = count > 0) => ({ done, count });
  return {
    search: step(searches),
    review: step(companies),
    enrich: step(enriched),
    audit: step(audits),
    crm: step(deals),
    task: step(tasks),
    contact: step(contacts),
    whatsapp: step(whatsapp),
    report: step(reports),
    team: step(members - 1, members > 1),
  };
}

export const onboardingRoutes: FastifyPluginAsyncZod = async (app) => {
  app.get("/me/onboarding", { schema: { tags: ["onboarding"], summary: "Andamento do guia de primeiros passos do usuário e da organização" } }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { preferences: true } });
    return { ...readOnboarding(user.preferences), checklist: await checklist(orgId(req)) };
  });

  app.patch(
    "/me/onboarding",
    {
      schema: {
        tags: ["onboarding"],
        summary: "Atualiza o andamento do tour ou oculta o guia do painel",
        body: z.object({ tour: z.object({ status: tourStatus, step: z.number().int().min(0).max(100) }).optional(), checklistHidden: z.boolean().optional() }),
      },
    },
    async (req) => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.auth!.userId }, select: { preferences: true } });
      const prefs = (user.preferences && typeof user.preferences === "object" ? user.preferences : {}) as Record<string, unknown>;
      const current = readOnboarding(prefs);
      const next = { ...current, ...(req.body.tour ? { tour: req.body.tour } : {}), ...(req.body.checklistHidden !== undefined ? { checklistHidden: req.body.checklistHidden } : {}) };
      await prisma.user.update({ where: { id: req.auth!.userId }, data: { preferences: { ...prefs, onboarding: next } as Prisma.InputJsonValue } });
      return next;
    },
  );
};
