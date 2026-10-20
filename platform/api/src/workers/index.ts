import { Worker } from "bullmq";
import { bullConnection } from "../lib/redis.ts";
import { logger } from "../lib/logger.ts";
import { QUEUES, queue } from "../queues/index.ts";
import { processSearchJob } from "../modules/search/processor.ts";
import { processEnrichmentJob } from "../modules/enrichment/service.ts";
import { processAuditJob } from "../modules/audit/service.ts";
import { processSendMessage, refreshMessagingStatus } from "../modules/messaging/sender.ts";
import { applyRetention, backfillDataQuality, reconcileStaleJobs, sendTaskReminders } from "../modules/maintenance/tasks.ts";
import type { MaintenanceJobData } from "../queues/index.ts";

/** Registra os processadores de cada fila. Módulos são adicionados a cada fase. */
export async function startWorkers(): Promise<Worker[]> {
  const workers: Worker[] = [];

  // buscas: uma por vez (protege contra bloqueios nas fontes e respeita limites de uso)
  workers.push(new Worker(QUEUES.search, processSearchJob, { connection: bullConnection(), concurrency: 1, lockDuration: 120_000 }));

  // enriquecimento: concorrência baixa para não sobrecarregar sites de terceiros
  workers.push(new Worker(QUEUES.enrichment, processEnrichmentJob, { connection: bullConnection(), concurrency: 2, lockDuration: 180_000 }));

  // auditoria: uma por vez (Lighthouse usa um Chromium inteiro)
  workers.push(new Worker(QUEUES.audit, processAuditJob, { connection: bullConnection(), concurrency: 1, lockDuration: 300_000 }));

  // envio de WhatsApp: um por vez e no máximo 20 por minuto (além dos limites por organização)
  workers.push(new Worker(QUEUES.messaging, processSendMessage, { connection: bullConnection(), concurrency: 1, limiter: { max: 20, duration: 60_000 } }));

  const maintenance = new Worker(
    QUEUES.maintenance,
    async (job: { data: MaintenanceJobData }) => {
      switch (job.data.task) {
        case "reminders":
          return sendTaskReminders();
        case "retention":
          return applyRetention();
        case "stale-jobs":
          return reconcileStaleJobs();
        case "messaging-status":
          return refreshMessagingStatus();
        case "data-quality":
          return backfillDataQuality();
        default:
          logger.debug({ task: job.data.task }, "tarefa de manutenção sem processador");
      }
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  workers.push(maintenance);

  // tarefas periódicas (idempotentes; o agendador do BullMQ evita duplicatas)
  const m = queue(QUEUES.maintenance);
  await m.upsertJobScheduler("retention-daily", { pattern: "0 3 * * *", tz: "America/Sao_Paulo" }, { name: "maintenance", data: { task: "retention" } });
  await m.upsertJobScheduler("reminders", { every: 5 * 60_000 }, { name: "maintenance", data: { task: "reminders" } });
  await m.upsertJobScheduler("messaging-status", { every: 60_000 }, { name: "maintenance", data: { task: "messaging-status" } });
  await m.upsertJobScheduler("stale-jobs", { every: 10 * 60_000 }, { name: "maintenance", data: { task: "stale-jobs" } });
  await m.upsertJobScheduler("data-quality", { every: 10 * 60_000 }, { name: "maintenance", data: { task: "data-quality" } });

  for (const w of workers) {
    w.on("failed", (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, "job falhou"));
    w.on("error", (err) => logger.error({ queue: w.name, err: err.message }, "erro no worker"));
  }
  return workers;
}
