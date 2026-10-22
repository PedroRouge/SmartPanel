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
  await expect(page.locator("#frontend-version")).toHaveText(/^HTML v\d+$/);
  const jsVersion = await page.locator("#script-build-version").textContent();
  expect(jsVersion).toMatch(/^JS v\d+$/);
  expect(jsVersion.replace("JS v", "")).toBe((await page.locator("#frontend-version").textContent()).replace("HTML v", ""));
});

test("el slider de TV usa niveles enteros de volumen 0 a 25", async ({ page }) => {
  const slider = page.locator("#volume-slider");
  await expect(slider).toHaveAttribute("min", "0");
  await expect(slider).toHaveAttribute("max", "25");
  await expect(slider).toHaveAttribute("step", "1");
  await expect(slider).toHaveAttribute("aria-label", "Volumen del televisor, de 0 a 25");
});

test("respeta el tema del sistema y guarda el tema elegido", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(10, 14, 26)");
  await expect(page.locator(".clock-panel")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.055)");
  await expect(page.locator(".clock")).toHaveCSS("color", "rgb(243, 245, 250)");
  await expect(page.locator(".command-feedback")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.1)");
  await expect(page.locator(".camera-modal-backdrop")).toHaveCSS("background-color", "rgba(4, 8, 17, 0.72)");

  const toggle = page.locator("#theme-toggle");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await page.locator("#auth-gate").evaluate((element) => { element.hidden = true; });
  await toggle.click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect(toggle).toHaveAttribute("aria-label", "Cambiar a tema oscuro");
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(237, 242, 249)");
  await expect(page.locator(".command-feedback")).toHaveCSS("background-color", "rgba(255, 255, 255, 0.94)");
  await expect(page.locator(".camera-modal-backdrop")).toHaveCSS("background-color", "rgba(15, 24, 40, 0.42)");
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

test("las siete pestañas móviles caben, son táctiles y cambian de sección", async ({ page }) => {
  await page.locator("#auth-gate").evaluate((element) => { element.hidden = true; });
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const nav = page.locator(".tab-bar");
    const tabs = page.locator(".tab-button");
    await expect(tabs).toHaveCount(7);

    const navBox = await nav.boundingBox();
    for (let index = 0; index < await tabs.count(); index += 1) {
      const box = await tabs.nth(index).boundingBox();
      expect(box.width, `pestaña ${index} en ${width}px`).toBeGreaterThanOrEqual(44);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y + box.height).toBeGreaterThan(navBox.y);
    }
    const overflows = await nav.evaluate((element) => element.scrollWidth > element.clientWidth + 1);
    expect(overflows, `la barra no debe esconder pestañas a ${width}px`).toBe(false);

    for (const [tab, panel] of [
      ["hogar", "panel-hogar"], ["multimedia", "panel-multimedia"], ["pileta", "panel-pileta"],
      ["camaras", "panel-camaras"], ["estado", "panel-estado"],
    ]) {
      await page.locator(`.tab-button[data-tab="${tab}"]`).click();
      await expect(page.locator(`#${panel}`)).toBeVisible();
    }
  }
});

test("la navegación completa queda visible en sidebar de escritorio y fila de tablet", async ({ page }) => {
  await page.locator("#auth-gate").evaluate((element) => { element.hidden = true; });
  for (const [width, direction] of [[768, "row"], [1280, "column"]]) {
    await page.setViewportSize({ width, height: 900 });
    const nav = page.locator(".tab-bar");
    await expect(nav).toBeVisible();
    await expect(nav.locator(".tab-button")).toHaveCount(7);
    await expect(nav).toHaveCSS("flex-direction", direction);
    for (let index = 0; index < await nav.locator(".tab-button").count(); index += 1) {
      const box = await nav.locator(".tab-button").nth(index).boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(900);
    }
  }
});

test("los iconos inline usan currentColor y los controles de icono son táctiles", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const icons = page.locator('svg[viewBox="0 0 24 24"]');
  expect(await icons.count()).toBeGreaterThan(0);
  for (let index = 0; index < await icons.count(); index += 1) {
    const icon = icons.nth(index);
    await expect(icon).toHaveAttribute("width", "24");
    await expect(icon).toHaveAttribute("height", "24");
    await expect(icon).toHaveAttribute("aria-hidden", "true");
  }

  await expect(page.locator("#weather-refresh")).toHaveAttribute("title", "Actualizar clima");
  for (const selector of ["#theme-toggle", "#notif-bell", "#weather-refresh"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box.width, `${selector}: ancho táctil`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${selector}: alto táctil`).toBeGreaterThanOrEqual(44);
  }

  const colorsFollowTheme = await page.locator(".ui-icon").first().evaluate((icon) => {
    const computed = getComputedStyle(icon);
    return computed.stroke === computed.color;
  });
  expect(colorsFollowTheme).toBe(true);

  const unlabeledIconButtons = await page.locator("button").evaluateAll((buttons) => buttons
    .filter((button) => button.querySelector("svg") && !button.textContent.trim())
    .filter((button) => !button.getAttribute("aria-label") || !button.title)
    .map((button) => button.id || button.className));
  expect(unlabeledIconButtons).toEqual([]);
});

test("un iPad en horizontal conserva áreas táctiles de 44px", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.route(/^https:\/\//, (route) => route.abort());
  await page.goto("/");
  for (const selector of ["#theme-toggle", "#notif-bell", "#weather-refresh"]) {
    const box = await page.locator(selector).boundingBox();
    expect(box.width, `${selector}: ancho táctil iPad`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${selector}: alto táctil iPad`).toBeGreaterThanOrEqual(44);
  }
  await context.close();
});

test("el manifest y los fallbacks PWA sirven todos los iconos declarados", async ({ page }) => {
  const manifestResponse = await page.request.get("/manifest.json");
  expect(manifestResponse.ok()).toBe(true);
  const manifest = await manifestResponse.json();
  for (const icon of manifest.icons) {
    const response = await page.request.get(icon.src);
    expect(response.ok(), icon.src).toBe(true);
    expect(response.headers()["content-type"]).toContain("image/png");
  }
  for (const path of ["/icons/favicon.ico", "/icons/favicon-32.png", "/icons/apple-touch-icon.png", "/icons/icon-512.png"]) {
    const response = await page.request.get(path);
    expect(response.ok(), path).toBe(true);
  }
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
