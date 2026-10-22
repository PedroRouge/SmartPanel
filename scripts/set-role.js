"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

const RULES_FILE = path.join(__dirname, "..", "firebase_rules.json");

function deviceUidFromRules() {
  try {
    const rules = JSON.parse(fs.readFileSync(RULES_FILE, "utf8")).rules || {};
    const expression = rules.home?.state?.gateStatus?.[".write"] || "";
    const match = expression.match(/auth\.uid\s*==\s*'([^']+)'/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

async function main() {
  const [, , email, role] = process.argv;
  if (!email || !["admin", "device", "none"].includes(role)) {
    throw new Error("Uso: node scripts/set-role.js <email> <admin|device|none>");
  }

  initializeApp({ credential: applicationDefault(), projectId: process.env.FIREBASE_PROJECT_ID || "smart-panel-53d7b" });
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const claims = { ...user.customClaims };
  if (role === "none") delete claims.role;
  else claims.role = role;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`Rol '${role}' aplicado a ${email} (${user.uid}). El usuario debe renovar su sesión.`);

  if (role === "device") {
    const expected = deviceUidFromRules();
    if (expected && expected !== user.uid) {
      console.error(
        `ATENCION: las reglas de firebase_rules.json solo permiten escribir al dispositivo ${expected}, ` +
        `pero esta cuenta es ${user.uid}. Actualiza el UID en las reglas antes de usarla como gateway.`
      );
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
