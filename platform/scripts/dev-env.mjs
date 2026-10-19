#!/usr/bin/env node
// Gera platform/.env.dev (ignorado pelo Git) para rodar API/worker/web no host,
// apontando para os serviços publicados por platform/compose.devports.yaml em 127.0.0.1.
// Uso:  node platform/scripts/dev-env.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const env = Object.fromEntries(
  readFileSync(join(root, ".env"), "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);

const enc = encodeURIComponent;
const lines = {
  NODE_ENV: "development",
  TZ: "America/Sao_Paulo",
  PORT: "4000",
  DATABASE_URL: `postgresql://${env.POSTGRES_USER}:${enc(env.POSTGRES_PASSWORD)}@127.0.0.1:5433/${env.POSTGRES_DB}?schema=public`,
  REDIS_URL: `redis://:${enc(env.VALKEY_PASSWORD)}@127.0.0.1:6380`,
  APP_BASE_URL: "http://localhost:3001",
  APP_ENCRYPTION_KEY: env.APP_ENCRYPTION_KEY,
  SESSION_SECRET: env.SESSION_SECRET,
  ADMIN_BOOTSTRAP_TOKEN: env.ADMIN_BOOTSTRAP_TOKEN,
  COOKIE_SECURE: "false",
  SMTP_URL: "smtp://127.0.0.1:1025",
  MAIL_FROM: env.MAIL_FROM,
  GMAPS_SCRAPER_URL: "http://127.0.0.1:8082",
  GMAPS_SCRAPER_ENABLED: env.GMAPS_SCRAPER_ENABLED ?? "true",
  OVERPASS_URL: env.OVERPASS_URL,
  NOMINATIM_URL: env.NOMINATIM_URL,
  HTTP_USER_AGENT: env.HTTP_USER_AGENT,
  WUZAPI_URL: "http://127.0.0.1:8081",
  WUZAPI_ADMIN_TOKEN: env.WUZAPI_ADMIN_TOKEN,
  WUZAPI_WEBHOOK_URL: "http://host.docker.internal:4000/api/webhooks/wuzapi",
  LOG_LEVEL: "debug",
};

const out = Object.entries(lines).map(([k, v]) => `${k}=${v ?? ""}`).join("\n") + "\n";
writeFileSync(join(root, "platform", ".env.dev"), out, { mode: 0o600 });
console.log("platform/.env.dev gerado.");
