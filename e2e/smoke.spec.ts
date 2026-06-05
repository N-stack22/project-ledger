import { test, expect } from "@playwright/test";

test.describe("Smoke: rutas públicas", () => {
  test("la landing carga y muestra contenido", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/.+/);
    // El root layout debe renderizar algún contenido visible.
    const body = page.locator("body");
    await expect(body).not.toBeEmpty();
  });

  test("ruta de auth es accesible", async ({ page }) => {
    const response = await page.goto("/auth");
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator("body")).toBeVisible();
  });

  test("rutas protegidas redirigen sin sesión", async ({ page }) => {
    await page.goto("/app/dashboard");
    await page.waitForLoadState("networkidle");
    // Debería redirigir a /auth (o mostrar página de login)
    expect(page.url()).toMatch(/\/auth|\/login|\/$/);
  });
});
