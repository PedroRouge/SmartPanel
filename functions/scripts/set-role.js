"use strict";

const { initializeApp, applicationDefault } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

async function main() {
  const [, , email, role] = process.argv;
  if (!email || !["owner", "device", "none"].includes(role)) {
    throw new Error("Uso: node scripts/set-role.js <email> <owner|device|none>");
  }

  initializeApp({ credential: applicationDefault() });
  const auth = getAuth();
  const user = await auth.getUserByEmail(email);
  const claims = { ...user.customClaims };
  if (role === "none") delete claims.role;
  else claims.role = role;
  await auth.setCustomUserClaims(user.uid, claims);
  console.log(`Rol '${role}' aplicado a ${email} (${user.uid}). El usuario debe renovar su sesión.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
