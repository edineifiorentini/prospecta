import { expect, test } from "@playwright/test";

// usa o e-mail fictício criado no teste anterior (domínio .example, reservado para testes)
test("titular: localiza, exporta e exclui o e-mail de teste", async ({ page }) => {
  await page.goto("/configuracoes?tab=privacidade");
  await page.getByLabel("E-mail ou telefone do titular").fill("contato@e2e.example");
  await page.getByRole("button", { name: "Localizar dados" }).click();
  await expect(page.getByText(/registro\(s\) encontrados/)).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Exportar (JSON)" }).click();
  expect((await download).suggestedFilename()).toMatch(/^dados-titular-[0-9a-f]{8}\.json$/);

  await page.getByRole("button", { name: "Excluir dados" }).click();
  await page.getByLabel('Digite "EXCLUIR" para confirmar').fill("EXCLUIR");
  await page.getByRole("button", { name: "Excluir definitivamente" }).click();
  await expect(page.getByText("Dados excluídos")).toBeVisible();
  await expect(page.getByText("Nenhum dado associado a este identificador")).toBeVisible();
  // passa a constar no bloqueio de coleta
  await expect(page.getByRole("listitem").filter({ hasText: "excluído a pedido do titular" }).filter({ hasText: "contato@e2e.example" })).toBeVisible();
});
