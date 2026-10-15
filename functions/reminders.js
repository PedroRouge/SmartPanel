"use strict";

function eventStartAt(event) {
  if (!event || typeof event !== "object" || typeof event.date !== "string") return null;
  const dateMatch = /^(19|20)(\d{2})-(\d{2})-(\d{2})$/.exec(event.date);
  if (!dateMatch) return null;

  const year = Number(dateMatch[1] + dateMatch[2]);
  const month = Number(dateMatch[3]);
  const day = Number(dateMatch[4]);
  const dateAtUtc = Date.UTC(year, month - 1, day);
  const calendarDate = new Date(dateAtUtc);
  if (calendarDate.getUTCFullYear() !== year || calendarDate.getUTCMonth() !== month - 1 || calendarDate.getUTCDate() !== day) {
    return null;
  }

  const time = event.all_day ? "09:00" : (event.start_time || "09:00");
  const timeMatch = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(time);
  if (!timeMatch) return null;
  const [hour, minute] = time.split(":").map(Number);

  // Buenos Aires uses UTC-03:00. All-day events use 09:00 local time.
  return new Date(Date.UTC(year, month - 1, day, hour + 3, minute));
}

function reminderTaskId(uid, eventId, kind) {
  return Buffer.from(`${uid}/${eventId}/${kind}`).toString("base64url");
}

function reminderTaskUpdate(existing, task) {
  if (existing && Number(existing.dueAt) === Number(task.dueAt)) return undefined;
  return { ...task, lockUntil: 0, nextAttemptAt: task.dueAt };
}

module.exports = { eventStartAt, reminderTaskId, reminderTaskUpdate };
