// Utilitários compartilhados pelos scripts de backup e restauração (executam comandos via docker compose).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/** Contagem exata de linhas por tabela do schema public, no formato "tabela=n". */
export const COUNT_SQL =
  "SELECT table_name || '=' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', table_name), false, true, '')))[1]::text " +
  "FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name";

export function compose(argv, opts = {}) {
  return spawnSync("docker", ["compose", ...argv], { cwd: root, encoding: "utf8", ...opts });
}

/** Executa SQL no container do PostgreSQL (usuário e senha vêm do próprio container). */
export function psql(sql, db = '"$POSTGRES_DB"') {
  const r = compose(["exec", "-T", "postgres", "sh", "-c", `psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d ${db} -At -c "${sql.replace(/"/g, '\\"')}"`]);
  if (r.status !== 0) throw new Error(r.stderr.trim() || `psql saiu com ${r.status}`);
  return r.stdout.trim();
}

export function tableCounts(db) {
  return Object.fromEntries(
    psql(COUNT_SQL, db)
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        const [t, n] = l.split("=");
        return [t, Number(n)];
      }),
  );
}

export function streamToFile(argv, file) {
  return new Promise((ok, fail) => {
    const out = createWriteStream(file, { mode: 0o600 });
    const p = spawn("docker", ["compose", ...argv], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.stdout.pipe(out);
    p.on("close", (code) => out.close(() => (code === 0 ? ok() : fail(new Error(err.trim() || `saída ${code}`)))));
  });
}

export function streamFromFile(file, argv) {
  return new Promise((ok, fail) => {
    const p = spawn("docker", ["compose", ...argv], { cwd: root, stdio: ["pipe", "pipe", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => (err += d));
    p.stdout.on("data", () => undefined);
    createReadStream(file).pipe(p.stdin);
    p.on("close", (code) => (code === 0 ? ok(err) : fail(new Error(err.trim() || `saída ${code}`))));
  });
}

export const sha256File = (file) =>
  new Promise((ok, fail) => {
    const h = createHash("sha256");
    createReadStream(file)
      .on("data", (d) => h.update(d))
      .on("end", () => ok(h.digest("hex")))
      .on("error", fail);
  });

export function requirePostgres() {
  const r = compose(["exec", "-T", "postgres", "sh", "-c", 'pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB"']);
  if (r.status !== 0) throw new Error("PostgreSQL não está em execução. Suba a pilha com: docker compose up -d");
}
