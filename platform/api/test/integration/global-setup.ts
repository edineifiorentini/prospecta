import { execSync } from "node:child_process";
import pg from "pg";
import { integrationEnv } from "./env.ts";

/** Cria (se necessário) o banco prospecta_test e aplica as migrations versionadas. */
export default async function setup() {
  Object.assign(process.env, integrationEnv());
  const url = process.env.DATABASE_URL;
  if (!url || !url.includes("prospecta_test")) throw new Error("DATABASE_URL de teste ausente: gere platform/.env.dev e suba o Postgres com compose.devports.yaml.");
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const client = new pg.Client({ connectionString: admin.toString() });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = 'prospecta_test'");
  if (!exists.rowCount) await client.query("CREATE DATABASE prospecta_test");
  await client.end();
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
