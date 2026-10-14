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

function eventStartAt(event) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(event.date || "");
  if (!dateMatch) return null;
  const time = event.all_day ? "09:00" : (event.start_time || "09:00");
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(time);
  if (!timeMatch) return null;
  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  // Buenos Aires uses UTC-03:00. All-day events use 09:00 local time.
  return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour) + 3, Number(minute)));
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
  const users = (await db.ref("users").get()).val() || {};

  for (const [uid, userData] of Object.entries(users)) {
    const events = userData && userData.events || {};
    for (const [id, event] of Object.entries(events)) {
      if (!event || !event.title || !event.date) continue;
      const startsAt = eventStartAt(event);
      if (!startsAt || startsAt <= now) continue;
      const reminders = [
        { kind: "24h", offset: 24 * 60 * 60 * 1000, label: "Mañana" },
        { kind: "2h", offset: 2 * 60 * 60 * 1000, label: "En 2 horas" }
      ];
      for (const reminder of reminders) {
        const dueAt = startsAt.getTime() - reminder.offset;
        // The function runs every five minutes; allow a ten-minute catch-up window.
        if (now.getTime() < dueAt || now.getTime() >= dueAt + 10 * 60 * 1000) continue;
        const targets = await getTokensForUser(uid);
        if (!targets.length) continue;
        const sentRef = db.ref(`pushSent/${uid}/${reminder.kind}_${id}_${event.date}`);
        const claim = await sentRef.transaction((value) => value ? undefined : { sentAt: Date.now() });
        if (!claim.committed) continue;
        const time = !event.all_day && event.start_time ? ` a las ${event.start_time}` : " a las 09:00";
        try {
          await sendToTokens(targets, `Agenda · ${reminder.label}: ${event.title}`, `${reminder.label}${time}`);
        } catch (error) {
          await sentRef.remove();
          throw error;
        }
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
