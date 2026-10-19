import { env } from "./config/env.ts";
import { buildApp } from "./app.ts";
import { prisma } from "./lib/prisma.ts";
import { redis } from "./lib/redis.ts";
import { closeQueues } from "./queues/index.ts";

const app = await buildApp();

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "encerrando API");
  try {
    await app.close();
    await closeQueues();
    await prisma.$disconnect();
    redis.disconnect();
  } finally {
    process.exit(0);
  }
};
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

await app.listen({ host: "0.0.0.0", port: env.PORT });
