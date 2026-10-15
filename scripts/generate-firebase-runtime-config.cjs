const fs = require("node:fs");
const path = require("node:path");

const apiKey = process.env.FIREBASE_WEB_API_KEY;
const vapidKey = process.env.FIREBASE_WEB_VAPID_KEY;
if (!apiKey || !vapidKey) {
  throw new Error("FIREBASE_WEB_API_KEY and FIREBASE_WEB_VAPID_KEY are required for deployment.");
}

const config = {
  apiKey,
  authDomain: "smart-panel-53d7b.firebaseapp.com",
  databaseURL: "https://smart-panel-53d7b-default-rtdb.firebaseio.com",
  projectId: "smart-panel-53d7b",
  storageBucket: "smart-panel-53d7b.firebasestorage.app",
  messagingSenderId: "1085885262056",
  appId: "1:1085885262056:web:90373760572ff556f1015d",
  measurementId: "G-Y99C1G3J4F",
  vapidKey,
  authDefaultDomain: "smartpanel.local"
};
const destination = path.join(__dirname, "..", "html", "js", "firebase-runtime-config.js");
fs.writeFileSync(
  destination,
  `// Generated during deployment; do not commit runtime credentials.\nself.SMART_PANEL_FIREBASE_RUNTIME_CONFIG = ${JSON.stringify(config, null, 2)};\n`,
  { mode: 0o600 }
);
