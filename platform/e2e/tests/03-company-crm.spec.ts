import { expect, test } from "@playwright/test";
import { PREFIX } from "../lib.ts";

const name = `${PREFIX} Clínica Teste ${Date.now().toString().slice(-6)}`;

test.describe.configure({ mode: "serial" });

test("cadastra empresa, anota, cria tarefa e envia ao CRM", async ({ page }) => {
  await page.goto("/empresas");
  await page.getByRole("button", { name: "Nova empresa" }).click();
  await page.getByLabel("Nome comercial").fill(name);
  await page.getByLabel("E-mail comercial").fill("contato@e2e.example");
  await page.getByLabel("Cidade").fill("Campinas");
  await page.getByRole("button", { name: "Cadastrar" }).click();
  await expect(page).toHaveURL(/\/empresas\/[0-9a-f-]{36}/);
  await expect(page.getByRole("heading", { name })).toBeVisible();

  await page.getByRole("tab", { name: "Anotações" }).click();
  await page.getByLabel("Nova anotação").fill("Cliente prefere contato pela manhã.");
  await page.getByRole("button", { name: "Salvar anotação" }).click();
  await expect(page.getByText("Cliente prefere contato pela manhã.")).toBeVisible();

  await page.getByRole("tab", { name: "Tarefas" }).click();
  await page.getByLabel("Título da tarefa").fill("Ligar para apresentar a proposta");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await expect(page.getByText("Ligar para apresentar a proposta")).toBeVisible();

  await page.getByRole("tab", { name: "Visão geral" }).click();
  await page.getByRole("button", { name: "Adicionar ao CRM" }).click();
  await expect(page.getByText("Lead enviado ao CRM")).toBeVisible();
});

test("move a negociação entre etapas arrastando no kanban", async ({ page }) => {
  await page.goto("/crm");
  const from = page.getByRole("region", { name: "Etapa Novo lead" });
  const to = page.getByRole("region", { name: "Etapa Em qualificação" });
  // o nome é um link para a ficha; o cartão é arrastado pela área livre (rodapé do cartão)
  const card = from.locator('[aria-roledescription="sortable"]', { hasText: name });
  await expect(card).toBeVisible();

  const a = (await card.boundingBox())!;
  const b = (await to.boundingBox())!;
  const start = { x: a.x + a.width / 2, y: a.y + a.height - 12 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // o sensor só ativa após alguns pixels de movimento
  await page.mouse.move(start.x + 12, start.y, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + 80, { steps: 20 });
  await page.mouse.up();

  await expect(to.getByText(name)).toBeVisible();
  // persistiu no servidor
  await page.reload();
  await expect(page.getByRole("region", { name: "Etapa Em qualificação" }).getByText(name)).toBeVisible();
  await expect(page.getByRole("region", { name: "Etapa Novo lead" }).getByText(name)).toHaveCount(0);
});

test("a ficha registra a mudança de etapa na linha do tempo", async ({ page }) => {
  await page.goto("/empresas");
  await page.getByPlaceholder(/Nome, domínio, telefone/).fill(name);
  await page.getByRole("link", { name }).first().click();
  await page.getByRole("tab", { name: "Atividades" }).click();
  await expect(page.getByText(/Novo lead → Em qualificação/)).toBeVisible();
});
