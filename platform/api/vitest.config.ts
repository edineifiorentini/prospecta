import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: ["test/unit/**/*.test.ts"],
          environment: "node",
          env: {
            NODE_ENV: "test",
            DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
            REDIS_URL: "redis://127.0.0.1:1",
            APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
            SESSION_SECRET: "unit-test-session-secret-unit-test-session-secret",
            CRAWLER_ALLOW_HOSTS: "",
          },
        },
      },
      {
        test: {
          name: "integration",
          include: ["test/integration/**/*.test.ts"],
          environment: "node",
          fileParallelism: false,
          testTimeout: 60_000,
          hookTimeout: 120_000,
          globalSetup: ["test/integration/global-setup.ts"],
        },
      },
    ],
  },
});
