import { execSync } from "node:child_process";
import { integrationEnv } from "./env.ts";
import { assertDisposableDb } from "./db-guard.ts";

/** Confere que o banco prospecta_test é descartável e aplica as migrations versionadas. */
export default async function setup() {
  Object.assign(process.env, integrationEnv());
  const url = process.env.DATABASE_URL;
  if (!url || !url.includes("prospecta_test")) throw new Error("DATABASE_URL de teste ausente: rode `node platform/scripts/teste-isolado.mjs up`.");
  await assertDisposableDb(url);
  execSync("npx prisma migrate deploy", { stdio: "pipe", env: { ...process.env, DATABASE_URL: url } });
}
