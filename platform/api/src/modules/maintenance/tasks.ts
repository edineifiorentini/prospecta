import { env } from "../../config/env.ts";
import { prisma, Prisma } from "../../lib/prisma.ts";
import { logger } from "../../lib/logger.ts";
import { sendMail } from "../../lib/mailer.ts";
import { readOrgSettings } from "../orgs/settings.ts";

const day = 24 * 3600 * 1000;

/** Envia lembretes de tarefas vencendo (e-mail ao responsável) e marca como lembradas. */
export async function sendTaskReminders(now = new Date()) {
  const due = await prisma.task.findMany({
    where: { status: "OPEN", remindAt: { lte: now }, remindedAt: null },
    take: 100,
    include: { assignee: { select: { email: true, name: true, isActive: true } }, company: { select: { id: true, name: true } } },
  });
  let sent = 0;
  for (const t of due) {
    if (t.assignee?.isActive) {
      const link = t.company ? `${env.APP_BASE_URL}/empresas/${t.company.id}?tab=tarefas` : `${env.APP_BASE_URL}/tarefas`;
      const when = t.dueAt ? t.dueAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "sem prazo";
      const ok = await sendMail(t.assignee.email, `Lembrete: ${t.title}`, `Olá, ${t.assignee.name}.\n\nLembrete da tarefa "${t.title}"${t.company ? ` (${t.company.name})` : ""}, prazo: ${when}.\n\n${link}\n`);
      if (ok) sent++;
    }
    await prisma.task.update({ where: { id: t.id }, data: { remindedAt: now } });
  }
  if (due.length) logger.info({ due: due.length, sent }, "lembretes de tarefas processados");
  return { due: due.length, sent };
}

/** Política de retenção por organização (configurável em Configurações → Organização). */
export async function applyRetention(now = new Date()) {
  const orgs = await prisma.organization.findMany({ select: { id: true, settings: true } });
  const summary: Record<string, number> = { rawCleared: 0, resultsCleared: 0, archivedDeleted: 0, auditDeleted: 0 };
  for (const org of orgs) {
    const r = readOrgSettings(org.settings).retention;
    const rawCutoff = new Date(now.getTime() - r.rawDataDays * day);
    const a = await prisma.leadSource.updateMany({ where: { organizationId: org.id, collectedAt: { lt: rawCutoff }, NOT: { rawData: { equals: Prisma.DbNull } } }, data: { rawData: Prisma.DbNull } });
    const b = await prisma.searchResult.updateMany({ where: { searchJob: { organizationId: org.id }, createdAt: { lt: rawCutoff }, NOT: { rawData: { equals: Prisma.DbNull } } }, data: { rawData: Prisma.DbNull } });
    const archived = await prisma.company.findMany({ where: { organizationId: org.id, status: "ARCHIVED", archivedAt: { lt: new Date(now.getTime() - r.archivedCompanyDays * day) } }, select: { id: true } });
    if (archived.length) {
      await prisma.company.deleteMany({ where: { id: { in: archived.map((c) => c.id) } } });
      await prisma.auditLog.create({ data: { organizationId: org.id, action: "retention.companies_deleted", metadata: { count: archived.length, olderThanDays: r.archivedCompanyDays } } });
    }
    const c = await prisma.auditLog.deleteMany({ where: { organizationId: org.id, createdAt: { lt: new Date(now.getTime() - r.auditLogDays * day) } } });
    const accounts = await prisma.messagingAccount.findMany({ where: { organizationId: org.id }, select: { id: true } });
    await prisma.webhookEvent.deleteMany({ where: { messagingAccountId: { in: accounts.map((x) => x.id) }, receivedAt: { lt: new Date(now.getTime() - r.webhookEventDays * day) } } });
    summary.rawCleared! += a.count;
    summary.resultsCleared! += b.count;
    summary.archivedDeleted! += archived.length;
    summary.auditDeleted! += c.count;
  }
  // segurança: sessões e tokens vencidos
  await prisma.session.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - 7 * day) } }, { revokedAt: { lt: new Date(now.getTime() - 30 * day) } }] } });
  await prisma.passwordResetToken.deleteMany({ where: { OR: [{ expiresAt: { lt: new Date(now.getTime() - day) } }, { usedAt: { not: null } }] } });
  await prisma.webhookEvent.deleteMany({ where: { messagingAccountId: null, receivedAt: { lt: new Date(now.getTime() - 30 * day) } } });
  logger.info(summary, "retenção aplicada");
  return summary;
}

/** Reconcilia registros de jobs que ficaram "em andamento" após queda/reinício do worker. */
export async function reconcileStaleJobs(now = new Date()) {
  const searches = await prisma.searchJob.updateMany({
    where: { status: { in: ["SUBMITTED", "RUNNING", "DOWNLOADING", "IMPORTING"] }, updatedAt: { lt: new Date(now.getTime() - 90 * 60 * 1000) } },
    data: { status: "FAILED", finishedAt: now, error: "Interrompida: o processamento não respondeu por 90 minutos (worker reiniciado ou motor travado)." },
  });
  const stale = await prisma.enrichmentJob.findMany({ where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - 30 * 60 * 1000) } }, select: { id: true, companyId: true } });
  if (stale.length) {
    await prisma.enrichmentJob.updateMany({ where: { id: { in: stale.map((s) => s.id) } }, data: { status: "FAILED", finishedAt: now, error: "Tempo limite excedido." } });
    await prisma.company.updateMany({ where: { id: { in: stale.map((s) => s.companyId) }, enrichmentStatus: "RUNNING" }, data: { enrichmentStatus: "FAILED" } });
  }
  const audits = await prisma.digitalAudit.updateMany({ where: { status: "RUNNING", startedAt: { lt: new Date(now.getTime() - 45 * 60 * 1000) } }, data: { status: "FAILED", finishedAt: now, error: "Tempo limite excedido." } });
  return { searches: searches.count, enrichments: stale.length, audits: audits.count };
}
