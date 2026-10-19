import { writeFileSync } from "node:fs";
import type { Worker } from "bullmq";
import { logger } from "./lib/logger.ts";
import { prisma } from "./lib/prisma.ts";
import { redis } from "./lib/redis.ts";
import { closeQueues } from "./queues/index.ts";
import { startWorkers } from "./workers/index.ts";

const workers: Worker[] = await startWorkers();
logger.info({ queues: workers.map((w) => w.name) }, "workers iniciados");

// sinal de vida para o healthcheck do contêiner
const beat = () => {
  try {
    writeFileSync("/tmp/worker-alive", String(Date.now()));
  } catch {
    /* fora do contêiner (Windows) */
  }
};
beat();
const heartbeat = setInterval(beat, 30_000);

const shutdown = async (signal: string) => {
  logger.info({ signal }, "encerrando workers");
  clearInterval(heartbeat);
  try {
    await Promise.all(workers.map((w) => w.close()));
    await closeQueues();
    await prisma.$disconnect();
    redis.disconnect();
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
// falhas inesperadas: registra e encerra de forma limpa (o Docker reinicia o worker; jobs ativos são retomados pelo BullMQ)
process.on("uncaughtException", (err) => {
  logger.fatal({ err: err.message, stack: err.stack?.split("\n").slice(0, 5).join(" | ") }, "exceção não tratada no worker");
  void shutdown("uncaughtException");
});
process.on("unhandledRejection", (reason) => logger.error({ reason: String(reason).slice(0, 300) }, "promessa rejeitada sem tratamento"));
process.on("SIGINT", () => void shutdown("SIGINT"));
