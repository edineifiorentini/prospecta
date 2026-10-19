import { defineConfig } from "prisma/config";

// DATABASE_URL vem do ambiente (containers) ou de ../.env.dev (desenvolvimento no host).
try {
  process.loadEnvFile?.("../.env.dev");
} catch {
  /* arquivo opcional */
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx src/cli/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
