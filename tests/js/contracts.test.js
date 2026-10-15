const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("HTML contiene referencias locales existentes y no repite IDs", () => {
  const html = read("html/index.html");
  const ids = [...html.matchAll(/\bid=["']([^"']+)["']/g)].map((match) => match[1]);
  assert.ok(ids.includes("frontend-version"), "falta el indicador de versión del frontend");
  assert.match(html, /class="app-shell"/, "falta el shell principal de la UI");
  assert.match(html, /role="tablist"/, "falta la navegación por pestañas");
  assert.equal(new Set(ids).size, ids.length, "hay IDs HTML duplicados");

  const localAssets = [...html.matchAll(/(?:src|href)=["'](?!https?:|#|mailto:)([^"']+)["']/g)]
    .map((match) => match[1].split(/[?#]/)[0])
    .filter((asset) => asset && !asset.startsWith("data:"));
  for (const asset of localAssets) {
    assert.ok(fs.existsSync(path.join(root, "html", asset)), `no existe el recurso local ${asset}`);
  }
});

test("la política web mantiene CSP sin scripts inline y el build coincide", () => {
  const html = read("html/index.html");
  const policy = JSON.parse(read("vercel.json"));
  const csp = policy.headers.flatMap((entry) => entry.headers)
    .find((header) => header.key.toLowerCase() === "content-security-policy");
  assert.ok(csp, "falta Content-Security-Policy");
  assert.doesNotMatch(csp.value, /unsafe-inline/);
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i);

  const htmlVersion = html.match(/id="frontend-version">HTML v(\d+)</);
  const jsVersion = read("html/js/app.js").match(/APP_BUILD_VERSION\s*=\s*"(\d+)"/);
  assert.ok(htmlVersion && jsVersion, "no se pudo leer la versión de UI");
  assert.equal(htmlVersion[1], jsVersion[1], "la versión de HTML y JavaScript no coincide");
});

test("las reglas Firebase no habilitan escritura general a cualquier usuario", () => {
  const rules = JSON.parse(read("firebase_rules.json")).rules;
  assert.equal(rules.home.state[".write"], "auth != null && auth.token.role == 'device'");
  assert.equal(rules.home.commands[".read"], "auth != null && (auth.token.role == 'owner' || auth.token.role == 'device')");
  assert.equal(rules.scheduledReminders[".read"], false);
  assert.equal(rules.scheduledReminders[".write"], false);
});

test("el firmware conserva validaciones explícitas para órdenes TV y reloj", () => {
  const firmware = read("esp32_gateway/src/main.cpp");
  assert.match(firmware, /bool isValidTvCommand\(/);
  assert.match(firmware, /isCommandFresh\(/);
  assert.match(firmware, /NTP|time\(nullptr\)|time\(&/i);
  assert.match(firmware, /CMD_QUEUE_SIZE/);
});

test("la plataforma y bibliotecas PlatformIO están fijadas", () => {
  const platformio = read("esp32_gateway/platformio.ini");
  assert.match(platformio, /^platform = espressif32@\d+\.\d+\.\d+$/m);
  assert.match(platformio, /Firebase-ESP-Client\.git#[0-9a-f]{40}/);
  assert.match(platformio, /ArduinoJson @ \d+\.\d+\.\d+/);
  assert.match(platformio, /IRremoteESP8266 @ \d+\.\d+\.\d+/);
});

test("los secretos reales del firmware no están en la plantilla de CI", () => {
  const example = read("esp32_gateway/include/config.example.h");
  assert.match(example, /YOUR_WIFI_SSID/);
  assert.match(example, /REPLACE_WITH_A_UNIQUE_DEVICE_PASSWORD/);
  assert.doesNotMatch(example, /AIza[0-9A-Za-z_-]{30,}/);
});

test("la configuración Firebase se inyecta solo durante el despliegue", () => {
  const runtime = read("html/js/firebase-runtime-config.js");
  const firebaseConfig = read("html/js/firebase-config.js");
  const generator = read("scripts/generate-firebase-runtime-config.cjs");
  const worker = read("html/service-worker.js");
  assert.doesNotMatch(runtime, /AIza[0-9A-Za-z_-]{30,}|[A-Za-z0-9_-]{80,}/);
  assert.doesNotMatch(firebaseConfig, /AIza[0-9A-Za-z_-]{30,}|[A-Za-z0-9_-]{80,}/);
  assert.match(generator, /process\.env\.FIREBASE_WEB_API_KEY/);
  assert.match(generator, /process\.env\.FIREBASE_WEB_VAPID_KEY/);
  assert.doesNotMatch(worker, /AIza[0-9A-Za-z_-]{30,}/);
});
