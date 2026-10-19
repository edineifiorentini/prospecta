import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { prisma } from "../../lib/prisma.ts";
import { redis } from "../../lib/redis.ts";
import { env } from "../../config/env.ts";

async function probe(fn: () => Promise<unknown>, timeoutMs = 3000) {
  const started = Date.now();
  try {
    await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), timeoutMs))]);
    return { ok: true, ms: Date.now() - started };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: (err as Error).message.slice(0, 120) };
  }
}

export const healthRoutes: FastifyPluginAsyncZod = async (app) => {
  // usado pelo healthcheck do contêiner: só banco e fila
  app.get("/health", { config: { public: true, rateLimit: false }, schema: { tags: ["system"], summary: "Saúde da API (banco e fila)" } }, async (_req, reply) => {
    const [db, queue] = await Promise.all([probe(() => prisma.$queryRaw`SELECT 1`), probe(() => redis.ping())]);
    const ok = db.ok && queue.ok;
    return reply.code(ok ? 200 : 503).send({ ok, db, queue });
  });

  // visão detalhada para a tela de Configurações (requer login)
  app.get("/system/status", { schema: { tags: ["system"], summary: "Estado dos serviços integrados" } }, async () => {
    const [db, queue, scraper, wuzapi] = await Promise.all([
      probe(() => prisma.$queryRaw`SELECT 1`),
      probe(() => redis.ping()),
      env.GMAPS_SCRAPER_ENABLED
        ? probe(async () => {
            const r = await fetch(`${env.GMAPS_SCRAPER_URL}/api/v1/jobs`, { signal: AbortSignal.timeout(3000) });
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
          })
        : Promise.resolve({ ok: false, ms: 0, error: "desativado" }),
      probe(async () => {
        const r = await fetch(`${env.WUZAPI_URL}/health`, { signal: AbortSignal.timeout(3000) });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
      }),
    ]);
    return { db, queue, scraper, wuzapi, googleMapsEnabled: env.GMAPS_SCRAPER_ENABLED, version: "0.1.0" };
  });
};
