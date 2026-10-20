import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const here = dirname(fileURLToPath(import.meta.url));
export const root = resolve(here, "../..");
export const E2E_EMAIL = process.env.E2E_EMAIL ?? "e2e@prospecta.local";
export const STATE = resolve(here, ".auth/state.json");
/** Prefixo dos registros criados pelos testes (removidos no final). */
export const PREFIX = "[E2E]";

export type E2EState = { email: string; tempPassword: string; password: string; mode: "docker" | "dev" };
export const readState = (): E2EState => JSON.parse(readFileSync(STATE, "utf8"));

export function apiContainerRunning() {
  const r = spawnSync("docker", ["compose", "ps", "--status", "running", "--services"], { cwd: root, encoding: "utf8" });
  return r.status === 0 && r.stdout.split(/\r?\n/).includes("platform-api");
}

export function sql(statement: string) {
  return spawnSync("docker", ["compose", "exec", "-T", "postgres", "sh", "-c", `psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -At -c "${statement}"`], { cwd: root, encoding: "utf8" });
}

export const hasState = () => existsSync(STATE);
