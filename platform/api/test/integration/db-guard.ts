import pg from "pg";

export const DISPOSABLE_MARK = "prospecta:descartavel";
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Trava de segurança: só deixa migrar ou limpar um banco local marcado como descartável
 * (COMMENT ON DATABASE … IS 'prospecta:descartavel', aplicado pelo compose.teste-isolado.yaml).
 * Bancos de desenvolvimento e produção não têm a marca, então os testes param antes de escrever.
 */
export async function assertDisposableDb(url = process.env.DATABASE_URL) {
  if (!url) throw new Error("DATABASE_URL de teste ausente: rode `node platform/scripts/teste-isolado.mjs up`.");
  const target = new URL(url);
  if (!LOOPBACK.has(target.hostname)) throw new Error(`Banco de teste recusado: ${target.hostname} não é local.`);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const r = await client.query<{ mark: string | null }>("SELECT shobj_description(oid, 'pg_database') AS mark FROM pg_database WHERE datname = current_database()");
    if (r.rows[0]?.mark !== DISPOSABLE_MARK) {
      throw new Error(`Banco ${target.pathname.slice(1)} em ${target.host} não está marcado como descartável. Nada foi alterado. Use \`node platform/scripts/teste-isolado.mjs up\`.`);
    }
  } finally {
    await client.end();
  }
}
