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
  const manifest = JSON.parse(read("html/manifest.json"));
  assert.match(html, /rel="icon"[^>]*href="\/icons\/favicon\.ico"/);
  assert.match(html, /name="theme-color" content="#0a0e1a"/);
  assert.match(html, /rel="apple-touch-icon"[^>]*sizes="180x180"[^>]*href="\/icons\/apple-touch-icon\.png"/);
  assert.match(html, /rel="manifest"[^>]*href="\/manifest\.json"/);
  assert.ok(manifest.icons.some((icon) => icon.sizes === "192x192" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.sizes === "512x512" && icon.purpose === "any"));
  assert.ok(manifest.icons.some((icon) => icon.src === "/icons/icon-maskable.png" && icon.purpose === "any maskable"));
  assert.equal(manifest.theme_color, "#0a0e1a");

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
  for (const file of ["icon-192.png", "icon-512.png", "icon-maskable.png", "apple-touch-icon.png", "favicon.ico", "favicon-32.png"]) {
    assert.ok(worker.includes(`/icons/${file}`), `el service worker no precarga ${file}`);
  }
  const sourceMark = read("html/icons/smart-panel-mark.svg");
  assert.match(sourceMark, /<svg\b[^>]*viewBox="0 0 512 512"/);
  assert.match(read("scripts/generate_pwa_icons.cjs"), /smart-panel-mark\.svg/);

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
  assert.match(csp.value, /script-src[^;]*https:\/\/apis\.google\.com/);
  assert.match(csp.value, /frame-src[^;]*https:\/\/smart-panel-53d7b\.firebaseapp\.com/);
  assert.match(csp.value, /connect-src[^;]*https:\/\/smart-panel-53d7b\.firebaseapp\.com[^;]*https:\/\/apis\.google\.com/);
  for (const origin of ["https://smart-panel-53d7b.firebaseapp.com", "https://apis.google.com", "https://api.open-meteo.com", "https://date.nager.at"]) {
    assert.match(html, new RegExp(`<link rel="preconnect" href="${origin.replaceAll(".", "\\.")}" crossorigin>`));
  }
  assert.doesNotMatch(html, /<script\b(?![^>]*\bsrc=)[^>]*>[\s\S]*?<\/script>/i);
  assert.doesNotMatch(html.match(/<meta name="viewport"[^>]*>/i)?.[0] || "", /user-scalable=no|maximum-scale\s*=\s*1/i);
  const headers = policy.headers.flatMap((entry) => entry.headers);
  assert.equal(headers.find((header) => header.key === "Permissions-Policy")?.value, "camera=(), microphone=(), geolocation=()");
  assert.equal(headers.find((header) => header.key === "X-Content-Type-Options")?.value, "nosniff");
  assert.equal(headers.find((header) => header.key === "Referrer-Policy")?.value, "strict-origin-when-cross-origin");

  const htmlVersion = html.match(/id="frontend-version">HTML v(\d+)</);
  const jsVersion = read("html/js/app.js").match(/APP_BUILD_VERSION\s*=\s*"(\d+)"/);
  assert.ok(htmlVersion && jsVersion, "no se pudo leer la versión de UI");
  assert.equal(htmlVersion[1], jsVersion[1], "la versión de HTML y JavaScript no coincide");
  const serviceWorker = read("html/service-worker.js");
  assert.match(serviceWorker, /CACHE_PREFIX \+ "90"/);
  assert.match(serviceWorker, /\/js\/app\.js\?v=89/);
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
  assert.match(worker, /"\/icons\/favicon-48\.png"/);
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

test("el despliegue gratuito publica reglas Firebase sin Cloud Functions", () => {
  const workflow = read(".github/workflows/ci-cd.yml");
  const databaseDeploy = workflow.indexOf("deploy --only database --project smart-panel-53d7b");
  assert.ok(databaseDeploy >= 0, "falta el despliegue de reglas RTDB");
  assert.doesNotMatch(workflow, /deploy --only functions|functions\/package-lock/);
  assert.equal(JSON.parse(read("firebase.json")).functions, undefined, "Firebase CLI no debe intentar publicar Cloud Functions");
});

test("el worker gratuito de Apps Script se ejecuta cada cinco minutos y usa credencial de servicio", () => {
  const source = read("scripts/free-push/Code.gs");
  const manifest = JSON.parse(read("scripts/free-push/appsscript.json"));
  assert.match(source, /everyMinutes\(5\)/);
  assert.match(source, /FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY/);
  assert.match(source, /firebase\.messaging/);
  assert.equal(manifest.timeZone, "America/Argentina/Buenos_Aires");
  assert.doesNotMatch(source, /firebase-functions|firebase-admin/);
});

