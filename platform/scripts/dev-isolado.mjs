#!/usr/bin/env node
// Sobe API (porta 4100) ou site (porta 3100) no host usando SOMENTE o ambiente isolado
// (platform/.local/teste-isolado.env). Antes de iniciar a API, confere que o banco tem a marca
// "prospecta:descartavel"; sem ela, não inicia. Chaves de IA para testes reais são cadastradas na
// própria tela (Configurações › Inteligência artificial) e ficam cifradas nesse banco descartável.
// Uso: node platform/scripts/dev-isolado.mjs api|web
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const platform = join(here, "..");
const envFile = join(platform, ".local", "teste-isolado.env");
if (!existsSync(envFile)) {
  console.error("Ambiente isolado ausente. Rode antes: node platform/scripts/teste-isolado.mjs up");
  process.exit(1);
}
const env = Object.fromEntries(
  readFileSync(envFile, "utf8")
    .split(/\r?\n/)
    .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
    .filter(Boolean)
    .map((m) => [m[1], m[2]]),
);
// só este computador: nada do ambiente de teste fica visível na rede local
env.HOST = "127.0.0.1";

const which = process.argv[2];
if (which === "api") {
  const pg = createRequire(join(platform, "api", "package.json"))("pg");
  const url = new URL(env.DATABASE_URL);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)) throw new Error("Banco não é local: recusado.");
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const r = await client.query("SELECT shobj_description(oid, 'pg_database') AS mark FROM pg_database WHERE datname = current_database()");
  await client.end();
  if (r.rows[0]?.mark !== "prospecta:descartavel") throw new Error("Banco sem a marca de descartável: recusado.");
  const migrate = spawn("npx", ["prisma", "migrate", "deploy"], { cwd: join(platform, "api"), env: { ...process.env, ...env }, stdio: "inherit", shell: true });
  migrate.on("exit", (code) => {
    if (code !== 0) process.exit(code ?? 1);
    // watch: recarrega sozinho quando o código muda
    spawn("npx", ["tsx", "watch", "src/server.ts"], { cwd: join(platform, "api"), env: { ...process.env, ...env }, stdio: "inherit", shell: true }).on("exit", (c) => process.exit(c ?? 0));
  });
} else if (which === "web") {
  spawn("npx", ["next", "dev", "-p", "3100", "-H", "127.0.0.1"], { cwd: join(platform, "web"), env: { ...process.env, API_PROXY_URL: `http://127.0.0.1:${env.PORT}` }, stdio: "inherit", shell: true }).on("exit", (c) => process.exit(c ?? 0));
} else {
  console.error("Uso: node platform/scripts/dev-isolado.mjs api|web");
  process.exit(1);
}
