import { expect, test as setup } from "@playwright/test";
import { readState } from "../lib.ts";

setup("primeiro acesso exige trocar a senha temporária", async ({ page }) => {
  const s = readState();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("E-mail").fill(s.email);
  await page.getByLabel("Senha", { exact: true }).fill(s.tempPassword);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).toHaveURL(/\/trocar-senha/);

  // com senha temporária, a API recusa as demais rotas
  const blocked = await page.request.get("/api/companies");
  expect(blocked.status()).toBe(403);
  expect((await blocked.json()).code).toBe("PASSWORD_CHANGE_REQUIRED");

  await page.getByLabel("Senha temporária").fill(s.tempPassword);
  await page.getByLabel("Nova senha", { exact: true }).fill(s.password);
  await page.getByLabel("Confirmar nova senha").fill(s.password);
  await page.getByRole("button", { name: "Salvar e continuar" }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole("heading", { name: /Olá, Teste/ })).toBeVisible();
  expect((await page.request.get("/api/companies")).status()).toBe(200);

  // primeiro acesso abre o tour guiado; aqui ele é adiado (o tour tem teste próprio)
  const welcome = page.getByRole("dialog", { name: /Boas-vindas ao Prospecta/ });
  await expect(welcome).toBeVisible();
  await welcome.getByRole("button", { name: "Agora não" }).click();
  await expect(welcome).toBeHidden();
  await page.context().storageState({ path: ".auth/user.json" });
});
