import { expect, test } from "@playwright/test";

test.use({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true });

for (const path of ["/dashboard", "/empresas", "/buscar", "/crm", "/tarefas", "/relatorios", "/conversas", "/configuracoes"]) {
  test(`sem rolagem horizontal em ${path} (375 px)`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    const { sw, cw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    expect(sw).toBeLessThanOrEqual(cw);
  });
}
