"use strict";

var SMART_PANEL_PUSH = {
  projectId: "smart-panel-53d7b",
  databaseUrl: "https://smart-panel-53d7b-default-rtdb.firebaseio.com",
  appUrl: "https://smart-panel-beryl.vercel.app",
  timezone: "America/Argentina/Buenos_Aires",
  triggerHandler: "runSmartPanelFreePush",
  reminderOffsets: [
    { kind: "24h", milliseconds: 24 * 60 * 60 * 1000, label: "Mañana" },
    { kind: "2h", milliseconds: 2 * 60 * 60 * 1000, label: "En 2 horas" }
  ],
  catchUpMs: 10 * 60 * 1000
};

function runSmartPanelFreePush() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var now = Date.now();
    var userIds = rtdbGetShallow_("users") || {};
    Object.keys(userIds).forEach(function (uid) {
      var tokens = getUserTokens_(uid);
      if (!tokens.length) return;
      var events = rtdbGet_("users/" + encodeURIComponent(uid) + "/events") || {};
      Object.keys(events).forEach(function (eventId) {
        deliverDueReminders_(uid, eventId, events[eventId], tokens, now);
      });
    });
    deliverSystemAlerts_();
  } finally {
    lock.releaseLock();
  }
}

function installSmartPanelFreePushTrigger() {
  // The trigger runs as the Google account that creates it. Use a Firebase project administrator.
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === SMART_PANEL_PUSH.triggerHandler) ScriptApp.deleteTrigger(trigger);
  });
  var trigger = ScriptApp.newTrigger(SMART_PANEL_PUSH.triggerHandler).timeBased().everyMinutes(5).create();
  Logger.log("Trigger gratuito instalado: notificaciones Smart Panel cada 5 minutos.");
  return {
    installed: true,
    handler: trigger.getHandlerFunction(),
    source: String(trigger.getTriggerSource()),
    uniqueId: trigger.getUniqueId(),
    intervalMinutes: 5
  };
}

function verifySmartPanelFreePushAccess() {
  var userIds = rtdbGetShallow_("users");
  var response = UrlFetchApp.fetch(
    "https://fcm.googleapis.com/v1/projects/" + SMART_PANEL_PUSH.projectId + "/messages:send",
    requestOptions_("post", { message: { token: "validation-only-invalid-token", notification: { title: "Validación" } } })
  );
  var status = response.getResponseCode();
  if (status === 401 || status === 403) throw new Error("La cuenta no tiene permiso para enviar con FCM HTTP v1 (HTTP " + status + ").");
  if (status !== 400) throw new Error("La validación de FCM esperaba HTTP 400 para el token ficticio y recibió HTTP " + status + ".");
  Logger.log("Firebase Realtime Database autorizado. Usuarios encontrados: " + Object.keys(userIds || {}).length);
  Logger.log("FCM HTTP v1 autorizado (respuesta de validación HTTP " + status + ").");
  return { database: "ok", fcmHttpStatus: status };
}

function serviceAccountAccessToken_() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get("firebaseAdminAccessToken");
  if (cached) return cached;
  var properties = PropertiesService.getScriptProperties();
  var email = properties.getProperty("FIREBASE_SERVICE_ACCOUNT_EMAIL");
  var privateKey = properties.getProperty("FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY");
  if (!email || !privateKey) throw new Error("Configurá FIREBASE_SERVICE_ACCOUNT_EMAIL y FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY en las propiedades del proyecto Apps Script.");

  var now = Math.floor(Date.now() / 1000);
  var encode = function (value) { return Utilities.base64EncodeWebSafe(JSON.stringify(value), Utilities.Charset.UTF_8).replace(/=+$/g, ""); };
  var unsigned = encode({ alg: "RS256", typ: "JWT" }) + "." + encode({
    iss: email,
    scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600
  });
  var signature = Utilities.base64EncodeWebSafe(Utilities.computeRsaSha256Signature(unsigned, privateKey)).replace(/=+$/g, "");
  var response = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
    method: "post",
    payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: unsigned + "." + signature },
    muteHttpExceptions: true
  });
  var status = response.getResponseCode();
  var result = JSON.parse(response.getContentText() || "{}");
  if (status < 200 || status >= 300 || !result.access_token) throw new Error("Google OAuth rechazó las credenciales de Firebase (HTTP " + status + "): " + (result.error_description || result.error || "respuesta vacía"));
  cache.put("firebaseAdminAccessToken", result.access_token, Math.min(3500, Number(result.expires_in || 3600) - 60));
  return result.access_token;
}