test("las reglas Firebase no habilitan escritura general a cualquier usuario", () => {
  const rules = JSON.parse(read("firebase_rules.json")).rules;
  assert.equal(rules.home.state[".write"], undefined);
  assert.equal(rules.home.state.gateStatus[".write"], "auth != null && auth.token.role == 'device'");
  assert.equal(rules.home.state.lights.$light[".write"], "auth != null && auth.token.role == 'device'");
  assert.equal(rules.home.state[".read"], "auth != null && auth.token.role == 'admin'");
  assert.match(rules.home.state.tvPower.$tvId[".write"], /auth\.token\.role == 'device'/);
  assert.equal(rules.home.state.tvPower.$tvId.$other[".validate"], false);
  assert.equal(rules.home.commands.timestamp[".write"], "auth != null && auth.token.role == 'admin'");
  assert.equal(rules.home.commands[".read"], "auth != null && (auth.token.role == 'admin' || auth.token.role == 'device')");
  assert.match(rules.home.commands.tv[".validate"], /child\('value'\)\.val\(\) <= 25/);
  assert.equal(rules.home.gateway.status.$other[".validate"], false);
  assert.equal(rules.scheduledReminders, undefined, "no se conserva una cola usada solo por Cloud Functions");
});

test("el firmware conserva validaciones explícitas para órdenes TV y reloj", () => {
  const firmware = read("esp32_gateway/src/main.cpp");
  const worker = firmware.slice(firmware.indexOf("void workerTask("), firmware.indexOf("// VALIDACIÓN TTL"));
  assert.match(firmware, /bool isValidTvCommand\(/);
  assert.match(firmware, /isCommandFresh\(/);
  assert.match(firmware, /isPrivateLanUrl\(/);
  assert.match(firmware, /client\.connect\(remoteIp, 6466, tlsHostname, serverCertPem, certPem, keyPem\)/);
  assert.doesNotMatch(firmware, /client\.setInsecure\(\)/);
  assert.match(firmware, /serverCertPem/);
  assert.match(firmware, /first == 10/);
  assert.match(firmware, /second >= 16 && second <= 31/);
  assert.match(firmware, /first == 192 && second == 168/);
  assert.match(firmware, /NTP|time\(nullptr\)|time\(&/i);
  assert.match(firmware, /CMD_QUEUE_SIZE/);
  assert.match(firmware, /commandReceipts\/" \+ receiptKey/);
  assert.match(firmware, /path == "\/tv" \|\| path == "\/"/);
  assert.match(firmware, /rootJson\.get\(tvData, "tv"\)/);
  assert.match(firmware, /cmd\.type == CMD_TV && cmd\.timestamp > 0[\s\S]*?publishTvCommandResult/);
  assert.match(worker, /receiptData\.httpCode\(\) != FIREBASE_ERROR_HTTP_CODE_NOT_FOUND/);
  assert.match(worker, /receiptData\.httpCode\(\) != FIREBASE_ERROR_PATH_NOT_EXIST/);
  assert.match(worker, /if \(!receiptFound &&[\s\S]*?publishTvCommandResult/);
  assert.match(worker, /if \(!Firebase\.RTDB\.setDouble\(&fbdo, receiptPath\.c_str\(\), \(double\)cmd\.timestamp\)\) \{[\s\S]*?publishTvCommandResult/);
  assert.doesNotMatch(firmware, /irsend|sendSAMSUNG|IRremote/i);
});

test("el control Android TV completa el handshake antes de transmitir teclas", () => {
  const firmware = read("esp32_gateway/src/main.cpp");
  const remoteCommandStart = firmware.indexOf(
    "bool executeAndroidTvRemoteUnlocked(const char* host",
    firmware.indexOf("bool readAndroidTvFrame("),
  );
  const remoteCommand = firmware.slice(
    remoteCommandStart,
    firmware.indexOf("bool handleTvCommand(", remoteCommandStart),
  );

  assert.match(firmware, /bool readAndroidTvFrame\(/);
  assert.match(firmware, /bool sendAndroidTvSetActivePacket\(/);
  assert.ok(
    remoteCommand.indexOf("findProtoBytesField(rxBuf, rxLen, 40") <
      remoteCommand.indexOf("sendAndroidTvKeyPacket(client, keyCode)"),
    "no se debe transmitir la tecla antes de que la TV confirme remote_start",
  );
  assert.ok(
    remoteCommand.indexOf("sendAndroidTvSetActivePacket(client, activeFeatures)") <
      remoteCommand.indexOf("sendAndroidTvKeyPacket(client, keyCode)"),
    "se debe responder remote_set_active antes de transmitir la tecla",
  );
  assert.doesNotMatch(remoteCommand, /client\.flush\(\)/, "flush vacía los mensajes recibidos de la TV");
});

test("el firmware publica el estado real de energia que informa Android TV Remote", () => {
  const firmware = read("esp32_gateway/src/main.cpp");
  const app = read("html/js/app.js");
  const tvCommand = app.slice(app.indexOf("function sendTVCommand("), app.indexOf("function promptFirebaseConfig("));

  assert.match(firmware, /bool readAndroidTvPowerState\(/);
  assert.match(firmware, /findProtoBytesField\(rxBuf, rxLen, 40, remoteStart, remoteStartLength\)/);
  assert.match(firmware, /findProtoVarintField\(remoteStart, remoteStartLength, 1, stateValue\)/);
  assert.match(firmware, /home\/state\/tvPower\//);
  assert.match(firmware, /tvStatusRefreshRequested/);
  assert.match(app, /listen\("home\/state\/tvPower"/);
  assert.match(app, /TV_POWER_STATUS_MAX_AGE_MS/);
  assert.match(app, /function getTvPowerDisplay\(/);
  assert.match(app, /report\.status === "on"[\s\S]*?report\.status === "off"/);
  assert.match(app, /age <= TV_POWER_STATUS_MAX_AGE_MS/);
  assert.doesNotMatch(tvCommand, /home\/tvs\/"\s*\+\s*tv\.id\s*\+\s*"\/poweredOn"/);
});

test("el sondeo de estado no bloquea ordenes TV y no convierte contencion en estado desconocido", () => {
  const firmware = read("esp32_gateway/src/main.cpp");
  const statusTaskStart = firmware.indexOf("void tvStatusTask(void* param) {");
  const remoteSessionStart = firmware.indexOf(
    "bool executeAndroidTvRemote(",
    firmware.indexOf("bool executeAndroidTvRemoteUnlocked("),
  );
  const statusTask = firmware.slice(statusTaskStart, firmware.indexOf("bool handleTvCommand(", statusTaskStart));
  const remoteSession = firmware.slice(remoteSessionStart, firmware.indexOf("void publishTvPowerState(", remoteSessionStart));

  assert.match(firmware, /TV_REMOTE_COMMAND_MUTEX_TIMEOUT_MS\s*=\s*15000/);
  assert.match(remoteSession, /mutexTimeoutMs/);
  assert.match(remoteSession, /pdMS_TO_TICKS\(mutexTimeoutMs\)/);
  assert.match(statusTask, /readAndroidTvPowerState\(tv,\s*powerState,\s*sessionAcquired,\s*errorMsg\)/);
  assert.match(statusTask, /if\s*\(hasTlsConfig\s*&&\s*!sessionAcquired\)[\s\S]*?break;/);
  assert.match(statusTask, /Sondeo omitido: hay una orden TV en curso/);
});

test("el slider de volumen ajusta con teclas usando el nivel informado por la TV", () => {
  const firmware = read("esp32_gateway/src/main.cpp");
  const tvCommand = firmware.slice(
    firmware.indexOf("bool handleTvCommand(", firmware.indexOf("bool executeAndroidTvRemote(")),
  );

  assert.match(firmware, /bool parseAndroidTvVolume\(/);
  assert.doesNotMatch(firmware, /sendAndroidTvVolumePacket/);
  assert.match(firmware, /findProtoBytesField\(data, length, 50, volumeInfo, volumeInfoLength\)/);
  assert.match(tvCommand, /action == "set_volume"[\s\S]*?volumeLevel = value\.toInt\(\)/);
  assert.match(firmware, /targetVolume = min\(volumeLevel, maxVolume\)/);
  assert.match(firmware, /targetVolume > currentVolume \? 24 : 25/);
  assert.match(firmware, /abs\(targetVolume - currentVolume\)/);
  assert.match(firmware, /return volume >= 0 && volume <= 25/);
});

test("el control de volumen usa escala 0–25 y migra valores porcentuales guardados", () => {
  const html = read("html/index.html");
  const app = read("html/js/app.js");
  const initialData = JSON.parse(read("firebase_initial_data.json"));
  assert.match(html, /id="volume-slider" type="range" min="0" max="25" step="1" value="9" aria-label="Volumen del televisor, de 0 a 25"/);
  assert.match(app, /var TV_VOLUME_MAX = 25/);
  assert.match(app, /normalizeTvVolume\(parsed\.volume, savedVolumeScale, defaults\.volume\)/);
  assert.match(app, /normalizeTvVolume\(remoteTv\.volume, volumeScale, fallback\.volume\)/);
  assert.match(app, /volumeScale"] = TV_VOLUME_MAX/);
  assert.match(app, /tvState\.volume \+ "\/" \+ TV_VOLUME_MAX/);
  assert.deepEqual(initialData.home.state.tvPower, {});
  for (const tv of Object.values(initialData.home.tvs)) {
    assert.ok(tv.volume >= 0 && tv.volume <= 25);
    assert.equal(tv.volumeScale, 25);
  }
});

test("la interfaz no puede borrar una confirmación TV después de publicar la orden", () => {
  const app = read("html/js/app.js");
  const tvCommand = app.slice(app.indexOf("function sendTVCommand("), app.indexOf("function promptFirebaseConfig("));
  const directSetter = app.slice(app.indexOf("function setFirebaseValue("), app.indexOf("function waitForFirebaseValue("));

  assert.match(tvCommand, /waitForFirebaseValue\(\s*"home\/state\/tvCommandResult\/timestamp"/);
  assert.match(tvCommand, /setFirebaseValue\("home\/commands\/tv", commandPayload\)/);
  assert.doesNotMatch(tvCommand, /clearStale\["home\/state\/tvCommandResult"\]\s*=\s*null/);
  assert.match(tvCommand, /commandAt,\s*20000/);
  assert.doesNotMatch(directSetter, /db\.ref\(path\)\.set\(value\)/);
  assert.match(directSetter, /method:\s*"PUT"/);
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
