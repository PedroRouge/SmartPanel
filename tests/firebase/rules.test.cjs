const fs = require("node:fs");
const path = require("node:path");
const { after, before, beforeEach, test } = require("node:test");
const { initializeTestEnvironment, assertFails, assertSucceeds } = require("@firebase/rules-unit-testing");
const { ref, get, set } = require("firebase/database");

const projectId = "demo-smart-panel";
let environment;

before(async () => {
  environment = await initializeTestEnvironment({
    projectId,
    database: {
      rules: fs.readFileSync(path.join(__dirname, "../../firebase_rules.json"), "utf8"),
    },
  });
});

after(async () => {
  await environment.cleanup();
});

beforeEach(async () => {
  await environment.clearDatabase();
});

test("admin puede emitir comandos; device solo puede retirarlos", async () => {
  const adminDb = environment.authenticatedContext("admin", { role: "admin" }).database();
  const deviceDb = environment.authenticatedContext("gateway", { role: "device" }).database();
  const strangerDb = environment.authenticatedContext("guest", { email: "otro@example.com" }).database();
  const command = ref(adminDb, "home/commands/lights/living");

  await assertSucceeds(set(command, true));
  await assertFails(set(ref(strangerDb, "home/commands/lights/living"), false));
  await assertFails(set(ref(deviceDb, "home/commands/lights/living"), false));
  await assertSucceeds(set(ref(deviceDb, "home/commands/lights/living"), null));
});

test("gateway reporta estados de portón enumerados y admin puede leerlos", async () => {
  const deviceDb = environment.authenticatedContext("gateway", { role: "device" }).database();
  const adminDb = environment.authenticatedContext("admin", { role: "admin" }).database();
  const guestDb = environment.authenticatedContext("guest", { email: "otro@example.com" }).database();

  await assertSucceeds(set(ref(deviceDb, "home/state/gateStatus"), "pulse_sent"));
  await assertFails(set(ref(deviceDb, "home/state/gateStatus"), "open"));
  await assertSucceeds(get(ref(adminDb, "home/state/gateStatus")));
  await assertFails(get(ref(guestDb, "home/state/gateStatus")));
});

test("device solo puede escribir campos conocidos en home/state", async () => {
  const deviceDb = environment.authenticatedContext("gateway", { role: "device" }).database();
  const guestDb = environment.authenticatedContext("guest").database();
  const state = ref(deviceDb, "home/state");

  await assertSucceeds(set(ref(deviceDb, "home/state/gateStatus"), "pulse_sent"));
  await assertSucceeds(set(ref(deviceDb, "home/state/gateStatusAt"), Date.now()));
  await assertSucceeds(set(ref(deviceDb, "home/state/lights/living"), true));
  await assertFails(set(state, { gateStatus: "pulse_sent", gateStatusAt: Date.now() }));
  await assertFails(set(ref(deviceDb, "home/state/firmwareOverride"), true));
  await assertFails(set(ref(deviceDb, "home/state/lights/unlisted"), true));

  const receipt = ref(deviceDb, "home/state/commandReceipts/_home_commands_lights_living");
  await assertSucceeds(set(receipt, Date.now()));
  await assertFails(set(receipt, "invalid"));
  await assertFails(get(ref(guestDb, "home/state/commandReceipts/_home_commands_lights_living")));
});

test("gateway status exige el esquema exacto y valores acotados", async () => {
  const deviceDb = environment.authenticatedContext("gateway", { role: "device" }).database();
  const status = ref(deviceDb, "home/gateway/status");
  const validStatus = {
    online: true,
    ip: "10.0.0.20",
    rssi: -55,
    uptime: 42,
    last_seen: Date.now(),
    version: "2.1.0-dualcore",
  };

  await assertSucceeds(set(status, validStatus));
  await assertFails(set(status, { ...validStatus, rssi: 100 }));
  await assertFails(set(ref(deviceDb, "home/gateway/status/injected"), "extra"));
});

test("eventos quedan privados por UID y validan su contenido", async () => {
  const aliceDb = environment.authenticatedContext("alice").database();
  const bobDb = environment.authenticatedContext("bob").database();
  const event = {
    title: "Prueba de reglas",
    date: "2026-10-14",
    all_day: false,
    start_time: "09:30",
    notes: "Evento de CI",
    category: "personal",
    updatedAt: Date.now(),
  };

  await assertSucceeds(set(ref(aliceDb, "users/alice/events/event-1"), event));
  await assertFails(set(ref(bobDb, "users/alice/events/event-2"), event));
  await assertFails(set(ref(aliceDb, "users/alice/events/event-3"), { ...event, title: "" }));
  await assertFails(set(ref(aliceDb, "users/alice/events/event-4"), { ...event, isAdmin: true }));
});

test("tokens push son privados, acotados y rechazan campos adicionales", async () => {
  const aliceDb = environment.authenticatedContext("alice").database();
  const bobDb = environment.authenticatedContext("bob").database();
  const token = { token: "fcm-token-example", updatedAt: Date.now(), platform: "Chrome", device: "Desktop" };

  await assertSucceeds(set(ref(aliceDb, "pushTokens/alice/encoded-token"), token));
  await assertFails(set(ref(bobDb, "pushTokens/alice/other-token"), token));
  await assertFails(set(ref(aliceDb, "pushTokens/alice/extra-field"), { ...token, admin: true }));
  await assertFails(set(ref(aliceDb, "pushTokens/alice/long-platform"), { ...token, platform: "x".repeat(1025) }));
  await assertFails(set(ref(aliceDb, "pushTokens/alice"), { arbitrary: token }));
});


test("el acceso de administrador depende del claim y no del email", async () => {
  const adminDb = environment.authenticatedContext("admin", { role: "admin", email: "other@example.com" }).database();
  const oldOwnerEmailDb = environment.authenticatedContext("old-owner", { email: "pedrorouge2022@gmail.com" }).database();
  await assertSucceeds(set(ref(adminDb, "home/commands/timestamp"), Date.now()));
  await assertFails(set(ref(oldOwnerEmailDb, "home/commands/timestamp"), Date.now()));
});

test("device puede reportar tvCommandResult con o sin message", async () => {
  const deviceDb = environment.authenticatedContext("gateway", { role: "device" }).database();
  const resultRef = ref(deviceDb, "home/state/tvCommandResult");

  const successResult = {
    timestamp: Date.now(),
    targetId: "tv-pedro",
    action: "power",
    success: true,
  };
  await assertSucceeds(set(resultRef, successResult));

  const errorResult = {
    timestamp: Date.now(),
    targetId: "tv-pedro",
    action: "power",
    success: false,
    message: "Couldn't connect to 192.168.0.10:6466",
  };
  await assertSucceeds(set(resultRef, errorResult));
});

