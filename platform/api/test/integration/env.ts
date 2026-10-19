import { existsSync, readFileSync } from "node:fs";

/** Ambiente dos testes de integração: banco e fila separados (prospecta_test, Valkey db 15). */
export function integrationEnv(): Record<string, string> {
  const file = new URL("../../../.env.dev", import.meta.url);
  if (!existsSync(file)) return {};
  const env = Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^([A-Z0-9_]+)=(.*)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1]!, m[2]!]),
  );
  const db = new URL(env.DATABASE_URL!);
  db.pathname = "/prospecta_test";
  const redis = new URL(env.REDIS_URL!);
  redis.pathname = "/15";
  return {
    ...env,
    NODE_ENV: "test",
    LOG_LEVEL: "warn",
    DATABASE_URL: db.toString(),
    REDIS_URL: redis.toString(),
    ADMIN_BOOTSTRAP_TOKEN: "integration-bootstrap-token-0123456789",
    SMTP_URL: "smtp://127.0.0.1:1025",
    CRAWLER_ALLOW_HOSTS: "",
  };
}
