import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { healthRoutes } from "./modules/health/routes.ts";
import { authRoutes } from "./modules/auth/routes.ts";
import { searchRoutes } from "./modules/search/routes.ts";
import { listRoutes } from "./modules/lists/routes.ts";
import { enrichmentRoutes } from "./modules/enrichment/routes.ts";

export const registerRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(searchRoutes);
  await app.register(listRoutes);
  await app.register(enrichmentRoutes);
};
