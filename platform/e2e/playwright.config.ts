import { defineConfig, devices } from "@playwright/test";

// Usa um navegador já instalado no computador (Edge por padrão; E2E_CHANNEL=chrome para o Chrome),
// com perfil temporário — nada é baixado e o perfil do usuário não é tocado.
const channel = process.env.E2E_CHANNEL ?? "msedge";

export default defineConfig({
  testDir: "./tests",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]],
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  outputDir: "test-results",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    channel,
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    { name: "desktop", dependencies: ["setup"], use: { ...devices["Desktop Chrome"], channel, storageState: ".auth/user.json" }, testIgnore: /auth\.setup\.ts/ },
  ],
});
