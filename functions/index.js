const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueCreated } = require("firebase-functions/v2/database");

initializeApp();
const db = getDatabase();
const messaging = getMessaging();
const TZ = "America/Argentina/Buenos_Aires";
// Reemplazá por el dominio público real configurado en Vercel.
const APP_URL = "https://smart-panel-beryl.vercel.app";

function localISO(date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function nextISO(iso) {
  const day = new Date(`${iso}T12:00:00Z`);
  day.setUTCDate(day.getUTCDate() + 1);
  return day.toISOString().slice(0, 10);
}

async function sendToTokens(tokens, title, body) {
  for (let offset = 0; offset < tokens.length; offset += 500) {
    const batch = tokens.slice(offset, offset + 500);
    const result = await messaging.sendEachForMulticast({
      tokens: batch.map((target) => target.token),
      notification: { title, body },
      webpush: { fcmOptions: { link: `${APP_URL}/#agenda` } }
    });
    const removals = [];
    result.responses.forEach((response, index) => {
      const code = response.error && response.error.code;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        removals.push(batch[index].path.remove());
      }
    });
    await Promise.all(removals);
  }
}

async function getTokensForUser(uid) {
  const snapshot = await db.ref(`pushTokens/${uid}`).get();
  const targets = [];
  snapshot.forEach((tokenSnapshot) => {
    const value = tokenSnapshot.val();
    if (value && value.token) targets.push({ token: value.token, path: tokenSnapshot.ref });
  });
  return targets;
}

async function sendToUser(uid, title, body) {
  return sendToTokens(await getTokensForUser(uid), title, body);
}

async function sendToAll(title, body) {
  const snapshot = await db.ref("pushTokens").get();
  const targets = [];
  snapshot.forEach((userSnapshot) => userSnapshot.forEach((tokenSnapshot) => {
    const value = tokenSnapshot.val();
    if (value && value.token) targets.push({ token: value.token, path: tokenSnapshot.ref });
  }));
  return sendToTokens(targets, title, body);
}

exports.calendarPush = onSchedule({ schedule: "every 5 minutes", timeZone: TZ }, async () => {
  const now = new Date();
  const currentISO = localISO(now);
  const tomorrowISO = nextISO(currentISO);
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(now));
  const users = (await db.ref("users").get()).val() || {};

  for (const [uid, userData] of Object.entries(users)) {
    const events = userData && userData.events || {};
    for (const [id, event] of Object.entries(events)) {
      if (!event || !event.title || !event.date) continue;
      let kind = "";
      if (event.date === tomorrowISO && hour >= 9) kind = "before";
      if (event.date === currentISO && hour >= 7) kind = "today";
      if (!kind) continue;

      const sentRef = db.ref(`pushSent/${uid}/${kind}_${id}_${event.date}`);
      const claim = await sentRef.transaction((value) => value ? undefined : { sentAt: Date.now() });
      if (!claim.committed) continue;
      const time = !event.all_day && event.start_time ? ` a las ${event.start_time}` : " (todo el día)";
      const prefix = kind === "before" ? "Mañana" : "Hoy";
      try {
        await sendToUser(uid, kind === "before" ? `Agenda · Mañana: ${event.title}` : `Agenda · Hoy: ${event.title}`, `${prefix}${time}`);
      } catch (error) {
        await sentRef.remove();
        throw error;
      }
    }
  }
});

// Para avisos físicos/sistema, el backend autorizado escribe en home/pushAlerts.
exports.systemPush = onValueCreated("home/pushAlerts/{alertId}", async (event) => {
  const alert = event.data.val();
  if (!alert || !alert.title) return;
  await sendToAll(alert.title, alert.body || "Smart Panel detectó un cambio.");
  await event.data.ref.remove();
});
