import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { healthRoutes } from "./modules/health/routes.ts";
import { authRoutes } from "./modules/auth/routes.ts";

export const registerRoutes: FastifyPluginAsyncZod = async (app) => {
  await app.register(healthRoutes);
  await app.register(authRoutes);
};
