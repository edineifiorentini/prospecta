import type { Job } from "bullmq";
import { logger } from "../../lib/logger.ts";
import { prisma } from "../../lib/prisma.ts";
import { readOrgSettings } from "../orgs/settings.ts";
import { QUEUES, queue } from "../../queues/index.ts";
import { integrationConfig, SourceError } from "./http.ts";
import { syncRadar } from "./pncp.ts";

/** Trabalhos das fontes públicas: sincronização do radar (sob pedido ou diária, quando a conta agenda). */
export type PublicDataJobData = { task: "radar-sync"; organizationId: string } | { task: "radar-scheduled" };

export const enqueueRadarSync = (organizationId: string) =>
  queue(QUEUES.publicData).add("radar.sync", { task: "radar-sync", organizationId } satisfies PublicDataJobData, { jobId: `radar-${organizationId}-${Math.floor(Date.now() / 60_000)}`, attempts: 1 });

export async function radarSyncFor(organizationId: string) {
  const org = await prisma.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { settings: true } });
  const cfg = integrationConfig(org.settings, "pncp");
  if (!cfg.enabled) throw new SourceError("DISABLED");
  const radar = readOrgSettings(org.settings).radar;
  if (!radar.ufs.length && !radar.cityIbgeCodes.length) throw new SourceError("INVALID_REQUEST", "Escolha ao menos uma UF ou município no radar.");
  return syncRadar(organizationId, radar, { maxDaily: cfg.maxDailyRequests });
}

export async function processPublicDataJob(job: Job<PublicDataJobData>) {
  if (job.data.task === "radar-sync") return radarSyncFor(job.data.organizationId);
  // agendado: só contas com o PNCP ligado e a execução agendada marcada
  const orgs = await prisma.organization.findMany({ select: { id: true, settings: true } });
  for (const o of orgs) {
    const cfg = integrationConfig(o.settings, "pncp");
    if (!cfg.enabled || !cfg.scheduled) continue;
    await radarSyncFor(o.id).catch((err) => logger.warn({ organizationId: o.id, err: (err as Error).message }, "sincronização agendada do radar falhou"));
  }
}
