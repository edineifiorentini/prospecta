import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";
import { env } from "../../config/env.ts";

export const mapRoutes: FastifyPluginAsyncZod = async (app) => {
  // A chave do mapa do Google é usada no navegador (é assim que a Maps JavaScript API funciona) e deve estar
  // restrita por site no Google Cloud; aqui ela só é entregue a usuários logados.
  app.get("/config/maps", { schema: { tags: ["maps"], summary: "Configuração do mapa visual (Google, se houver chave; senão OpenStreetMap)" } }, async () => ({
    google: env.GOOGLE_MAPS_API_KEY ? { apiKey: env.GOOGLE_MAPS_API_KEY, mapId: env.GOOGLE_MAPS_MAP_ID || "DEMO_MAP_ID" } : null,
  }));
};
