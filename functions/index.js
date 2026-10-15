const { initializeApp } = require("firebase-admin/app");
const { getDatabase } = require("firebase-admin/database");
const { getMessaging } = require("firebase-admin/messaging");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { onValueCreated, onValueWritten } = require("firebase-functions/v2/database");
const { eventStartAt, reminderTaskId } = require("./reminders");

initializeApp();
const db = getDatabase();
const messaging = getMessaging();
const TZ = "America/Argentina/Buenos_Aires";
// Reemplazá por el dominio público real configurado en Vercel.
const APP_URL = "https://smart-panel-beryl.vercel.app";

async function sendToTokens(tokens, title, body, notificationTag) {
  let failures = 0;
  for (let offset = 0; offset < tokens.length; offset += 500) {
    const batch = tokens.slice(offset, offset + 500);
    const result = await messaging.sendEachForMulticast({
      tokens: batch.map((target) => target.token),
      notification: { title, body },
      webpush: {
        fcmOptions: { link: `${APP_URL}/#agenda` },
        ...(notificationTag ? { notification: { tag: notificationTag } } : {})
      }
    });
    const removals = [];
    result.responses.forEach((response, index) => {
      const code = response.error && response.error.code;
      if (!response.success) failures += 1;
      if (code === "messaging/registration-token-not-registered" || code === "messaging/invalid-registration-token") {
        removals.push(batch[index].path.remove());
      }
    });
    await Promise.all(removals);
  }
  return failures;
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

async function sendToAll(title, body, notificationTag) {
  const snapshot = await db.ref("pushTokens").get();
  const targets = [];
  snapshot.forEach((userSnapshot) => userSnapshot.forEach((tokenSnapshot) => {
    const value = tokenSnapshot.val();
    if (value && value.token) targets.push({ token: value.token, path: tokenSnapshot.ref });
  }));
  return sendToTokens(targets, title, body, notificationTag);
}

const REMINDERS = [
  { kind: "24h", offset: 24 * 60 * 60 * 1000, label: "Mañana" },
  { kind: "2h", offset: 2 * 60 * 60 * 1000, label: "En 2 horas" }
];
const REMINDER_CATCH_UP_MS = 10 * 60 * 1000;
const REMINDER_LOCK_MS = 2 * 60 * 1000;

exports.scheduleEventReminders = onValueWritten(
  { ref: "users/{uid}/events/{eventId}", retry: true },
  async (event) => {
  const { uid, eventId } = event.params;
  const tasksRef = db.ref("scheduledReminders");
  const taskRefs = REMINDERS.map(({ kind }) => tasksRef.child(reminderTaskId(uid, eventId, kind)));
  // Triggers can arrive out of order; derive the queue from the current record.
  const latestSnapshot = await db.ref(`users/${uid}/events/${eventId}`).get();
  const value = latestSnapshot.val();
  const startsAt = value && eventStartAt(value);
  if (!value || !startsAt || !value.title) {
    await Promise.all(taskRefs.map((ref) => ref.remove()));
    return;
  }

  const now = Date.now();
  await Promise.all(REMINDERS.map(({ kind, offset }) => {
    const dueAt = startsAt.getTime() - offset;
    const ref = tasksRef.child(reminderTaskId(uid, eventId, kind));
    if (dueAt < now - REMINDER_CATCH_UP_MS || startsAt.getTime() <= now) return ref.remove();
    return ref.set({ uid, eventId, kind, dueAt, lockUntil: 0, nextAttemptAt: dueAt });
  }));
  },
);

exports.calendarPush = onSchedule({ schedule: "every 1 minutes", timeZone: TZ, timeoutSeconds: 300, maxInstances: 1 }, async () => {
  const now = Date.now();
  const dueTasks = await db.ref("scheduledReminders").orderByChild("nextAttemptAt").endAt(now).limitToFirst(100).get();
  const deliveries = [];
  dueTasks.forEach((snapshot) => deliveries.push(snapshot));

  async function deliverReminder(snapshot) {
    const taskRef = snapshot.ref;
    const claim = await taskRef.transaction((task) => {
      if (!task || Number(task.lockUntil) > now || Number(task.nextAttemptAt) > now) return undefined;
      return { ...task, lockUntil: now + REMINDER_LOCK_MS, nextAttemptAt: now + REMINDER_LOCK_MS };
    });
    if (!claim.committed) return;

    const task = claim.snapshot.val();
    try {
      const eventSnapshot = await db.ref(`users/${task.uid}/events/${task.eventId}`).get();
      const currentEvent = eventSnapshot.val();
      const currentStart = currentEvent && eventStartAt(currentEvent);
      const expectedDueAt = currentStart && currentStart.getTime() - (task.kind === "24h" ? 24 : 2) * 60 * 60 * 1000;
      if (!currentEvent || !currentStart || expectedDueAt !== Number(task.dueAt) || now > Number(task.dueAt) + REMINDER_CATCH_UP_MS) {
        await taskRef.remove();
        return;
      }

      const targets = await getTokensForUser(task.uid);
      if (!targets.length) {
        await taskRef.remove();
        return;
      }
      const reminder = REMINDERS.find((item) => item.kind === task.kind);
      const time = !currentEvent.all_day && currentEvent.start_time ? ` a las ${currentEvent.start_time}` : " a las 09:00";
      const failures = await sendToTokens(targets, `Agenda · ${reminder.label}: ${currentEvent.title}`, `${reminder.label}${time}`, `agenda-${snapshot.key}`);
      if (failures) throw new Error(`${failures} push token(s) rejected the reminder`);
      await taskRef.remove();
    } catch (error) {
      console.error("[calendarPush] Reminder delivery failed; it will retry after the lease:", error);
      await taskRef.transaction((task) => task ? { ...task, lockUntil: 0, nextAttemptAt: Date.now() + 60 * 1000 } : undefined);
    }
  }

  for (let offset = 0; offset < deliveries.length; offset += 10) {
    await Promise.all(deliveries.slice(offset, offset + 10).map(deliverReminder));
  }
});

// Para avisos físicos/sistema, el backend autorizado escribe en home/pushAlerts.
exports.systemPush = onValueCreated({ ref: "home/pushAlerts/{alertId}", retry: true }, async (event) => {
  const alert = event.data.val();
  if (!alert || !alert.title) return;
  const failures = await sendToAll(alert.title, alert.body || "Smart Panel detectó un cambio.", `system-${event.params.alertId}`);
  if (failures) throw new Error(`${failures} push token(s) rejected the system alert`);
  await event.data.ref.remove();
});
