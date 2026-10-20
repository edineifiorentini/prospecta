import { expect, test } from "@playwright/test";

test("roteiro de primeiros passos mostra o andamento real", async ({ page }) => {
  await page.goto("/primeiros-passos");
  await expect(page.getByRole("heading", { name: "Primeiros passos" })).toBeVisible();
  await expect(page.getByText(/de 8 passos essenciais concluídos/)).toBeVisible();
  await expect(page.getByRole("button", { name: /Encontre as primeiras empresas/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retomar tour" })).toHaveCount(0);
});

test("tour guiado percorre as telas, pausa com Esc e pode ser retomado", async ({ page }) => {
  await page.goto("/primeiros-passos");
  await page.getByRole("button", { name: /tour guiado/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Boas-vindas ao Prospecta");
  await dialog.getByRole("button", { name: "Começar tour" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await expect(dialog).toContainText("Passo 1 de 14");
  await expect(dialog).toContainText("Menu principal");

  await page.keyboard.press("ArrowRight");
  await expect(dialog).toContainText("Busca global");
  for (let i = 0; i < 3; i++) await dialog.getByRole("button", { name: "Próximo" }).click();
  await expect(page).toHaveURL(/\/buscar/);
  await expect(dialog).toContainText("Encontrar empresas");

  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await page.reload();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.goto("/primeiros-passos");
  await page.getByRole("button", { name: "Retomar tour" }).click();
  await expect(page).toHaveURL(/\/buscar/);
  await expect(page.getByRole("dialog")).toContainText("Passo 5 de 14");
  await page.getByRole("dialog").getByRole("button", { name: "Sair do tour" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("cartão do painel pode ser ocultado", async ({ page }) => {
  await page.goto("/dashboard");
  const card = page.getByRole("region", { name: /Primeiros passos ·/ });
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "Ocultar primeiros passos do painel" }).click();
  await expect(card).toBeHidden();
  await page.reload();
  await expect(page.getByRole("heading", { name: /Olá, Teste/ })).toBeVisible();
  await expect(page.getByRole("region", { name: /Primeiros passos ·/ })).toHaveCount(0);
});
