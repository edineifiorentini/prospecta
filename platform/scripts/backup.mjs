#!/usr/bin/env node
// Backup do banco da plataforma (pg_dump em formato custom) para platform/backups/.
//
//   node platform/scripts/backup.mjs                 # banco
//   node platform/scripts/backup.mjs --with-whatsapp # + sessão do WuzAPI (contém credenciais do WhatsApp)
//   node platform/scripts/backup.mjs --keep 14       # mantém só os 14 backups mais recentes
//
// Gera <nome>.dump, <nome>.sha256 e <nome>.json (contagem de linhas por tabela, para conferir a restauração).
// Os arquivos ficam fora do Git (.gitignore) e devem ser guardados em local protegido.
import { mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { psql, requirePostgres, root, sha256File, streamToFile, tableCounts } from "./lib/compose.mjs";

const dir = join(root, "platform", "backups");
const { values: args } = parseArgs({ options: { "with-whatsapp": { type: "boolean", default: false }, keep: { type: "string" } } });

async function main() {
  requirePostgres();
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  const base = join(dir, `prospecta-${stamp}`);
  const name = (f) => basename(f);

  await streamToFile(["exec", "-T", "postgres", "sh", "-c", 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --compress=6 --no-owner'], `${base}.dump`);
  const tables = tableCounts('"$POSTGRES_DB"');
  const migrations = psql("SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY 1").split(/\r?\n/).filter(Boolean);

  const files = [`${base}.dump`];
  if (args["with-whatsapp"]) {
    await streamToFile(["exec", "-T", "wuzapi", "tar", "czf", "-", "-C", "/data", "."], `${base}-wuzapi.tgz`);
    files.push(`${base}-wuzapi.tgz`);
  }
  const hashes = [];
  for (const f of files) hashes.push(`${await sha256File(f)}  ${name(f)}`);
  writeFileSync(`${base}.sha256`, hashes.join("\n") + "\n");
  writeFileSync(
    `${base}.json`,
    JSON.stringify({ createdAt: new Date().toISOString(), migrations, tables, files: files.map((f) => ({ name: name(f), bytes: statSync(f).size })) }, null, 2) + "\n",
  );

  const keep = args.keep ? Number(args.keep) : 0;
  if (keep > 0) {
    const dumps = readdirSync(dir).filter((f) => /^prospecta-\d{8}-\d{6}\.dump$/.test(f)).sort().reverse();
    for (const old of dumps.slice(keep)) {
      const prefix = old.replace(/\.dump$/, "");
      for (const f of readdirSync(dir).filter((x) => x.startsWith(prefix))) rmSync(join(dir, f));
      console.log(`removido backup antigo: ${prefix}`);
    }
  }

  const total = Object.values(tables).reduce((a, b) => a + b, 0);
  console.log(`Backup concluído: ${base}.dump (${(statSync(`${base}.dump`).size / 1024).toFixed(0)} KB, ${Object.keys(tables).length} tabelas, ${total} linhas)`);
  if (args["with-whatsapp"]) console.log("Atenção: o arquivo -wuzapi.tgz contém a sessão do WhatsApp. Guarde-o com o mesmo cuidado de uma senha.");
}

main().catch((err) => {
  console.error(`Falha no backup: ${err.message}`);
  process.exitCode = 1;
});
