const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

const sourcePath = path.join(__dirname, "../../scripts/free-push/Code.gs");
const source = fs.readFileSync(sourcePath, "utf8");
const sandbox = {};
vm.runInNewContext(source, sandbox, { filename: sourcePath });

test("los recordatorios gratuitos calculan el horario de Buenos Aires y el día completo", () => {
  assert.equal(sandbox.eventStartAt_({ date: "2026-10-15", start_time: "10:30", all_day: false }).toISOString(), "2026-10-15T13:30:00.000Z");
  assert.equal(sandbox.eventStartAt_({ date: "2024-02-29", all_day: true }).toISOString(), "2024-02-29T12:00:00.000Z");
});

test("se descartan fechas y horas inválidas", () => {
  for (const event of [
    null,
    {},
    { date: "2026-02-29", all_day: true },
    { date: "2026-13-01", all_day: true },
    { date: "2026-10-15", start_time: "24:00", all_day: false },
    { date: "2026-10-15", start_time: "09:60", all_day: false }
  ]) assert.equal(sandbox.eventStartAt_(event), null);
});

test("el worker serializa ejecuciones, limita recuperación y no depende de Cloud Functions", () => {
  assert.match(source, /tryLock\(1000\)/);
  assert.match(source, /catchUpMs: 10 \* 60 \* 1000/);
  assert.match(source, /everyMinutes\(5\)/);
  assert.doesNotMatch(source, /firebase-functions|firebase-admin/);
});
