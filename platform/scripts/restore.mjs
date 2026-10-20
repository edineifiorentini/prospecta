#!/usr/bin/env node
// Restauração de backups gerados por backup.mjs.
//
//   node platform/scripts/restore.mjs platform/backups/prospecta-AAAAMMDD-HHMMSS.dump
//       verifica o backup: confere o SHA-256, restaura num banco temporário, compara a contagem
//       de linhas com o manifesto e apaga o banco temporário. Não altera os dados atuais.
//
//   node platform/scripts/restore.mjs <arquivo.dump> --apply --yes
//       substitui o banco da plataforma pelo backup. Antes, salva um backup de segurança do banco atual
//       em platform/backups/pre-restore-*.dump e para a API e o worker; ao final, sobe os dois de novo.
//
//   --target <nome>     restaura em outro banco (padrão: o banco da plataforma)
//   --whatsapp <.tgz>   com --apply, restaura também a sessão do WuzAPI (o serviço é reiniciado)
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { compose, psql, requirePostgres, root, sha256File, streamFromFile, streamToFile, tableCounts } from "./lib/compose.mjs";

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: { apply: { type: "boolean", default: false }, yes: { type: "boolean", default: false }, target: { type: "string" }, whatsapp: { type: "string" } },
});

const SAFE_NAME = /^[a-z_][a-z0-9_]{0,62}$/;
const log = (m) => console.log(`• ${m}`);

function mainDbName() {
  const r = compose(["exec", "-T", "postgres", "printenv", "POSTGRES_DB"]);
  return r.stdout.trim() || "prospecta";
}

function dbExists(name) {
  return psql(`SELECT 1 FROM pg_database WHERE datname = '${name}'`, "postgres") === "1";
}

function dropDb(name) {
  psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${name}' AND pid <> pg_backend_pid()`, "postgres");
  psql(`DROP DATABASE IF EXISTS ${name}`, "postgres");
}

async function restoreInto(file, name) {
  psql(`CREATE DATABASE ${name}`, "postgres");
  await streamFromFile(file, ["exec", "-T", "postgres", "sh", "-c", `pg_restore -U "$POSTGRES_USER" -d ${name} --no-owner --exit-on-error`]);
}

function compare(expected, actual) {
  const diffs = [];
  for (const [t, n] of Object.entries(expected)) if (actual[t] !== n) diffs.push(`${t}: esperado ${n}, restaurado ${actual[t] ?? "ausente"}`);
  return diffs;
}

async function main() {
  const file = positionals[0] ? resolve(positionals[0]) : null;
  if (!file || !existsSync(file)) throw new Error("Informe o arquivo .dump gerado por backup.mjs.");
  requirePostgres();
  const base = file.replace(/\.dump$/, "");

  // 1. integridade do arquivo
  if (existsSync(`${base}.sha256`)) {
    const expected = readFileSync(`${base}.sha256`, "utf8").split(/\r?\n/).find((l) => l.endsWith(basename(file)))?.split(/\s+/)[0];
    const actual = await sha256File(file);
    if (expected && expected !== actual) throw new Error("SHA-256 não confere: o arquivo foi alterado ou está corrompido.");
    log("SHA-256 confere");
  } else log("sem arquivo .sha256 ao lado do backup; integridade não verificada");
  const manifest = existsSync(`${base}.json`) ? JSON.parse(readFileSync(`${base}.json`, "utf8")) : null;

  // 2. restauração de teste em banco temporário
  const scratch = "prospecta_restore_check";
  dropDb(scratch);
  await restoreInto(file, scratch);
  const restored = tableCounts(scratch);
  dropDb(scratch);
  const total = Object.values(restored).reduce((a, b) => a + b, 0);
  if (manifest) {
    const diffs = compare(manifest.tables, restored);
    if (diffs.length) throw new Error(`contagens diferentes do manifesto:\n  ${diffs.join("\n  ")}`);
    log(`restauração de teste ok: ${Object.keys(restored).length} tabelas, ${total} linhas iguais ao manifesto`);
  } else log(`restauração de teste ok: ${Object.keys(restored).length} tabelas, ${total} linhas (sem manifesto para comparar)`);

  if (!args.apply) {
    console.log("Backup válido. Nada foi alterado. Para substituir o banco atual use --apply --yes.");
    return;
  }

  // 3. aplicação
  const mainDb = mainDbName();
  const target = args.target ?? mainDb;
  if (!SAFE_NAME.test(target)) throw new Error("Nome de banco inválido.");
  if (!args.yes) throw new Error(`--apply substitui o banco "${target}". Confirme com --yes.`);
  const isMain = target === mainDb;

  if (dbExists(target)) {
    mkdirSync(join(root, "platform", "backups"), { recursive: true });
    const safety = join(root, "platform", "backups", `pre-restore-${new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15)}-${target}.dump`);
    await streamToFile(["exec", "-T", "postgres", "sh", "-c", `pg_dump -U "$POSTGRES_USER" -d ${target} --format=custom --no-owner`], safety);
    log(`backup de segurança do banco atual: ${safety}`);
  }

  const running = isMain ? compose(["ps", "--status", "running", "--services"]).stdout.split(/\r?\n/).filter((s) => ["platform-api", "platform-worker"].includes(s)) : [];
  if (running.length) {
    compose(["stop", ...running], { stdio: "inherit" });
    log(`parados: ${running.join(", ")}`);
  }
  if (isMain) log("se a API ou o worker estiverem rodando fora do Docker (modo desenvolvimento), pare-os antes de continuar");

  try {
    dropDb(target);
    await restoreInto(file, target);
    const after = tableCounts(target);
    const diffs = manifest ? compare(manifest.tables, after) : [];
    if (diffs.length) throw new Error(`banco restaurado difere do manifesto:\n  ${diffs.join("\n  ")}`);
    log(`banco "${target}" restaurado (${Object.values(after).reduce((a, b) => a + b, 0)} linhas)`);

    if (args.whatsapp) {
      const tgz = resolve(args.whatsapp);
      if (!existsSync(tgz)) throw new Error("Arquivo da sessão do WhatsApp não encontrado.");
      compose(["stop", "wuzapi"], { stdio: "inherit" });
      await streamFromFile(tgz, ["run", "--rm", "--no-deps", "-T", "--entrypoint", "sh", "wuzapi", "-c", "rm -rf /data/* && tar xzf - -C /data"]);
      compose(["start", "wuzapi"], { stdio: "inherit" });
      log("sessão do WuzAPI restaurada");
    }
  } finally {
    if (running.length) {
      compose(["start", ...running], { stdio: "inherit" });
      log(`reiniciados: ${running.join(", ")}`);
    }
  }
  console.log("Restauração concluída.");
}

main().catch((err) => {
  console.error(`Falha na restauração: ${err.message}`);
  process.exitCode = 1;
});
