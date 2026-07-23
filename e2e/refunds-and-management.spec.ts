import { expect, test } from "@playwright/test";

// E2E SOMENTE-LEITURA das telas novas de gestão. Não cria/estorna cobranças —
// o banco é compartilhado com produção; fluxos que escrevem ficam nos testes de
// integração herméticos (que criam o próprio tenant e limpam tudo).
const password = process.env.SEED_ADMIN_PASSWORD;

test.describe("Gestão: fila de estornos e fechamento por atendente", () => {
  test.beforeEach(async ({ page }) => {
    if (!password) throw new Error("SEED_ADMIN_PASSWORD é obrigatória");
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@bitpix.local");
    await page.locator("#password").fill(password);
    await page.getByRole("button", { name: "Entrar no BitPix" }).click();
    await expect(page).toHaveURL(/\/nova-venda/);
  });

  test("abre a fila de estornos pendentes", async ({ page }) => {
    await page.getByRole("link", { name: "Estornos", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Estornos pendentes" })).toBeVisible();
  });

  test("abre o relatório de fechamento por atendente", async ({ page }) => {
    await page.getByRole("link", { name: "Relatórios" }).click();
    await expect(page.getByRole("heading", { name: "Relatórios" })).toBeVisible();
    await page.getByRole("link", { name: "Fechamento", exact: true }).click();
    await expect(page).toHaveURL(/type=closing/);
  });

  test("dashboard mostra o filtro por atendente", async ({ page }) => {
    await page.getByRole("link", { name: "Dashboard" }).click();
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByText("Atendente", { exact: false })).toBeVisible();
  });
});
