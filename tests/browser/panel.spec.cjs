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

test("el acceso por teclado incluye mostrar contraseña y saltar al contenido", async ({ page }) => {
  await expect(page.locator("#auth-password-toggle")).not.toHaveAttribute("tabindex", "-1");
  await expect(page.locator(".skip-link")).toHaveAttribute("href", "#main-content");
  await expect(page.locator("#main-content")).toHaveAttribute("tabindex", "-1");
});

test("abre el dashboard y conserva una única pestaña seleccionada", async ({ page }) => {
  await expect(page).toHaveTitle("Smart Panel");
  await expect(page.locator('[data-panel="inicio"]')).toBeVisible();
  await expect(page.locator('[role="tab"][aria-selected="true"]')).toHaveCount(1);
  await expect(page.locator("#frontend-version")).toHaveText("HTML v80");
});

test("respeta el tema del sistema y guarda el tema elegido", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(17, 17, 17)");
  await expect(page.locator(".clock-panel")).toHaveCSS("background-color", "rgb(25, 25, 25)");
  await expect(page.locator(".clock")).toHaveCSS("color", "rgb(247, 247, 248)");
  await expect(page.locator(".command-feedback")).toHaveCSS("background-color", "rgb(36, 36, 36)");
  await expect(page.locator(".camera-modal-backdrop")).toHaveCSS("background-color", "rgba(0, 0, 0, 0.82)");

  const toggle = page.locator("#theme-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.locator("#auth-gate").evaluate((element) => { element.hidden = true; });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("aria-label", "Cambiar a tema oscuro");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(255, 255, 255)");
  await expect(page.locator(".command-feedback")).toHaveCSS("background-color", "rgb(247, 247, 248)");
  await expect(page.locator(".camera-modal-backdrop")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.94)");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.locator("#auth-gate").evaluate((element) => { element.hidden = true; });

  await page.locator("#theme-toggle").click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("#theme-toggle")).toHaveAttribute("aria-label", "Cambiar a tema claro");
});

test("el encabezado y el control de tema caben en celular, tablet y escritorio", async ({ page }) => {
  for (const viewport of [
    { width: 320, height: 640 },
    { width: 390, height: 844 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.locator("#theme-toggle")).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow, `desborde horizontal a ${viewport.width}px`).toBe(false);
  }
});

test("las pestañas móviles conservan objetivos táctiles y se pueden desplazar", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const nav = page.locator(".tab-bar");
  const firstTab = page.locator('.tab-button[data-tab="inicio"]');
  const lastTab = page.locator('.tab-button[data-tab="estado"]');
  await expect(firstTab).toBeVisible();
  const firstBox = await firstTab.boundingBox();
  expect(firstBox.width).toBeGreaterThanOrEqual(44);
  const scrollable = await nav.evaluate((element) => element.scrollWidth > element.clientWidth);
  expect(scrollable).toBe(true);
  await lastTab.scrollIntoViewIfNeeded();
  await expect(lastTab).toBeInViewport();
});

test("la UI evita filtros de desenfoque en superficies pesadas", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator("#notif-toast-container").evaluate((container) => {
    const toast = document.createElement("div");
    toast.className = "notif-toast";
    container.appendChild(toast);
  });
  for (const selector of [".tab-bar", ".notif-toast", ".notif-panel", ".confirm-modal-backdrop"]) {
    await expect(page.locator(selector).first()).toHaveCSS("backdrop-filter", "none");
  }
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
