"use strict";

const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..", "..");

function trackedFiles() {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

const FILES = trackedFiles();

test("la arquitectura no depende de una API local ni de una PC encendida", () => {
  const forbidden = [
    { pattern: /legacy_backup/, label: "referencia al directorio legacy_backup" },
    { pattern: /android_tv_firebase_bridge/, label: "referencia al puente local de Television" },
    { pattern: /SMART_PANEL_API_URL/, label: "apuntado del frontend a una API local" },
  ];
  const offenders = [];
  for (const file of FILES) {
    if (!/\.(js|cjs|mjs|py|yml|yaml|json|html|css|md|ini|h)$/.test(file)) continue;
    if (file.startsWith("obsidian-vault/")) continue;
    const content = read(file);
    for (const rule of forbidden) {
      if (rule.pattern.test(content)) offenders.push(`${file}: ${rule.label}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("el frontend no llama a loopback ni a puertos de servidor local", () => {
  const app = read("html/js/app.js");
  assert.doesNotMatch(app, /https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/);
  assert.doesNotMatch(app, /:\s*(5000|8000|8080|3000)\b/);
});

test("las herramientas de emparejamiento no dependen del servidor local eliminado", () => {
  const pairing = read("tools/android_tv_pairing/pair_android_tv.py");
  assert.doesNotMatch(pairing, /from servidor import|import servidor/);
  const discovery = read("tools/android_tv_pairing/discover_android_tv.py");
  assert.doesNotMatch(discovery, /from servidor import|import servidor/);
  assert.equal(fs.existsSync(path.join(ROOT, "legacy_backup")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "scripts", "android_tv_firebase_bridge.py")), false);
});

test("el firmware se comunica con Firebase y no con un puente de PC", () => {
  const firmware = read("esp32_gateway/src/main.cpp");
  assert.match(firmware, /beginStream\(&streamData, "\/home\/commands"\)/);
  assert.doesNotMatch(firmware, /firebase_serial|Serial\.begin\(.*PC/);
});

test("el pipeline no compila ni prueba la API local retirada", () => {
  const workflow = read(".github/workflows/ci-cd.yml");
  assert.doesNotMatch(workflow, /legacy_backup/);
  assert.match(workflow, /tools\/android_tv_pairing/);
});

test("el exportador de certificados cubre cliente, servidor y nombre TLS", () => {
  const exporter = read("scripts/export_tv_certs.py");
  assert.match(exporter, /TV_\{name\}_CERT/);
  assert.match(exporter, /TV_\{name\}_KEY/);
  assert.match(exporter, /TV_\{name\}_SERVER_CERT/);
  assert.match(exporter, /TV_\{name\}_TLS_HOST/);
  assert.doesNotMatch(exporter, /192\.168\./);
});
