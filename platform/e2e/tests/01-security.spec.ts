import { expect, test } from "@playwright/test";

test.use({ storageState: { cookies: [], origins: [] } });

test("sem sessão, páginas e API exigem login", async ({ page, request }) => {
  await page.goto("/empresas");
  await expect(page).toHaveURL(/\/login\?next=%2Fempresas/);
  expect((await request.get("/api/companies")).status()).toBe(401);
  expect((await request.get("/api/docs")).status()).toBe(401);
  expect((await request.get("/api/dashboard")).status()).toBe(401);
});

test("login inválido mostra erro genérico", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill("ninguem@prospecta.local");
  await page.getByLabel("Senha", { exact: true }).fill("senha-errada-123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
});

test("cabeçalhos de segurança e webhook fechado para fora", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-content-type-options"]).toBe("nosniff");
  // o webhook do WhatsApp só é aceito pela rede interna dos containers
  const hook = await request.post("/api/webhooks/wuzapi", { data: { type: "Message" } });
  expect(hook.status()).toBeGreaterThanOrEqual(400);
});
