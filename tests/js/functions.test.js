const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { eventStartAt, reminderTaskId, reminderTaskUpdate } = require("../../functions/reminders");

test("los recordatorios interpretan fechas y horas como horario de Buenos Aires", () => {
  assert.equal(
    eventStartAt({ date: "2026-10-15", start_time: "10:30", all_day: false }).toISOString(),
    "2026-10-15T13:30:00.000Z",
  );
  assert.equal(
    eventStartAt({ date: "2024-02-29", all_day: true }).toISOString(),
    "2024-02-29T12:00:00.000Z",
  );
  assert.equal(
    eventStartAt({ date: "2026-10-15", all_day: false }).toISOString(),
    "2026-10-15T12:00:00.000Z",
  );
});

test("los recordatorios rechazan fechas u horas que Date normalizaría silenciosamente", () => {
  for (const event of [
    null,
    {},
    { date: "2026-02-29", all_day: true },
    { date: "2026-13-01", all_day: true },
    { date: "2026-10-15", start_time: "24:00", all_day: false },
    { date: "2026-10-15", start_time: "09:60", all_day: false },
    { date: "2026-10-15", start_time: "9:00", all_day: false },
  ]) {
    assert.equal(eventStartAt(event), null, `debe rechazar ${JSON.stringify(event)}`);
  }
});

test("las claves de recordatorio son estables, seguras para RTDB y distintas por tipo", () => {
  const reminder = reminderTaskId("user-1", "event-2", "24h");
  assert.match(reminder, /^[A-Za-z0-9_-]+$/);
  assert.equal(reminderTaskId("user-1", "event-2", "24h"), reminder);
  assert.notEqual(reminderTaskId("user-1", "event-2", "2h"), reminder);
  assert.notEqual(reminderTaskId("user-2", "event-2", "24h"), reminder);
});

test("los reintentos de agenda conservan el bloqueo cuando la fecha no cambió", () => {
  const inFlight = { dueAt: 5000, lockUntil: 9000, nextAttemptAt: 9000 };
  assert.equal(reminderTaskUpdate(inFlight, { uid: "u", eventId: "e", kind: "24h", dueAt: 5000 }), undefined);
  assert.deepEqual(reminderTaskUpdate(null, { uid: "u", eventId: "e", kind: "24h", dueAt: 5000 }), {
    uid: "u", eventId: "e", kind: "24h", dueAt: 5000, lockUntil: 0, nextAttemptAt: 5000
  });
  assert.deepEqual(reminderTaskUpdate(inFlight, { uid: "u", eventId: "e", kind: "24h", dueAt: 6000 }), {
    uid: "u", eventId: "e", kind: "24h", dueAt: 6000, lockUntil: 0, nextAttemptAt: 6000
  });
});

test("la cola de recordatorios reintenta fallos transitorios al guardar eventos", () => {
  const source = fs.readFileSync(path.join(__dirname, "../../functions/index.js"), "utf8");
  assert.match(source, /onValueWritten\(\s*\{\s*ref:\s*"users\/\{uid\}\/events\/\{eventId\}",\s*retry:\s*true\s*\}/s);
});
