import { readFileSync, statSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { readState } from "../lib.ts";

test("painel mostra indicadores e aplica o período", async ({ page }) => {
  await page.goto("/dashboard");
  for (const kpi of ["Novos leads", "Leads qualificados", "Contatos realizados", "Negociações abertas", "Conversão", "Tarefas pendentes"]) {
    await expect(page.getByText(kpi, { exact: true }).first()).toBeVisible();
  }
  await page.getByRole("radio", { name: "7 dias" }).click();
  await expect(page).toHaveURL(/p=7d/);
  await expect(page.getByText("Evolução no período")).toBeVisible();
});

test("exporta o resumo em CSV pelo painel", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Exportar" }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("menuitem", { name: /Resumo de indicadores \(CSV\)/ }).click();
  expect((await download).suggestedFilename()).toMatch(/^resumo-indicadores-\d{4}-\d{2}-\d{2}\.csv$/);
});

test("relatórios: negociações em CSV e resumo em PDF", async ({ page }) => {
  await page.goto("/relatorios");
  await expect(page.getByRole("heading", { name: "Relatórios" })).toBeVisible();
  const csv = page.waitForEvent("download");
  await page.locator("div.card-soft", { hasText: "Todas as negociações" }).getByRole("button", { name: "CSV" }).click();
  expect((await csv).suggestedFilename()).toMatch(/^negociacoes-.*\.csv$/);

  // o PDF usa o Chromium do container da API
  test.skip(readState().mode !== "docker", "PDF só é gerado na pilha Docker");
  const pdf = page.waitForEvent("download", { timeout: 60_000 });
  await page.locator("div.card-soft", { hasText: "Leads, funil, contatos" }).getByRole("button", { name: "PDF" }).click();
  const file = await pdf;
  expect(file.suggestedFilename()).toMatch(/\.pdf$/);
  const path = (await file.path())!;
  expect(statSync(path).size).toBeGreaterThan(5_000);
  expect(readFileSync(path).subarray(0, 5).toString()).toBe("%PDF-");
});