function deliverDueReminders_(uid, eventId, event, tokens, now) {
  var startsAt = eventStartAt_(event);
  if (!startsAt || !event.title) return;
  SMART_PANEL_PUSH.reminderOffsets.forEach(function (reminder) {
    var dueAt = startsAt.getTime() - reminder.milliseconds;
    if (dueAt > now || now > dueAt + SMART_PANEL_PUSH.catchUpMs) return;
    var sentPath = "pushSent/" + safeKey_(uid + "/" + eventId + "/" + reminder.kind);
    if (rtdbGet_(sentPath)) return;
    var time = !event.all_day && event.start_time ? " a las " + event.start_time : " a las 09:00";
    sendToTokens_(tokens, "Agenda · " + reminder.label + ": " + event.title, reminder.label + time, "agenda-" + safeKey_(uid + "/" + eventId + "/" + reminder.kind));
    // Mark only after all sends succeed, so a later run can retry failed deliveries.
    rtdbPut_(sentPath, { sentAt: Date.now(), dueAt: dueAt });
  });
}

function deliverSystemAlerts_() {
  var alerts = rtdbGet_("home/pushAlerts") || {};
  var tokensByUser = rtdbGet_("pushTokens") || {};
  var tokens = [];
  Object.keys(tokensByUser).forEach(function (uid) {
    Object.keys(tokensByUser[uid] || {}).forEach(function (key) {
      var record = tokensByUser[uid][key];
      if (record && record.token) tokens.push({ token: record.token, path: "pushTokens/" + uid + "/" + key });
    });
  });
  Object.keys(alerts).forEach(function (alertId) {
    var alert = alerts[alertId];
    if (!alert || !alert.title || !tokens.length) return;
    sendToTokens_(tokens, alert.title, alert.body || "", "system-" + alertId);
    rtdbDelete_("home/pushAlerts/" + alertId);
  });
}

function getUserTokens_(uid) {
  var records = rtdbGet_("pushTokens/" + encodeURIComponent(uid)) || {};
  return Object.keys(records).reduce(function (targets, key) {
    var record = records[key];
    if (record && record.token) targets.push({ token: record.token, path: "pushTokens/" + encodeURIComponent(uid) + "/" + encodeURIComponent(key) });
    return targets;
  }, []);
}

function sendToTokens_(targets, title, body, tag) {
  targets.forEach(function (target) {
    var payload = {
      message: {
        token: target.token,
        notification: { title: title, body: body },
        webpush: {
          fcm_options: { link: SMART_PANEL_PUSH.appUrl + "/#agenda" },
          notification: { tag: tag }
        }
      }
    };
    var response = UrlFetchApp.fetch(
      "https://fcm.googleapis.com/v1/projects/" + SMART_PANEL_PUSH.projectId + "/messages:send",
      requestOptions_("post", payload)
    );
    var status = response.getResponseCode();
    if (status >= 200 && status < 300) return;
    var text = response.getContentText();
    if (status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) {
      if (target.path) rtdbDelete_(target.path);
      return;
    }
    throw new Error("FCM HTTP v1 rechazó el envío (HTTP " + status + "): " + text.slice(0, 500));
  });
}

function eventStartAt_(event) {
  if (!event || typeof event.date !== "string") return null;
  var match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(event.date);
  if (!match) return null;
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  var time = event.all_day ? "09:00" : (event.start_time || "09:00");
  var timeMatch = /^(?:[01]\d|2[0-3]):[0-5]\d$/.exec(time);
  if (!timeMatch) return null;
  var parts = time.split(":").map(Number);
  // Buenos Aires is UTC-03:00; all-day reminders use 09:00 local time.
  return new Date(Date.UTC(year, month - 1, day, parts[0] + 3, parts[1]));
}

function safeKey_(value) {
  return Utilities.base64EncodeWebSafe(value).replace(/=+$/g, "");
}

function rtdbGet_(path) { return rtdbRequest_("get", path); }
function rtdbGetShallow_(path) { return rtdbRequest_("get", path, undefined, "shallow=true"); }
function rtdbPut_(path, value) { return rtdbRequest_("put", path, value); }
function rtdbDelete_(path) { return rtdbRequest_("delete", path); }

function rtdbRequest_(method, path, value, query) {
  var url = SMART_PANEL_PUSH.databaseUrl.replace(/\/+$/, "") + "/" + path + ".json";
  if (query) url += "?" + query;
  var options = requestOptions_(method, value);
  var response = UrlFetchApp.fetch(url, options);
  var status = response.getResponseCode();
  if (status < 200 || status >= 300) throw new Error("Firebase Realtime Database rechazó " + method.toUpperCase() + " " + path + " (HTTP " + status + "): " + response.getContentText().slice(0, 500));
  var text = response.getContentText();
  return text ? JSON.parse(text) : null;
}

function requestOptions_(method, value) {
  var options = {
    method: method,
    headers: { Authorization: "Bearer " + serviceAccountAccessToken_() },
    muteHttpExceptions: true
  };
  if (value !== undefined && method !== "get" && method !== "delete") {
    options.contentType = "application/json";
    options.payload = JSON.stringify(value);
  }
  return options;
}
