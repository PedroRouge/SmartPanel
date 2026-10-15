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

test("el sistema de iconos PWA tiene fallbacks, tamaños y propósito seguros", () => {
  const html = read("html/index.html");
  const manifest = JSON.parse(read("html/manifest.webmanifest"));
  assert.match(html, /rel="icon"[^>]*href="\/icons\/favicon\.ico"/);
  assert.match(html, /type="image\/svg\+xml"[^>]*media="\(prefers-color-scheme: dark\)"/);
  assert.match(html, /rel="apple-touch-icon"[^>]*sizes="180x180"[^>]*href="\/icons\/apple-touch-icon\.png"/);
  assert.match(html, /rel="manifest"[^>]*href="\/manifest\.webmanifest"/);
  assert.match(html, /rel="mask-icon"[^>]*href="\/icons\/app-icon-mask\.svg"/);
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/icon-maskable.png" && icon.purpose === "maskable"));

  for (const icon of manifest.icons) {
    assert.ok(fs.existsSync(path.join(root, "html", icon.src.slice(1))), `no existe el icono declarado ${icon.src}`);
  }
  for (const [file, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["icon-maskable.png", 512], ["icon-512-dark.png", 512], ["apple-touch-icon.png", 180]]) {
    const png = fs.readFileSync(path.join(root, "html/icons", file));
    assert.equal(png.readUInt32BE(0), 0x89504e47, `${file} no es PNG`);
    assert.equal(png.readUInt32BE(16), size, `${file} tiene ancho incorrecto`);
    assert.equal(png.readUInt32BE(20), size, `${file} tiene alto incorrecto`);
  }
  const ico = fs.readFileSync(path.join(root, "html/icons/favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  assert.deepEqual([ico[6], ico[22], ico[38]], [16, 32, 48]);
  const worker = read("html/service-worker.js");
  for (const file of ["icon-192.png", "icon-512.png", "icon-maskable.png", "apple-touch-icon.png", "favicon.ico", "favicon-32.png", "app-icon-light.svg", "app-icon-dark.svg", "app-icon-mask.svg"]) {
    assert.ok(worker.includes(`/icons/${file}`), `el service worker no precarga ${file}`);
  }
  assert.match(read("html/icons/app-icon-maskable.svg"), /translate\(10 5\.5\) scale\(\.8\)/);

  const svgs = [...html.matchAll(/<svg\b([^>]*)>/gi)].map((match) => match[1]);
  assert.ok(svgs.length > 0);
  for (const attrs of svgs) {
    assert.match(attrs, /\bviewBox="0 0 24 24"/i);
    assert.match(attrs, /\bwidth="24"/i);
    assert.match(attrs, /\bheight="24"/i);
    assert.match(attrs, /\baria-hidden="true"/i);
  }
  assert.match(read("html/js/app.js"), /setAttribute\("width", "24"\)/);
  assert.match(read("html/js/app.js"), /setAttribute\("height", "24"\)/);
  assert.match(read("html/js/app.js"), /button\.querySelector\("\.push-enable-label"\)/);
  assert.match(read("html/css/swiss-ui.css"), /stroke:\s*currentColor/);
  assert.match(read("html/css/swiss-ui.css"), /--icon-stroke-width:\s*1\.8/);
  assert.doesNotMatch(read("html/css/styles.css"), /data:image\/svg\+xml/);
  assert.doesNotMatch(read("html/js/app.js"), /textContent\s*=\s*["']✎/);
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

test("el bootstrap no borra la caché activa y el tema se precarga", () => {
  const html = read("html/index.html");
  const bootstrap = read("html/js/bootstrap.js");
  const worker = read("html/service-worker.js");
  const themeScriptIndex = html.indexOf('src="js/theme-init.js');
  const stylesheetIndex = html.indexOf('href="css/styles.css');

  assert.doesNotMatch(bootstrap, /caches\.delete\s*\(/);
  assert.match(worker, /self\.addEventListener\("activate"/);
  assert.match(worker, /key !== CACHE_NAME/);
  assert.ok(themeScriptIndex >= 0 && themeScriptIndex < stylesheetIndex, "el tema debe aplicarse antes del CSS");
  assert.match(worker, /\/js\/theme-init\.js\?v=\d+/);
});

test("el canvas de arquitectura tiene IDs y enlaces internos válidos", () => {
  const vault = path.join(root, "obsidian-vault");
  const canvas = JSON.parse(read("obsidian-vault/Smart-Panel-Architecture.canvas"));
  const nodeIds = canvas.nodes.map((node) => node.id);
  const allIds = [...nodeIds, ...canvas.edges.map((edge) => edge.id)];
  assert.equal(new Set(allIds).size, allIds.length, "hay IDs duplicados en el canvas");
  for (const node of canvas.nodes) {
    assert.ok(["file", "text", "link", "group"].includes(node.type));
    if (node.type === "file") {
      assert.ok(fs.existsSync(path.join(vault, node.file)), `no existe el archivo Obsidian ${node.file}`);
    }
  }
  for (const edge of canvas.edges) {
    assert.ok(nodeIds.includes(edge.fromNode), `origen inexistente ${edge.fromNode}`);
    assert.ok(nodeIds.includes(edge.toNode), `destino inexistente ${edge.toNode}`);
  }
});

test("CI fija el sistema operativo del runner para evitar cambios automáticos", () => {
  const workflow = read(".github/workflows/ci-cd.yml");
  assert.doesNotMatch(workflow, /runs-on:\s*ubuntu-latest/);
  assert.match(workflow, /runs-on:\s*ubuntu-24\.04/);
});

test("las reglas Firebase no habilitan escritura general a cualquier usuario", () => {
  const rules = JSON.parse(read("firebase_rules.json")).rules;
  assert.equal(rules.home.state[".write"], undefined);
  assert.equal(rules.home.state.gateStatus[".write"], "auth != null && auth.token.role == 'device'");
  assert.equal(rules.home.state.lights.$light[".write"], "auth != null && auth.token.role == 'device'");
  assert.equal(rules.home.state[".read"], "auth != null && auth.token.role == 'admin'");
  assert.equal(rules.home.commands.timestamp[".write"], "auth != null && auth.token.role == 'admin'");
  assert.equal(rules.home.commands[".read"], "auth != null && (auth.token.role == 'admin' || auth.token.role == 'device')");
  assert.equal(rules.home.gateway.status.$other[".validate"], false);
  assert.equal(rules.scheduledReminders[".read"], false);
  assert.equal(rules.scheduledReminders[".write"], false);
});

test("el firmware conserva validaciones explícitas para órdenes TV y reloj", () => {
  const firmware = read("esp32_gateway/src/main.cpp");
  assert.match(firmware, /bool isValidTvCommand\(/);
  assert.match(firmware, /isCommandFresh\(/);
  assert.match(firmware, /isPrivateLanUrl\(/);
  assert.match(firmware, /first == 10/);
  assert.match(firmware, /second >= 16 && second <= 31/);
  assert.match(firmware, /first == 192 && second == 168/);
  assert.match(firmware, /NTP|time\(nullptr\)|time\(&/i);
  assert.match(firmware, /CMD_QUEUE_SIZE/);
  assert.match(firmware, /commandReceipts\/" \+ receiptKey/);
  assert.doesNotMatch(firmware, /irsend|sendSAMSUNG|IRremote/i);
});

test("la plataforma y bibliotecas PlatformIO están fijadas", () => {
  const platformio = read("esp32_gateway/platformio.ini");
  const board = JSON.parse(read("esp32_gateway/boards/esp32-s3-devkitc-1-n16r8.json"));
  assert.match(platformio, /default_envs = esp32-s3-devkitc-1-n16r8/);
  assert.match(platformio, /board_build\.arduino\.memory_type = qio_opi/);
  assert.match(platformio, /-D BOARD_HAS_PSRAM/);
  assert.equal(board.upload.flash_size, "16MB");
  assert.match(board.name, /N16R8.*8 MB OPI PSRAM/);
  assert.match(platformio, /^platform = espressif32@\d+\.\d+\.\d+$/m);
  assert.match(platformio, /Firebase-ESP-Client\.git#[0-9a-f]{40}/);
  assert.match(platformio, /ArduinoJson @ \d+\.\d+\.\d+/);
  assert.doesNotMatch(platformio, /IRremoteESP8266/);
  assert.match(read("esp32_gateway/huge_app.csv"), /app0,\s+app,\s+ota_0,\s+0x10000,\s+0x300000/);
});

test("los secretos reales del firmware no están en la plantilla de CI", () => {
  const example = read("esp32_gateway/include/config.example.h");
  const sharedConfig = read("esp32_gateway/include/config.h");
  const gitignore = read(".gitignore");
  const initialData = read("firebase_initial_data.json");
  const app = read("html/js/app.js");
  assert.match(example, /YOUR_WIFI_SSID/);
  assert.match(example, /REPLACE_WITH_A_UNIQUE_DEVICE_PASSWORD/);
  assert.doesNotMatch(example, /AIza[0-9A-Za-z_-]{30,}/);
  assert.doesNotMatch(sharedConfig, /192\.168\./);
  assert.doesNotMatch(initialData, /192\.168\./);
  assert.doesNotMatch(app, /ip:\s*"192\.168\./);
  assert.match(gitignore, /esp32_gateway\/include\/config\.local\.h/);
});

test("la configuración Firebase se inyecta solo durante el despliegue", () => {
  const runtime = read("html/js/firebase-runtime-config.js");
  const firebaseConfig = read("html/js/firebase-config.js");
  const generator = read("scripts/generate-firebase-runtime-config.cjs");
  const worker = read("html/service-worker.js");
  assert.match(runtime, /apiKey:\s*"AIza[0-9A-Za-z_-]{30,}"/);
  assert.match(runtime, /vapidKey:\s*"[A-Za-z0-9_-]{80,}"/);
  assert.doesNotMatch(runtime + firebaseConfig + worker, /FIREBASE_USER_PASSWORD|WIFI_PASSWORD|-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  assert.match(generator, /process\.env\.FIREBASE_WEB_API_KEY/);
  assert.match(generator, /process\.env\.FIREBASE_WEB_VAPID_KEY/);
  assert.doesNotMatch(worker, /AIza[0-9A-Za-z_-]{30,}/);
});

test("login valida el claim admin, autocompleta y persiste localmente", () => {
  const html = read("html/index.html");
  const app = read("html/js/app.js");
  assert.match(html, /id="auth-form" autocomplete="on"/);
  assert.match(html, /id="auth-username"[^>]*autocomplete="username"/);
  assert.match(html, /id="auth-password"[^>]*autocomplete="current-password"/);
  assert.match(app, /auth\.setPersistence\(firebase\.auth\.Auth\.Persistence\.LOCAL\)/);
  assert.match(app, /tokenResult\.claims\.role !== "admin"/);
  assert.match(app, /getIdTokenResult\(true\)/);
  assert.doesNotMatch(app, /OWNER_EMAIL/);
  assert.doesNotMatch(app, /input\.value\s*=\s*""/);
});
