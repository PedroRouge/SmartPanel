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

test("solo el email permitido puede emitir comandos sin claim owner; device puede retirarlos", async () => {
  const ownerDb = environment.authenticatedContext("owner", { email: "pedrorouge2022@gmail.com" }).database();
  const deviceDb = environment.authenticatedContext("gateway", { role: "device" }).database();
  const strangerDb = environment.authenticatedContext("guest", { email: "otro@example.com" }).database();
  const command = ref(ownerDb, "home/commands/lights/living");

  await assertSucceeds(set(command, true));
  await assertFails(set(ref(strangerDb, "home/commands/lights/living"), false));
  await assertFails(set(ref(deviceDb, "home/commands/lights/living"), false));
  await assertSucceeds(set(ref(deviceDb, "home/commands/lights/living"), null));
});

test("gateway solo reporta estados de portón enumerados y owner puede leerlos", async () => {
  const deviceDb = environment.authenticatedContext("gateway", { role: "device" }).database();
  const ownerDb = environment.authenticatedContext("owner", { email: "pedrorouge2022@gmail.com" }).database();
  const guestDb = environment.authenticatedContext("guest", { email: "otro@example.com" }).database();

  await assertSucceeds(set(ref(deviceDb, "home/state/gateStatus"), "pulse_sent"));
  await assertFails(set(ref(deviceDb, "home/state/gateStatus"), "open"));
  await assertSucceeds(get(ref(ownerDb, "home/state/gateStatus")));
  await assertFails(get(ref(guestDb, "home/state/gateStatus")));
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
});


test("solo el email autorizado entra sin claim owner", async () => {
  const allowedDb = environment.authenticatedContext("allowed", { email: "pedrorouge2022@gmail.com" }).database();
  const otherDb = environment.authenticatedContext("other", { email: "other@example.com" }).database();
  await assertSucceeds(set(ref(allowedDb, "home/commands/timestamp"), Date.now()));
  await assertFails(set(ref(otherDb, "home/commands/timestamp"), Date.now()));
});
