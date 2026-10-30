#!/usr/bin/env node
// Ambiente de teste ISOLADO: Postgres e Valkey descartáveis (compose.teste-isolado.yaml),
// sem ler o .env real e sem tocar na stack "prospecta". Segredos gerados na hora.
// Uso:
//   node platform/scripts/teste-isolado.mjs up     # sobe e grava platform/.local/teste-isolado.env
//   node platform/scripts/teste-isolado.mjs down   # derruba (os dados somem: tmpfs)
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const platform = join(here, "..");
const composeFile = join(platform, "compose.teste-isolado.yaml");
const envFile = join(platform, ".local", "teste-isolado.env");
const compose = (...args) => execFileSync("docker", ["compose", "-f", composeFile, ...args], { stdio: "inherit" });

const cmd = process.argv[2];
if (cmd === "up") {
  compose("up", "-d", "--wait");
  mkdirSync(dirname(envFile), { recursive: true });
  const lines = {
    NODE_ENV: "development",
    TZ: "America/Sao_Paulo",
    PORT: "4100",
    DATABASE_URL: "postgresql://teste:teste-isolado@127.0.0.1:55432/prospecta_test?schema=public",
    REDIS_URL: "redis://127.0.0.1:56379/0",
    APP_BASE_URL: "http://localhost:3100",
    APP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    SESSION_SECRET: randomBytes(48).toString("base64url"),
    ADMIN_BOOTSTRAP_TOKEN: randomBytes(24).toString("base64url"),
    COOKIE_SECURE: "false",
    SMTP_URL: "smtp://127.0.0.1:1",
    GMAPS_SCRAPER_ENABLED: "false",
    LOG_LEVEL: "info",
    // Sem chaves de IA: nenhuma chamada paga sai deste ambiente.
    PROSPECTA_DB_DESCARTAVEL: "1",
  };
  writeFileSync(envFile, Object.entries(lines).map(([k, v]) => `${k}=${v}`).join("\n") + "\n", { mode: 0o600 });
  console.log(`Ambiente isolado no ar. Variáveis em ${envFile}`);
} else if (cmd === "down") {
  compose("down", "--volumes", "--remove-orphans");
  rmSync(envFile, { force: true });
  console.log("Ambiente isolado removido.");
} else {
  console.error("Uso: node platform/scripts/teste-isolado.mjs up|down");
  process.exit(1);
}
