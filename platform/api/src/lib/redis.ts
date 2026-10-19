import { Redis } from "ioredis";
import { env } from "../config/env.ts";

/** Conexão compartilhada (rate limit, caches leves). BullMQ cria as suas próprias. */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true });

/** Opções de conexão para BullMQ (cada Queue/Worker abre a sua). */
export function bullConnection() {
  const url = new URL(env.REDIS_URL);
  return {
    host: url.hostname,
    port: Number(url.port || 6379),
    password: url.password ? decodeURIComponent(url.password) : undefined,
    maxRetriesPerRequest: null,
  };
}
