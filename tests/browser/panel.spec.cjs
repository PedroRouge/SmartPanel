const { test, expect } = require("@playwright/test");

test.beforeEach(async ({ page }) => {
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.goto("/");
});

test("sin sesión, el formulario de autenticación está visible", async ({ page }) => {
  await expect(page.locator("#auth-gate")).toBeVisible();
  await expect(page.locator("#auth-form")).toBeVisible();
  await expect(page.locator("#auth-username")).toHaveValue("");
  await expect(page.locator("#auth-password")).toHaveValue("");
  await expect(page.locator("#auth-form")).toHaveAttribute("autocomplete", "on");
  await expect(page.locator("#auth-password")).toHaveAttribute("autocomplete", "current-password");
  await expect.poll(() => page.evaluate(() => window.SMART_PANEL_FIREBASE_CONFIG?.apiKey || ""))
    .toMatch(/^AIza[0-9A-Za-z_-]{30,}$/);
  await expect(page.locator("#auth-error")).toBeHidden();
});

test("abre el dashboard y conserva una única pestaña seleccionada", async ({ page }) => {
  await expect(page).toHaveTitle("Smart Panel");
  await expect(page.locator('[data-panel="inicio"]')).toBeVisible();
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  await expect(page.locator("#frontend-version")).toHaveText("HTML v75");
});

test("cambia de sección con clic y muestra el panel correspondiente", async ({ page }) => {
  // En esta prueba aislamos navegación después de autenticar: la API real no participa.
  await page.locator("#auth-gate").evaluate((element) => { element.hidden = true; });
  await page.locator('[role="tab"][data-tab="agenda"]').click();
  await expect(page.locator('[role="tab"][data-tab="agenda"]')).toHaveAttribute("aria-selected", "true");
  await expect(page.locator('[data-panel="agenda"]')).toBeVisible();
  await expect(page.locator('[data-panel="inicio"]')).toBeHidden();

  await page.locator('[role="tab"][data-tab="multimedia"]').click();
  await expect(page.locator('[data-panel="multimedia"]')).toBeVisible();
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
});

test("la navegación por teclado avanza entre pestañas", async ({ page }) => {
  await page.locator("#auth-gate").evaluate((element) => { element.hidden = true; });
  const agenda = page.locator('[role="tab"][data-tab="agenda"]');
  await agenda.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator('[role="tab"][data-tab="multimedia"]')).toBeFocused();
  await expect(page.locator('[data-panel="multimedia"]')).toBeVisible();
});
