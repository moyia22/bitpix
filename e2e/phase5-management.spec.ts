import { expect, test } from "@playwright/test";
const password = process.env.SEED_ADMIN_PASSWORD;
test.describe("Fase 5 — jornada administrativa", () => {
  test.beforeEach(async ({ page }) => {
    if (!password) throw new Error("SEED_ADMIN_PASSWORD é obrigatória");
    await page.goto("/login"); await page.getByLabel("E-mail").fill(process.env.SEED_ADMIN_EMAIL ?? "admin@bitpix.local"); await page.locator("#password").fill(password); await page.getByRole("button", { name: "Entrar no BitPix" }).click(); await expect(page).toHaveURL(/\/nova-venda/);
  });
  test("dashboard, relatórios, gestão, cupom, auditoria e tema", async ({ page }) => {
    await page.getByRole("link", { name: "Dashboard" }).click(); await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible(); await expect(page.getByText("Total recebido")).toBeVisible();
    await page.getByRole("link", { name: "Relatórios" }).click(); await expect(page.getByRole("heading", { name: "Relatórios" })).toBeVisible(); await page.getByRole("button", { name: "Aplicar filtros" }).click(); await expect(page).toHaveURL(/type=sales/);
    await page.getByRole("link", { name: "Usuários" }).click(); await expect(page.getByRole("heading", { name: "Usuários" })).toBeVisible(); await expect(page.getByRole("button", { name: "Novo usuário" })).toBeVisible();
    await page.getByRole("link", { name: "Filiais" }).click(); await expect(page.getByRole("heading", { name: "Filiais" })).toBeVisible(); await expect(page.getByRole("button", { name: "Nova filial" })).toBeVisible();
    await page.getByRole("link", { name: "Configurações" }).click(); await page.getByRole("link", { name: /Impressão/ }).click(); await expect(page.getByRole("heading", { name: "Impressão" })).toBeVisible(); await expect(page.getByRole("button", { name: "Salvar modelo" })).toBeVisible();
    await page.getByRole("link", { name: "Auditoria" }).click(); await expect(page.getByRole("heading", { name: "Auditoria" })).toBeVisible();
    const theme = page.getByRole("button", { name: "Ativar tema escuro" }); await theme.click(); await expect(page.locator("html")).toHaveClass(/dark/);
  });
  test("layout administrativo responde em viewport móvel", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/dashboard"); await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible(); await expect(page.getByRole("button", { name: "Abrir menu" })).toBeVisible(); await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll");
  });
});
