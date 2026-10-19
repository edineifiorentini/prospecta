import { Worker } from "bullmq";
import { bullConnection } from "../lib/redis.ts";
import { logger } from "../lib/logger.ts";
import { QUEUES, queue } from "../queues/index.ts";

/** Registra os processadores de cada fila. Módulos são adicionados a cada fase. */
export async function startWorkers(): Promise<Worker[]> {
  const workers: Worker[] = [];

  const maintenance = new Worker(
    QUEUES.maintenance,
    async (job) => {
      logger.debug({ task: job.data.task }, "manutenção");
    },
    { connection: bullConnection(), concurrency: 1 },
  );
  workers.push(maintenance);

  // tarefas periódicas (idempotentes; o agendador do BullMQ evita duplicatas)
  const m = queue(QUEUES.maintenance);
  await m.upsertJobScheduler("retention-daily", { pattern: "0 3 * * *", tz: "America/Sao_Paulo" }, { name: "maintenance", data: { task: "retention" } });
  await m.upsertJobScheduler("reminders", { every: 5 * 60_000 }, { name: "maintenance", data: { task: "reminders" } });
  await m.upsertJobScheduler("stale-jobs", { every: 10 * 60_000 }, { name: "maintenance", data: { task: "stale-jobs" } });

  for (const w of workers) {
    w.on("failed", (job, err) => logger.error({ queue: w.name, jobId: job?.id, err: err.message }, "job falhou"));
    w.on("error", (err) => logger.error({ queue: w.name, err: err.message }, "erro no worker"));
  }
  return workers;
}
