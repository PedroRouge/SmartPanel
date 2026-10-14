(function () {
  "use strict";

  var APP_BUILD_VERSION = "60";
  var STORAGE_KEY = "smart-panel-state-v2";
  var WEATHER_CONFIG = {
    latitude: -31.86519,
    longitude: -60.57469,
    location: "Colonia Ensayo, Entre Ríos"
  };
  var WEATHER_STORAGE_KEY = "smart-panel-weather-v5-" + WEATHER_CONFIG.latitude + "-" + WEATHER_CONFIG.longitude;

  var state = readState();
  var db = null;
  var auth = null;
  var pushWorkerRegistration = null;
  var pushWorkerPromise = null;
  var foregroundMessageBound = false;
  var firebaseConnected = false;
  var firebaseConnectionMode = "checking";
  var firebaseProbeBusy = false;
  var gatewayOnline = false;
  var gatewayDetails = "Esperando heartbeat del ESP32";
  var gatewayReportedOnline = false;
  var gatewayLastSeen = 0;
  var holidaysByDate = {};
  var activityListenerRef = null;
  var apiAuthenticated = false;
  var currentUsername = "";
  var cameraCredentials = {};
  var weatherHasData = false;
  var volumeCommandTimer = null;
  function formatDateISO(dateValue) {
    var y = dateValue.getFullYear();
    var m = String(dateValue.getMonth() + 1).padStart(2, "0");
    var d = String(dateValue.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + d;
  }

  function parseISODate(value) {
    var parts = value.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function formatAgendaDate(value, options) {
    return parseISODate(value).toLocaleDateString("es-AR", options || { weekday: "long", day: "numeric", month: "long" });
  }

  var calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  var selectedAgendaDate = formatDateISO(new Date());
  var calendarEvents = [];
  var eventEditingId = null;
  var pendingEventId = null;
  var deferredInstallPrompt = null;
  var listenersAttached = false;
  var activeFirebaseRefs = [];
  var activeEventsRef = null;
  var agendaRestSyncTimer = null;
  var agendaRestSyncBusy = false;
  var lastRenderedDay = ""; // PERF-03: sólo actualizar date-line cuando cambia el día

  var TV_DEVICES = [
    { id: "tv-living", name: "TV Living", room: "Living", model: "Smart TV", ip: "192.168.0.52", online: true, poweredOn: false, powerControlReady: true, volume: 35, muted: false },
    { id: "tv-pedro", name: "TV Pedro", room: "Habitación Pedro", model: "Smart TV", ip: "192.168.0.10", online: true, poweredOn: false, powerControlReady: true, volume: 30, muted: false },
    { id: "tv-padres", name: "TV Habitación Padres", room: "Habitación Padres", model: "Smart TV", ip: "192.168.0.53", online: true, poweredOn: false, powerControlReady: true, volume: 30, muted: false },
    { id: "tv-lucas", name: "TV Lucas", room: "Habitación Lucas", model: "Smart TV", ip: "192.168.0.51", online: true, poweredOn: false, powerControlReady: true, volume: 25, muted: false }
  ];

  function readState() {
    var defaults = {
      lights: { living: false, kitchen: false, bedroom: false, garden: false },
      poolOn: false,
      gateOpen: false,
      volume: 35,
      muted: false,
      tvId: "tv-principal",
      tvStates: {},
      cameras: []
    };
    try {
      var saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        var parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") {
          if (parsed.lights) { Object.assign(defaults.lights, parsed.lights); }
          defaults.poolOn = parsed.poolOn === true;
          defaults.gateOpen = parsed.gateOpen === true;
          if (typeof parsed.volume === "number") { defaults.volume = parsed.volume; }
          defaults.muted = parsed.muted === true;
          if (parsed.tvId) { defaults.tvId = parsed.tvId; }
          if (parsed.tvStates) { defaults.tvStates = parsed.tvStates; }
          if (Array.isArray(parsed.cameras)) { defaults.cameras = parsed.cameras; }
        }
      }
    } catch (e) {}
    return defaults;
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function createTextElement(tagName, className, text) {
    var element = document.createElement(tagName);
    if (className) { element.className = className; }
    if (text !== undefined && text !== null) { element.textContent = text; }
    return element;
  }

  // --- FIREBASE INITIALIZATION & AUTHENTICATION OBSERVER ---
  function initFirebase() {
    var config = window.SMART_PANEL_FIREBASE_CONFIG;
    if (!config || !window.firebase) {
      console.warn("[Firebase] SDK o configuración no disponibles aún.");
      renderSystemStatus();
      return;
    }

    try {
      if (!firebase.apps.length) {
        firebase.initializeApp(config);
      }
      db = firebase.database();
      auth = firebase.auth ? firebase.auth() : null;
      console.log("[Firebase] Inicializado con éxito hacia:", config.databaseURL);

      // Estado de conexión a Firebase
      db.ref(".info/connected").on("value", function (snapshot) {
        var isConnected = snapshot.val() === true;
        if (firebaseConnected !== isConnected) {
          firebaseConnected = isConnected;
          console.info("[Firebase] Realtime Database " + (isConnected ? "conectada" : "sin conexión"));
        }
        if (isConnected) {
          firebaseConnectionMode = "realtime";
        } else if (!firebaseProbeBusy) {
          probeFirebaseHttps(auth && auth.currentUser);
        }
        renderSystemStatus();
      });

      // Observer de autenticación de Firebase
      if (auth) {
        auth.onAuthStateChanged(function (user) {
          if (user) {
            console.log("[Firebase Auth] Usuario autenticado:", user.email || user.uid);
            var name = user.email ? user.email.split("@")[0] : "admin";
            acceptSession(name);
            updateAccountStatus(user);
            probeFirebaseHttps(user);
          } else {
            console.log("[Firebase Auth] Sesión no iniciada (acceso restringido por reglas).");
            apiAuthenticated = false;
            detachFirebaseListeners();
            showAuthGate();
            updateAccountStatus(null);
          }
        });
      }
      window.setInterval(function () {
        if (!firebaseConnected && auth && auth.currentUser && !firebaseProbeBusy) { probeFirebaseHttps(auth.currentUser); }
      }, 30000);
    } catch (error) {
      console.error("[Firebase] Error al inicializar:", error);
      firebaseConnected = false;
      renderSystemStatus();
      console.error("[Firebase] Estado de conexión: " + error.message);
    }
  }

  function attachFirebaseListeners() {
    if (!db || !apiAuthenticated || listenersAttached) { return; }
    listenersAttached = true;
    console.log("[Firebase] Conectando listeners en tiempo real con credenciales válidas...");

    function listen(path, callback, onError) {
      var ref = db.ref(path);
      ref.on("value", callback, onError);
      activeFirebaseRefs.push(ref);
      return ref;
    }

    // 1. Estado de Luces, Pileta y Portón en tiempo real
    listen("home/state", function (snapshot) {
      var val = snapshot.val();
      if (!val) { return; }

      if (val.lights && typeof val.lights === "object") {
        Object.keys(val.lights).forEach(function (k) {
          state.lights[k] = val.lights[k] === true;
        });
        renderLights();
      }

      if (typeof val.poolOn === "boolean") {
        state.poolOn = val.poolOn;
        renderPool();
      }

      if (typeof val.gateOpen === "boolean") {
        state.gateOpen = val.gateOpen;
        renderGate();
      }

      saveState();
      renderSystemStatus();
    }, function (error) {
      console.warn("[Firebase] Error al leer home/state (comprueba reglas):", error);
    });

    // 2. Gateway ESP32-S3 Status (Heartbeat del hardware local)
    listen("home/gateway/status", function (snapshot) {
      var gateway = snapshot.val();
      if (!gateway) {
        gatewayOnline = false;
        gatewayReportedOnline = false;
        gatewayLastSeen = 0;
        gatewayDetails = "ESP32 no detectado";
        updateGatewayStatusUI(false, "ESP32 no detectado");
        return;
      }

      var now = Date.now();
      var lastSeen = Number(gateway.last_seen) || 0;
      gatewayLastSeen = lastSeen;
      gatewayReportedOnline = gateway.online === true;
      var diffSec = lastSeen > 0 ? Math.round((now - lastSeen) / 1000) : -1;
      var isRecent = diffSec >= 0 && diffSec < 45; // Heartbeat cada 15s

      if (gateway.online && isRecent) {
        var info = "ESP32-S3 LAN (" + (gateway.ip || "Wi-Fi") + ") · " + (gateway.rssi ? gateway.rssi + "dBm" : "Online");
        gatewayOnline = true;
        gatewayDetails = info;
        updateGatewayStatusUI(true, info);
      } else {
        var timeText = "Sin conexión previa";
        if (lastSeen > 0 && diffSec >= 0) {
          if (diffSec < 60) {
            timeText = "Últ. hace " + diffSec + "s";
          } else if (diffSec < 3600) {
            timeText = "Últ. hace " + Math.floor(diffSec / 60) + "m";
          } else if (diffSec < 86400) {
            timeText = "Últ. hace " + Math.floor(diffSec / 3600) + "h";
          } else if (diffSec < 86400 * 30) {
            timeText = "Últ. hace " + Math.floor(diffSec / 86400) + "d";
          } else {
            timeText = "Desconectado";
          }
        }
        gatewayOnline = false;
        gatewayDetails = "Último contacto: " + timeText;
        updateGatewayStatusUI(false, "ESP32 offline · " + timeText);
      }
    });

    // 3. TVs en tiempo real
    listen("home/tvs", function (snapshot) {
      var tvsData = snapshot.val();
      if (tvsData && typeof tvsData === "object") {
        var list = [];
        Object.keys(tvsData).forEach(function (key) {
          var item = tvsData[key];
          if (item && typeof item === "object") {
            list.push(item);
          }
        });
        if (list.length) {
          TV_DEVICES = list;
          TV_DEVICES.forEach(function (tv) {
            if (!state.tvStates[tv.id]) {
              state.tvStates[tv.id] = { volume: tv.volume || 35, muted: tv.muted === true };
            }
          });
          renderTVs();
          renderMedia();
        }
      }
    });

    // 4. Agenda privada, sincronizada entre todos los dispositivos del usuario.
    var user = auth && auth.currentUser;
    if (!user) { return; }
    activeEventsRef = db.ref("users/" + user.uid + "/events");
    function renderUserEvents(snapshot) { renderUserEventsData(snapshot.val(), user); }
    var usingLegacyFallback = false;
    function onEventsError(error) {
      console.error("[Agenda] Error leyendo los eventos del usuario:", error);
      if (!auth || !auth.currentUser || auth.currentUser.uid !== user.uid) { return; }
      if (!usingLegacyFallback && user.email === "pedrorouge2022@gmail.com" && error.code === "PERMISSION_DENIED") {
        usingLegacyFallback = true;
        activeEventsRef.off();
        activeEventsRef = db.ref("home/events");
        activeEventsRef.on("value", renderUserEvents, onEventsError);
        activeFirebaseRefs.push(activeEventsRef);
      }
    }
    // The agenda listener must not wait for an optional legacy migration read.
    activeEventsRef.on("value", renderUserEvents, onEventsError);
    activeFirebaseRefs.push(activeEventsRef);
    activityListenerRef = db.ref("users/" + user.uid + "/activity");
    activityListenerRef.on("value", renderActivity, function (error) {
      console.warn("[Actividad] No se pudo leer el historial:", error);
      renderActivity(null);
    });
    activeFirebaseRefs.push(activityListenerRef);
    readUserEventsViaRest(user).catch(function (error) {
      console.warn("[Agenda] La lectura HTTPS inicial no estuvo disponible:", error);
    });
    if (agendaRestSyncTimer) { clearInterval(agendaRestSyncTimer); }
    agendaRestSyncTimer = setInterval(function () {
      if (!firebaseConnected && !agendaRestSyncBusy && auth && auth.currentUser && auth.currentUser.uid === user.uid) {
        agendaRestSyncBusy = true;
        readUserEventsViaRest(user).catch(function (error) {
          console.warn("[Agenda] No se pudo sincronizar la agenda por HTTPS:", error);
        }).finally(function () { agendaRestSyncBusy = false; });
      }
    }, 15000);
    migrateLegacyEvents(user).catch(function (error) {
      console.warn("[Agenda] No se pudieron copiar eventos antiguos:", error);
    });
  }

  function detachFirebaseListeners() {
    activeFirebaseRefs.forEach(function (ref) { ref.off(); });
    activeFirebaseRefs = [];
    if (agendaRestSyncTimer) { clearInterval(agendaRestSyncTimer); agendaRestSyncTimer = null; }
    agendaRestSyncBusy = false;
    activeEventsRef = null;
    activityListenerRef = null;
    listenersAttached = false;
    calendarEvents = [];
    renderActivity(null);
    renderCalendar();
    renderAgendaDay();
    renderTodayEvents();
  }

  // La ruta antigua solo era accesible por su propietario histórico.
  function migrateLegacyEvents(user) {
    if (!user || user.email !== "pedrorouge2022@gmail.com") { return Promise.resolve(); }
    var destination = db.ref("users/" + user.uid + "/events");
    return Promise.all([destination.once("value"), db.ref("home/events").once("value")]).then(function (snapshots) {
      if (snapshots[0].exists() || !snapshots[1].exists()) { return; }
      var legacyEvents = snapshots[1].val();
      if (!legacyEvents || typeof legacyEvents !== "object") { return; }
      return destination.transaction(function (currentEvents) {
        var mergedEvents = Object.assign({}, legacyEvents);
        if (currentEvents && typeof currentEvents === "object") {
          Object.keys(currentEvents).forEach(function (id) { mergedEvents[id] = currentEvents[id]; });
        }
        return mergedEvents;
      });
    });
  }

  function renderUserEventsData(eventsData, user) {
    if (!auth || !auth.currentUser || auth.currentUser.uid !== user.uid) { return; }
    calendarEvents = [];
    if (eventsData && typeof eventsData === "object") {
      Object.keys(eventsData).forEach(function (id) {
        var ev = eventsData[id];
        if (ev && typeof ev === "object") { calendarEvents.push(Object.assign({ id: id }, ev)); }
      });
    }
    renderCalendar();
    renderAgendaDay();
    renderTodayEvents();
    if (typeof checkAgendaNotifications === "function") { checkAgendaNotifications(); }
  }

  function readUserEventsViaRest(user) {
    var config = window.SMART_PANEL_FIREBASE_CONFIG || {};
    if (!config.databaseURL || !user || !user.getIdToken) {
      return Promise.reject(new Error("No se pudo iniciar la lectura autenticada de la agenda."));
    }
    return user.getIdToken().then(function (idToken) {
      var baseUrl = config.databaseURL.replace(/\/+$/, "");
      var path = "/users/" + encodeURIComponent(user.uid) + "/events.json";
      return fetch(baseUrl + path + "?auth=" + encodeURIComponent(idToken), { cache: "no-store" });
    }).then(function (response) {
      if (!response.ok) { throw new Error("Firebase respondió HTTP " + response.status + " al leer la agenda."); }
      return response.json();
    }).then(function (eventsData) { renderUserEventsData(eventsData, user); });
  }

  function updateGatewayStatusUI(isOnline, text) {
    gatewayOnline = isOnline;
    var dot = byId("backend-health-dot");
    var label = byId("backend-version");
    if (dot) {
      dot.classList.remove("is-checking", "is-online", "is-error");
      dot.classList.add(isOnline ? "is-online" : "is-error");
    }
    if (label) {
      label.textContent = text;
    }
    var detailDot = byId("detail-esp-dot");
    var detailLabel = byId("detail-esp-status");
    var detailMeta = byId("detail-esp-meta");
    if (detailDot) { detailDot.classList.remove("is-checking", "is-online", "is-error"); detailDot.classList.add(isOnline ? "is-online" : "is-error"); }
    if (detailLabel) { detailLabel.textContent = isOnline ? "Conectado" : "Desconectado"; }
    if (detailMeta) { detailMeta.textContent = text; }
    var quickDot = byId("quick-esp-dot");
    var quickLabel = byId("quick-esp");
    if (quickDot) { quickDot.classList.remove("is-checking", "is-online", "is-error"); quickDot.classList.add(isOnline ? "is-online" : "is-error"); }
    if (quickLabel) { quickLabel.textContent = isOnline ? "ESP32" : "Offline"; }
    renderSystemStatus();
  }

  function renderSystemStatus() {
    var dot = byId("detail-firebase-dot");
    var label = byId("detail-firebase-status");
    var meta = byId("detail-firebase-meta");
    var mode = firebaseConnectionMode;
    var statusClass = mode === "checking" ? "is-checking" : (mode === "offline" ? "is-error" : "is-online");
    var statusText = mode === "realtime" ? "Conectado" : (mode === "https" ? "Disponible por HTTPS" : (mode === "denied" ? "Firebase responde - revisar permisos" : (mode === "offline" ? "Sin respuesta" : "Comprobando conexi\u00f3n...")));
    var detailText = mode === "realtime" ? "Realtime Database - sincronizaci\u00f3n en tiempo real" : (mode === "https" ? "Base activa; el canal en tiempo real est\u00e1 reconectando" : (mode === "denied" ? "Servidor activo; Firebase rechaz\u00f3 la lectura con esta sesi\u00f3n" : (mode === "offline" ? "No respondi\u00f3 Realtime Database ni la comprobaci\u00f3n HTTPS" : "Comprobando Realtime Database y HTTPS")));
    if (dot) { dot.classList.remove("is-checking", "is-online", "is-error"); dot.classList.add(statusClass); }
    if (label) { label.textContent = statusText; }
    if (meta) { meta.textContent = detailText; }
    var lights = byId("quick-lights");
    if (lights) { lights.textContent = String(Object.keys(state.lights).filter(function (key) { return state.lights[key] === true; }).length); }
    var pool = byId("quick-pool");
    if (pool) { pool.textContent = state.poolOn ? "ON" : "OFF"; }
    var poolDot = byId("quick-pool-dot");
    if (poolDot) { poolDot.classList.remove("is-checking", "is-online", "is-error"); poolDot.classList.add(state.poolOn ? "is-online" : "is-error"); }
    var gate = byId("quick-gate");
    if (gate) { gate.textContent = state.gateOpen ? "ABIERTO" : "CERRADO"; }
    var gateDot = byId("quick-gate-dot");
    if (gateDot) { gateDot.classList.remove("is-checking", "is-online", "is-error"); gateDot.classList.add(state.gateOpen ? "is-error" : "is-online"); }
  }

  function probeFirebaseHttps(user) {
    var config = window.SMART_PANEL_FIREBASE_CONFIG || {};
    if (firebaseConnected) {
      firebaseConnectionMode = "realtime";
      renderSystemStatus();
      return Promise.resolve(true);
    }
    if (firebaseProbeBusy || !config.databaseURL || !user || !user.getIdToken || !window.fetch) {
      return Promise.resolve(false);
    }
    firebaseProbeBusy = true;
    firebaseConnectionMode = "checking";
    renderSystemStatus();
    var timeoutId;
    var timeout = new Promise(function (_, reject) {
      timeoutId = setTimeout(function () { reject(new Error("timeout")); }, 6000);
    });
    var request = user.getIdToken().then(function (token) {
      var url = config.databaseURL.replace(/\/+$/, "") + "/home/state.json?auth=" + encodeURIComponent(token);
      return fetch(url, { cache: "no-store" });
    });
    return Promise.race([request, timeout]).then(function (response) {
      if (firebaseConnected) { firebaseConnectionMode = "realtime"; }
      else if (response.ok || response.status === 404) { firebaseConnectionMode = "https"; }
      else if (response.status === 401 || response.status === 403) { firebaseConnectionMode = "denied"; }
      else { firebaseConnectionMode = "offline"; }
      return response.ok;
    }).catch(function (error) {
      console.warn("[Firebase] HTTPS check did not respond:", error && error.message ? error.message : error);
      firebaseConnectionMode = firebaseConnected ? "realtime" : "offline";
      return false;
    }).finally(function () {
      clearTimeout(timeoutId);
      firebaseProbeBusy = false;
      renderSystemStatus();
    });
  }

  function updateAccountStatus(user) {
    var dot = byId("detail-auth-dot");
    var label = byId("detail-auth-status");
    var meta = byId("detail-auth-meta");
    if (dot) { dot.classList.remove("is-checking", "is-online", "is-error"); dot.classList.add(user ? "is-online" : "is-error"); }
    if (label) { label.textContent = user ? "Sesión iniciada" : "Sin sesión"; }
    if (meta) { meta.textContent = user ? (user.email || user.uid) : "Inicia sesión para sincronizar tus datos"; }
  }

  function refreshGatewayFreshness() {
    if (!gatewayLastSeen || !gatewayReportedOnline) { return; }
    var age = Math.max(0, Math.floor((Date.now() - gatewayLastSeen) / 1000));
    var isOnline = age < 45;
    if (isOnline === gatewayOnline) { return; }
    if (isOnline) {
      updateGatewayStatusUI(true, gatewayDetails);
      return;
    }
    var ageText = age < 3600 ? Math.floor(age / 60) + "m" : Math.floor(age / 3600) + "h";
    updateGatewayStatusUI(false, "ESP32 offline · Últ. hace " + ageText);
  }

  function currentDeviceLabel() {
    var platform = navigator.userAgentData && navigator.userAgentData.platform || navigator.platform || "Dispositivo";
    var ua = navigator.userAgent || "";
    var browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Navegador";
    return browser + " · " + platform;
  }

  function recordActivity(action, result, details) {
    var user = auth && auth.currentUser;
    if (!db || !user) { return; }
    db.ref("users/" + user.uid + "/activity").push().set({
      action: action, result: result, details: details || "", device: currentDeviceLabel(),
      timestamp: firebase.database.ServerValue.TIMESTAMP
    }).catch(function (error) { console.warn("[Actividad] No se pudo guardar el registro:", error); });
  }

  function renderActivity(snapshot) {
    var list = byId("activity-list");
    if (!list) { return; }
    while (list.firstChild) { list.removeChild(list.firstChild); }
    var data = snapshot && snapshot.val();
    var entries = data ? Object.keys(data).map(function (id) { return data[id]; }).filter(function (entry) { return entry && typeof entry === "object"; }) : [];
    entries.sort(function (a, b) { return Number(b.timestamp) - Number(a.timestamp); });
    if (!entries.length) {
      list.appendChild(createTextElement("p", "event-empty", auth && auth.currentUser ? "Todavía no hay actividad registrada." : "Inicia sesión para consultar la actividad."));
      return;
    }
    entries.forEach(function (entry) {
      var row = createTextElement("article", "activity-row");
      row.appendChild(createTextElement("span", "activity-result-dot" + (entry.result === "ok" ? " is-ok" : " is-error"), entry.result === "ok" ? "✓" : "!"));
      var copy = createTextElement("div", "activity-copy");
      copy.appendChild(createTextElement("strong", "", entry.action || "Acción del sistema"));
      if (entry.details) { copy.appendChild(createTextElement("span", "", entry.details)); }
      row.appendChild(copy);
      var when = Number(entry.timestamp) ? new Date(Number(entry.timestamp)).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" }) : "Ahora";
      row.appendChild(createTextElement("span", "activity-meta", (entry.device || "Dispositivo desconocido") + " · " + when));
      list.appendChild(row);
    });
  }

  // Wait for the ESP32 to report the desired state; an initial read may be stale.
  function waitForRealtimeValue(path, expectedValue, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var ref = db.ref(path);
      var settled = false;
      var listener;
      var timer = setTimeout(function () {
        finish(new Error("El ESP32 no confirmó el cambio a tiempo."));
      }, timeoutMs);
      function finish(error, value) {
        if (settled) { return; }
        settled = true;
        clearTimeout(timer);
        ref.off("value", listener);
        if (error) { reject(error); } else { resolve(value); }
      }
      listener = function (snapshot) {
        if (snapshot.val() === expectedValue) { finish(null, snapshot.val()); }
      };
      ref.on("value", listener, function (error) { finish(error); });
    });
  }

  // --- ENVIAR COMANDOS HACIA FIREBASE (El ESP32 los ejecuta vía Wi-Fi) ---
  function sendLightCommand(lightName, targetState) {
    var prevState = state.lights[lightName];
    state.lights[lightName] = targetState;
    saveState();
    // Marcar tarjeta como "pendiente" hasta confirmación del ESP32
    var card = document.querySelector("[data-device='" + lightName + "']");
    if (card) { card.classList.add("is-pending"); }
    renderLights();

    if (!db || !apiAuthenticated) {
      if (card) { card.classList.remove("is-pending"); }
      state.lights[lightName] = prevState;
      renderLights();
      return;
    }

    var updates = {};
    updates["home/commands/lights/" + lightName] = targetState;
    updates["home/commands/timestamp"] = Date.now();
    db.ref().update(updates).then(function () {
      return waitForRealtimeValue("home/state/lights/" + lightName, targetState, 8000);
    }).then(function (confirmedState) {
      if (card) { card.classList.remove("is-pending"); }
      state.lights[lightName] = confirmedState === true;
      saveState();
      renderLights();
      var lightLabels = { living: "Living", kitchen: "Cocina", bedroom: "Dormitorio", garden: "Exterior" };
      recordActivity("Luz " + (confirmedState ? "encendida" : "apagada") + ": " + (lightLabels[lightName] || lightName), "ok", gatewayOnline ? "Confirmado por el ESP32" : "Estado confirmado en Firebase");
    }).catch(function (error) {
      console.error("No se pudo enviar/confirmar el comando de luz:", error);
      if (card) { card.classList.remove("is-pending"); }
      state.lights[lightName] = prevState;
      saveState();
      renderLights();
      recordActivity("Cambio de luz: " + lightName, "error", error.message);
      addNotification("alert", "⚠", "ERROR DE DISPOSITIVO", "No se pudo cambiar " + lightName, error.message);
    });
  }

  function sendPoolCommand(targetState) {
    var prevState = state.poolOn;
    state.poolOn = targetState;
    saveState();
    var toggle = byId("pool-toggle");
    if (toggle) { toggle.classList.add("is-pending"); }
    renderPool();

    if (!db || !apiAuthenticated) {
      if (toggle) { toggle.classList.remove("is-pending"); }
      state.poolOn = prevState;
      renderPool();
      return;
    }

    var updates = {};
    updates["home/commands/poolOn"] = targetState;
    updates["home/commands/timestamp"] = Date.now();
    db.ref().update(updates).then(function () {
      return waitForRealtimeValue("home/state/poolOn", targetState, 8000);
    }).then(function (confirmedState) {
      if (toggle) { toggle.classList.remove("is-pending"); }
      state.poolOn = confirmedState === true;
      saveState();
      renderPool();
      recordActivity("Motor de pileta " + (confirmedState ? "encendido" : "apagado"), "ok", gatewayOnline ? "Confirmado por el ESP32" : "Estado confirmado en Firebase");
    }).catch(function (error) {
      console.error("No se pudo enviar/confirmar el comando de pileta:", error);
      if (toggle) { toggle.classList.remove("is-pending"); }
      state.poolOn = prevState;
      saveState();
      renderPool();
      recordActivity("Cambio del motor de pileta", "error", error.message);
      addNotification("alert", "⚠", "ERROR DE DISPOSITIVO", "No se pudo cambiar la pileta", error.message);
    });
  }

  // BUG-09: Gate con rollback completo + auto-clear del mensaje (UX-03)
  function sendGateCommand(targetState) {
    var button = byId("gate-button");
    var feedbackEl = byId("gate-feedback");
    var prevState = state.gateOpen;
    if (!apiAuthenticated || !db) {
      feedbackEl.textContent = "Iniciá sesión para controlar el portón.";
      return;
    }
    button.disabled = true;
    feedbackEl.textContent = targetState ? "Enviando apertura vía Wi-Fi..." : "Enviando cierre vía Wi-Fi...";
    state.gateOpen = targetState;
    saveState();
    renderGate();

    var updates = {};
    updates["home/commands/gateOpen"] = targetState;
    updates["home/commands/gateTrigger"] = Date.now();
    updates["home/commands/timestamp"] = Date.now();
    db.ref().update(updates).then(function () {
      feedbackEl.textContent = "Comando enviado. Esperando confirmación del ESP32...";
      return waitForRealtimeValue("home/state/gateOpen", targetState, 10000);
    }).then(function (confirmedState) {
      state.gateOpen = confirmedState === true;
      saveState();
      renderGate();
      feedbackEl.textContent = "Portón accionado correctamente.";
      button.disabled = false;
      recordActivity("Portón " + (confirmedState ? "abierto" : "cerrado"), "ok", gatewayOnline ? "Confirmado por el ESP32" : "Estado confirmado en Firebase");
      setTimeout(function () { feedbackEl.textContent = ""; }, 4000);
    }).catch(function (error) {
      state.gateOpen = prevState;
      saveState();
      renderGate();
      feedbackEl.textContent = "Error: " + error.message;
      button.disabled = false;
      recordActivity("Acción sobre el portón", "error", error.message);
      addNotification("alert", "⚠", "ERROR DE DISPOSITIVO", "No se pudo accionar el portón", error.message);
    });
  }

  function sendTVCommand(action, value) {
    var tv = getSelectedTv();
    if (!tv) { return; }

    var tvState = getSelectedTvState();
    if (action === "set_volume") {
      tvState.volume = Number(value);
      tvState.muted = false;
      state.volume = tvState.volume;
      state.muted = false;
    } else if (action === "toggle_mute" || action === "set_mute") {
      tvState.muted = action === "toggle_mute" ? !tvState.muted : !!value;
      state.muted = tvState.muted;
    } else if (action === "power") {
      tv.poweredOn = !tv.poweredOn;
    }

    saveState();
    renderTVs();
    renderMedia();

    if (db && apiAuthenticated) {
      var commandPayload = {
        targetId: tv.id,
        action: action,
        value: value !== undefined ? value : null,
        timestamp: Date.now()
      };

      var updates = {};
      updates["home/commands/tv"] = commandPayload;
      if (action === "set_volume") {
        updates["home/tvs/" + tv.id + "/volume"] = tvState.volume;
        updates["home/tvs/" + tv.id + "/muted"] = false;
      } else if (action === "toggle_mute" || action === "set_mute") {
        updates["home/tvs/" + tv.id + "/muted"] = tvState.muted;
      } else if (action === "power") {
        updates["home/tvs/" + tv.id + "/poweredOn"] = tv.poweredOn;
      }

      db.ref().update(updates).then(function () {
        byId("media-feedback").textContent = tv.name + " · comando Wi-Fi enviado al ESP32.";
        recordActivity("Comando multimedia: " + tv.name, "ok", "Orden enviada (" + action.replace(/_/g, " ") + "); ejecución física no confirmada");
      }).catch(function (err) {
        byId("media-feedback").textContent = "Error: " + err.message;
        recordActivity("Comando multimedia: " + tv.name, "error", err.message);
      });
    } else {
      byId("media-feedback").textContent = tv.name + " · modo demo (inicia sesión para enviar comandos).";
    }
  }

  function promptFirebaseConfig() {
    var input = prompt("Pega aquí tu objeto firebaseConfig de Firebase Console:\n(ejemplo: { apiKey: 'AIza...', databaseURL: 'https://...' })");
    if (!input) { return; }
    try {
      var conf = null;
      if (input.indexOf("{") !== -1) {
        var cleaned = input
          .replace(/const\s+firebaseConfig\s*=\s*/, "")
          .replace(/;\s*$/, "")
          .replace(/([a-zA-Z0-9_]+)\s*:/g, '"$1":')
          .replace(/'/g, '"');
        conf = JSON.parse(cleaned);
      } else if (input.indexOf(",") !== -1) {
        var parts = input.split(",");
        conf = { apiKey: parts[0].trim(), databaseURL: parts[1].trim() };
      }
      if (conf && conf.apiKey && conf.databaseURL) {
        window.localStorage.setItem("smart-panel-firebase-config", JSON.stringify(conf));
        alert("¡Credenciales guardadas con éxito! Recargando...");
        window.location.reload();
      } else {
        alert("No se detectó apiKey o databaseURL válidos. Revisa el texto pegado.");
      }
    } catch (err) {
      alert("Error procesando configuración: " + err.message);
    }
  }

  // --- SISTEMA DE AUTENTICACIÓN SEGURO (FIREBASE AUTH) ---
  function initializeAuthentication() {
    var config = window.SMART_PANEL_FIREBASE_CONFIG || {};
    var isUnconfigured = !config.apiKey || config.apiKey.indexOf("TU_API_KEY") !== -1;
    var errorEl = byId("auth-error");

    if (isUnconfigured && errorEl) {
      errorEl.innerHTML = "⚠️ Falta vincular tu proyecto de Firebase.<br><button type='button' id='quick-firebase-setup' style='background:none;border:none;color:#38bdf8;text-decoration:underline;cursor:pointer;font:inherit;padding:4px 0;'>Toca aquí para configurar Firebase</button>";
      errorEl.hidden = false;
      setTimeout(function () {
        var btn = byId("quick-firebase-setup");
        if (btn) { btn.addEventListener("click", promptFirebaseConfig); }
      }, 50);
    }
    var toggleBtn = byId("auth-password-toggle");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", function () {
        var passInput = byId("auth-password");
        var icon = byId("password-toggle-icon");
        if (!passInput) { return; }
        if (passInput.type === "password") {
          passInput.type = "text";
          if (icon) { icon.textContent = "🙈"; }
        } else {
          passInput.type = "password";
          if (icon) { icon.textContent = "👁"; }
        }
      });
    }

    byId("auth-form").addEventListener("submit", function (e) {
      e.preventDefault();
      var submit = byId("auth-submit");
      var userInput = (byId("auth-username").value || "").trim().toLowerCase();
      var pass = byId("auth-password").value || "";
      var errorEl = byId("auth-error");

      if (!userInput) {
        errorEl.textContent = "Ingresa tu usuario o email.";
        errorEl.hidden = false;
        return;
      }
      if (!pass || pass.length < 6) {
        errorEl.textContent = "La contraseña debe tener al menos 6 caracteres.";
        errorEl.hidden = false;
        return;
      }

      // Convertir usuario sin '@' en email válido para Firebase Auth
      var config = window.SMART_PANEL_FIREBASE_CONFIG || {};
      var defaultDomain = config.authDefaultDomain || "smartpanel.local";
      var email = userInput.indexOf("@") === -1 ? userInput + "@" + defaultDomain : userInput;

      submit.disabled = true;
      submit.textContent = "Verificando...";
      errorEl.hidden = true;

      if (!auth) {
        submit.disabled = false;
        submit.textContent = "Iniciar sesión";
        errorEl.textContent = "Firebase Auth no está disponible.";
        errorEl.hidden = false;
        return;
      }

      // Intentar iniciar sesión
      auth.signInWithEmailAndPassword(email, pass).then(function (userCredential) {
        submit.disabled = false;
        submit.textContent = "Iniciar sesión";
        acceptSession(userInput);
      }).catch(function (error) {
        // SEGURIDAD: NO se crean cuentas nuevas automáticamente.
        // Solo los usuarios pre-registrados en Firebase Console pueden acceder.
        {
          submit.disabled = false;
          submit.textContent = "Iniciar sesión";
          var msg = "Error al autenticar: " + error.message;
          if (error.code === "auth/wrong-password") { msg = "Contraseña incorrecta."; }
          if (error.code === "auth/invalid-credential" || error.code === "auth/user-not-found") { msg = "Usuario/email o contraseña incorrectos."; }
          if (error.code === "auth/unauthorized-domain") { msg = "Firebase bloqueó este dominio. Agrega smart-panel-beryl.vercel.app en Authentication → Settings → Authorized domains."; }
          if (error.code === "auth/operation-not-allowed") { msg = "Habilita Email/Password en Firebase Authentication → Sign-in method."; }
          if (error.code === "auth/network-request-failed") { msg = "No se pudo conectar con Firebase. Verifica internet y vuelve a intentar."; }
          if (error.code === "auth/too-many-requests") { msg = "Demasiados intentos. Espera unos minutos."; }
          errorEl.textContent = msg;
          errorEl.hidden = false;
        }
      });
    });

    byId("api-logout").addEventListener("click", function () {
      if (auth) {
        auth.signOut().then(function () {
          apiAuthenticated = false;
          detachFirebaseListeners();
          showAuthGate("Sesión cerrada correctamente.");
        });
      } else {
        apiAuthenticated = false;
        showAuthGate("Sesión cerrada.");
      }
    });
  }

  function acceptSession(username) {
    apiAuthenticated = true;
    currentUsername = username || "admin";
    syncPushButtonForUser(auth && auth.currentUser);

    byId("auth-gate").hidden = true;
    byId("api-logout").hidden = false;
    byId("auth-password").value = "";
    byId("auth-error").hidden = true;

    var userEl = byId("session-user");
    if (userEl) {
      userEl.textContent = currentUsername;
      userEl.hidden = false;
    }

    // Activar listeners protegidos
    attachFirebaseListeners();

    // PERF-02: Solo cargar clima si aún no hay datos (evita doble petición al inicio)
    if (!weatherHasData) { loadWeather(); }
  }

  function showAuthGate(msg) {
    byId("auth-gate").hidden = false;
    byId("api-logout").hidden = true;
    var pushButton = byId("push-enable");
    if (pushButton) { pushButton.hidden = false; }
    var userEl = byId("session-user");
    if (userEl) { userEl.hidden = true; }
    var errorEl = byId("auth-error");
    if (errorEl) {
      errorEl.textContent = msg || "";
      errorEl.hidden = !msg;
    }
  }

  // --- CLIMA (Directo vía Open-Meteo) ---
  function weatherDescription(code) {
    if (code === 0) { return ["Despejado", "☀"]; }
    if (code === 1 || code === 2) { return ["Parcialmente nublado", "◒"]; }
    if (code === 3) { return ["Nublado", "☁"]; }
    if (code === 45 || code === 48) { return ["Niebla", "≋"]; }
    if (code >= 51 && code <= 67) { return ["Llovizna", "☂"]; }
    if (code >= 71 && code <= 77) { return ["Nieve", "❄"]; }
    if (code >= 80 && code <= 82) { return ["Lluvia", "☂"]; }
    if (code >= 85 && code <= 86) { return ["Nieve", "❄"]; }
    if (code >= 95) { return ["Tormenta", "ϟ"]; }
    return ["Clima actual", "☁"];
  }

  function loadWeather() {
    var status = byId("weather-status");
    byId("weather-location").textContent = WEATHER_CONFIG.location.toUpperCase();
    var refreshBtn = byId("weather-refresh");
    if (refreshBtn) { refreshBtn.disabled = true; }
    if (status) { status.textContent = "Consultando Open-Meteo..."; }

    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + WEATHER_CONFIG.latitude +
      "&longitude=" + WEATHER_CONFIG.longitude +
      "&current=temperature_2m,weather_code" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_mean" +
      "&forecast_days=7&timezone=auto";

    fetch(url)
      .then(function (res) {
        if (!res.ok) { throw new Error("HTTP " + res.status); }
        return res.json();
      })
      .then(function (data) {
        if (!data.current || !data.daily) { throw new Error("Datos incompletos"); }
        applyWeatherData(data, "Actualizado");
        try { window.localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(data)); } catch (e) {}
      })
      .catch(function (err) {
        console.warn("[Weather] Error al consultar Open-Meteo:", err);
        if (status) { status.textContent = "Error al actualizar"; }
        loadCachedWeather();
      })
      .finally(function () {
        if (refreshBtn) { refreshBtn.disabled = false; }
      });
  }

  function weatherDistanceKm(lat1, lon1, lat2, lon2) {
    var radians = Math.PI / 180;
    var dLat = (lat2 - lat1) * radians;
    var dLon = (lon2 - lon1) * radians;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function applyWeatherData(data, statusText) {
    var current = data.current;
    var daily = data.daily;
    var summary = weatherDescription(current.weather_code);
    weatherHasData = true;

    byId("weather-temperature").textContent = Math.round(current.temperature_2m) + "°";
    byId("weather-description").textContent = summary[0];
    byId("weather-symbol").textContent = summary[1];
    byId("weather-high").textContent = Math.round(daily.temperature_2m_max[0]) + "°";
    byId("weather-low").textContent = Math.round(daily.temperature_2m_min[0]) + "°";
    var updatedAt = current.time && current.time.indexOf("T") >= 0 ? current.time.split("T")[1].slice(0, 5) : "";
    byId("weather-status").textContent = statusText;
    var distance = typeof data.latitude === "number" && typeof data.longitude === "number" ? weatherDistanceKm(WEATHER_CONFIG.latitude, WEATHER_CONFIG.longitude, data.latitude, data.longitude) : null;
    var sourceNote = byId("weather-source-note");
    if (sourceNote) { sourceNote.textContent = "Pron\u00f3stico Open-Meteo - celda de modelo" + (distance === null ? "" : " a " + distance.toLocaleString("es-AR", { maximumFractionDigits: 1 }) + " km") + (updatedAt ? " - hora " + updatedAt : ""); }
    renderForecast(daily);
  }

  function loadCachedWeather() {
    try {
      var cached = window.localStorage.getItem(WEATHER_STORAGE_KEY);
      if (cached) {
        var data = JSON.parse(cached);
        if (data && data.current && data.daily) {
          applyWeatherData(data, "Datos guardados");
        }
      }
    } catch (e) {}
  }

  function renderForecast(daily) {
    var list = byId("forecast-list");
    if (!list) { return; }
    while (list.firstChild) { list.removeChild(list.firstChild); }

    for (var i = 0; i < 7; i += 1) {
      var date = new Date(daily.time[i] + "T12:00:00");
      var dayName = i === 0 ? "Hoy" : date.toLocaleDateString("es-AR", { weekday: "short" });
      var summary = weatherDescription(daily.weather_code[i]);
      var item = document.createElement("div");
      item.className = "forecast-item";
      item.appendChild(createTextElement("span", "forecast-time", dayName));
      item.appendChild(createTextElement("span", "forecast-icon", summary[1]));
      item.appendChild(createTextElement("span", "forecast-temperature", Math.round(daily.temperature_2m_max[i]) + "° / " + Math.round(daily.temperature_2m_min[i]) + "°"));

      var rain = daily.precipitation_probability_mean && typeof daily.precipitation_probability_mean[i] === "number" ? daily.precipitation_probability_mean[i] : null;
      item.appendChild(createTextElement("span", "forecast-rain", rain === null ? "Prom. lluvia --%" : "Prom. lluvia " + rain + "%"));
      list.appendChild(item);
    }
  }

  // --- AGENDA / EVENTOS CON FIREBASE ---
  function openEventForm(eventData) {
    var form = byId("event-form");
    eventEditingId = eventData ? eventData.id : null;
    byId("event-form-title").textContent = eventData ? "Editar evento" : "Nuevo evento";
    byId("event-submit").textContent = eventData ? "Guardar cambios" : "Guardar evento";
    byId("event-delete").hidden = !eventData;
    byId("event-form-error").hidden = true;

    form.elements.title.value = eventData ? eventData.title : "";
    form.elements.date.value = eventData ? eventData.date : selectedAgendaDate;
    form.elements.all_day.checked = eventData ? eventData.all_day : false;
    form.elements.start_time.value = eventData ? (eventData.start_time || "") : "09:00";
    form.elements.end_time.value = eventData ? (eventData.end_time || "") : "";
    form.elements.notes.value = eventData ? (eventData.notes || "") : "";
    byId("event-time-row").hidden = form.elements.all_day.checked;
    byId("event-modal").hidden = false;
    form.elements.title.focus();
  }

  function closeEventForm() {
    byId("event-modal").hidden = true;
    byId("event-form").reset();
    byId("event-form-error").hidden = true;
    eventEditingId = null;
    pendingEventId = null;
  }

  // HTTPS fallback for browsers where the RTDB live connection is unavailable.
  // Firebase Auth's ID token still enforces the same per-user database rules.
  function saveEventViaRest(user, eventId, payload) {
    var config = window.SMART_PANEL_FIREBASE_CONFIG || {};
    if (!config.databaseURL || !window.fetch || !user.getIdToken) {
      return Promise.reject(new Error("No se pudo iniciar el guardado HTTPS de Firebase."));
    }
    return user.getIdToken().then(function (idToken) {
      var baseUrl = config.databaseURL.replace(/\/+$/, "");
      var path = "/users/" + encodeURIComponent(user.uid) + "/events/" + encodeURIComponent(eventId) + ".json";
      // Firebase Auth ID tokens authenticate RTDB REST requests via auth=.
      return fetch(baseUrl + path + "?auth=" + encodeURIComponent(idToken), {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }).then(function (response) {
      return response.text().then(function (body) {
        var data = null;
        try { data = body ? JSON.parse(body) : null; } catch (e) {}
        if (!response.ok) {
          throw new Error((data && data.error) || ("Firebase respondió HTTP " + response.status + "."));
        }
        return data;
      });
    });
  }

  function deleteEventViaRest(user, eventId) {
    var config = window.SMART_PANEL_FIREBASE_CONFIG || {};
    if (!config.databaseURL || !window.fetch || !user || !user.getIdToken) {
      return Promise.reject(new Error("No se pudo iniciar la eliminación autenticada del evento."));
    }
    return user.getIdToken().then(function (idToken) {
      var baseUrl = config.databaseURL.replace(/\/+$/, "");
      var path = "/users/" + encodeURIComponent(user.uid) + "/events/" + encodeURIComponent(eventId) + ".json";
      return fetch(baseUrl + path + "?auth=" + encodeURIComponent(idToken), { method: "DELETE", cache: "no-store" });
    }).then(function (response) {
      return response.text().then(function (body) {
        var data = null;
        try { data = body ? JSON.parse(body) : null; } catch (e) {}
        if (!response.ok) { throw new Error((data && data.error) || ("Firebase respondió HTTP " + response.status + " al eliminar.")); }
      });
    });
  }

  function deleteEventWithFallback(user, ref, eventId) {
    if (!firebaseConnected) { return deleteEventViaRest(user, eventId); }
    var timer;
    var restFallback = new Promise(function (resolve, reject) {
      timer = setTimeout(function () { deleteEventViaRest(user, eventId).then(resolve, reject); }, 5000);
    });
    var realtimeDelete = ref.remove().catch(function (error) {
      clearTimeout(timer);
      console.warn("[Agenda] Falló la eliminación en tiempo real; intentando HTTPS autenticado.", error);
      return deleteEventViaRest(user, eventId);
    });
    return Promise.race([realtimeDelete, restFallback]).finally(function () { clearTimeout(timer); });
  }

  function withTimeout(promise, timeoutMs, message) {
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () { reject(new Error(message)); }, timeoutMs);
      Promise.resolve(promise).then(function (value) {
        clearTimeout(timer);
        resolve(value);
      }, function (error) {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function savePushTokenViaRest(user, tokenKey, payload) {
    var config = window.SMART_PANEL_FIREBASE_CONFIG || {};
    if (!config.databaseURL || !window.fetch || !user || !user.getIdToken) {
      return Promise.reject(new Error("No se pudo iniciar el guardado HTTPS del dispositivo."));
    }
    return user.getIdToken().then(function (idToken) {
      var baseUrl = config.databaseURL.replace(/\/+$/, "");
      var path = "/pushTokens/" + encodeURIComponent(user.uid) + "/" + encodeURIComponent(tokenKey) + ".json";
      return fetch(baseUrl + path + "?auth=" + encodeURIComponent(idToken), {
        method: "PUT",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
    }).then(function (response) {
      return response.text().then(function (body) {
        var data = null;
        try { data = body ? JSON.parse(body) : null; } catch (e) {}
        if (!response.ok) { throw new Error((data && data.error) || ("Firebase respondió HTTP " + response.status + " al guardar el dispositivo.")); }
      });
    });
  }

  function savePushTokenWithFallback(user, ref, tokenKey, payload) {
    if (!firebaseConnected) { return savePushTokenViaRest(user, tokenKey, payload); }
    var timer;
    var httpsFallback = new Promise(function (resolve, reject) {
      timer = setTimeout(function () { savePushTokenViaRest(user, tokenKey, payload).then(resolve, reject); }, 4000);
    });
    var realtimeSave = ref.set(payload).catch(function (error) {
      clearTimeout(timer);
      console.warn("[FCM] No respondió el guardado RTDB del dispositivo; usando HTTPS autenticado.", error);
      return savePushTokenViaRest(user, tokenKey, payload);
    });
    return Promise.race([realtimeSave, httpsFallback]).finally(function () { clearTimeout(timer); });
  }

  function clearStalePushErrors() {
    notifications = notifications.filter(function (item) {
      return !(item.type === "alert" && item.label === "ERROR DE NOTIFICACIONES" && item.title === "No se pudieron activar los avisos");
    });
    saveNotifications();
    updateNotifBadge();
    renderNotifPanel();
  }

  function saveEventWithFallback(user, ref, eventId, payload) {
    if (!firebaseConnected) {
      console.warn("[Agenda] RTDB no marcó conexión en tiempo real; guardando por HTTPS autenticado.");
      return saveEventViaRest(user, eventId, payload);
    }

    var fallbackTimer;
    var httpsFallback = new Promise(function (resolve, reject) {
      fallbackTimer = setTimeout(function () {
        console.warn("[Agenda] RTDB no confirmó el guardado; intentando HTTPS autenticado.");
        saveEventViaRest(user, eventId, payload).then(resolve, reject);
      }, 5000);
    });
    var realtimeSave = ref.set(payload).catch(function (realtimeError) {
      clearTimeout(fallbackTimer);
      console.warn("[Agenda] Falló el guardado en tiempo real; intentando HTTPS autenticado.", realtimeError);
      return saveEventViaRest(user, eventId, payload);
    });
    return Promise.race([realtimeSave, httpsFallback]).finally(function () {
      clearTimeout(fallbackTimer);
    });
  }

  function saveCalendarEvent(e) {
    e.preventDefault();
    var form = byId("event-form");
    var submitButton = byId("event-submit");
    var errorEl = byId("event-form-error");
    var payload = {
      title: form.elements.title.value.trim(),
      date: form.elements.date.value,
      all_day: form.elements.all_day.checked,
      start_time: form.elements.all_day.checked ? null : form.elements.start_time.value,
      end_time: form.elements.all_day.checked ? null : form.elements.end_time.value,
      notes: form.elements.notes.value.trim(),
      updatedAt: Date.now()
    };

    errorEl.hidden = true;
    if (!payload.title) {
      errorEl.textContent = "Escribe un titulo para el evento.";
      errorEl.hidden = false;
      form.elements.title.focus();
      return;
    }
    if (!payload.date) {
      errorEl.textContent = "Selecciona una fecha para el evento.";
      errorEl.hidden = false;
      form.elements.date.focus();
      return;
    }
    if (!payload.all_day && !payload.start_time) {
      errorEl.textContent = "Selecciona una hora de inicio o marca 'Todo el dia'.";
      errorEl.hidden = false;
      form.elements.start_time.focus();
      return;
    }

    var user = auth && auth.currentUser;
    if (!db || !user) {
      errorEl.textContent = "La sesion de Firebase no esta activa. Inicia sesion nuevamente para guardar.";
      errorEl.hidden = false;
      return;
    }
    // Resolve the private path from Firebase Auth for every operation. Do not
    // rely on a listener reference that can be stale or not initialized yet.
    var userEventsRef = db.ref("users/" + user.uid + "/events");
    var editingId = eventEditingId;
    if (!editingId && !pendingEventId) { pendingEventId = userEventsRef.push().key; }
    var ref = userEventsRef.child(editingId || pendingEventId);
    submitButton.disabled = true;
    submitButton.textContent = "Guardando...";
    var timeoutId;
    var timeoutPromise = new Promise(function (resolve, reject) {
      timeoutId = setTimeout(function () {
        var connection = firebaseConnected ? "conectada" : "sin conexion";
        var error = new Error("Firebase no confirmo el guardado despues de 15 segundos (" + connection + "). Puedes reintentar; se reutilizara el mismo evento.");
        error.code = "EVENT_SAVE_TIMEOUT";
        reject(error);
      }, 15000);
    });
    Promise.race([saveEventWithFallback(user, ref, ref.key, payload), timeoutPromise]).then(function () {
      clearTimeout(timeoutId);
      var savedEvent = Object.assign({ id: ref.key }, payload);
      var existingIndex = calendarEvents.findIndex(function (event) { return event.id === ref.key; });
      if (existingIndex >= 0) { calendarEvents[existingIndex] = savedEvent; }
      else { calendarEvents.push(savedEvent); }
      renderCalendar();
      renderAgendaDay();
      renderTodayEvents();
      recordActivity(editingId ? "Evento actualizado: " + payload.title : "Evento creado: " + payload.title, "ok", formatAgendaDate(payload.date) + (payload.all_day ? " · Todo el día" : " · " + payload.start_time));
      pendingEventId = null;
      closeEventForm();
    }).catch(function (err) {
      clearTimeout(timeoutId);
      console.error("Error guardando evento en Firebase:", err);
      recordActivity(editingId ? "No se pudo actualizar el evento: " + payload.title : "No se pudo crear el evento: " + payload.title, "error", err.message);
      var detail = err.code ? " (" + err.code + ")" : "";
      errorEl.textContent = "No se pudo guardar" + detail + ": " + err.message;
      errorEl.hidden = false;
    }).finally(function () {
      submitButton.disabled = false;
      submitButton.textContent = editingId ? "Guardar cambios" : "Guardar evento";
    });
  }

  // --- DIÁLOGO DE CONFIRMACIÓN MODAL PERSONALIZADO ---
  var confirmDialogState = null;

  function showConfirmDialog(options) {
    return new Promise(function (resolve) {
      var modal = byId("confirm-modal");
      var titleEl = byId("confirm-modal-title");
      var msgEl = byId("confirm-modal-message");
      var eyebrowEl = byId("confirm-modal-eyebrow");
      var confirmBtn = byId("confirm-modal-confirm");
      var cancelBtn = byId("confirm-modal-cancel");
      var iconEl = byId("confirm-modal-icon");

      if (!modal) {
        resolve(window.confirm((options && options.message) || "¿Confirmar acción?"));
        return;
      }

      confirmDialogState = { resolve: resolve };

      if (titleEl) { titleEl.textContent = options.title || "¿Confirmar?"; }
      if (msgEl) { msgEl.textContent = options.message || "¿Estás seguro de continuar?"; }
      if (eyebrowEl) { eyebrowEl.textContent = options.eyebrow || "CONFIRMAR ACCIÓN"; }
      if (confirmBtn) { confirmBtn.textContent = options.confirmText || "Eliminar"; }
      if (cancelBtn) { cancelBtn.textContent = options.cancelText || "Cancelar"; }
      if (iconEl && options.icon) { iconEl.textContent = options.icon; }

      modal.hidden = false;
      if (cancelBtn) { cancelBtn.focus(); }
    });
  }

  function closeConfirmDialog(result) {
    var modal = byId("confirm-modal");
    if (modal) { modal.hidden = true; }
    if (confirmDialogState && typeof confirmDialogState.resolve === "function") {
      var resolveFn = confirmDialogState.resolve;
      confirmDialogState = null;
      resolveFn(Boolean(result));
    }
  }

  function initializeConfirmDialog() {
    var confirmBtn = byId("confirm-modal-confirm");
    var cancelBtn = byId("confirm-modal-cancel");
    var backdrop = byId("confirm-modal-backdrop");

    if (confirmBtn) {
      confirmBtn.addEventListener("click", function () { closeConfirmDialog(true); });
    }
    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () { closeConfirmDialog(false); });
    }
    if (backdrop) {
      backdrop.addEventListener("click", function () { closeConfirmDialog(false); });
    }
  }

  function deleteCalendarEvent(eventData, onDeleted) {
    showConfirmDialog({
      title: "¿Eliminar evento?",
      message: "¿Estás seguro de que deseas eliminar el evento “" + (eventData.title || "Sin título") + "”? Esta acción no se puede deshacer.",
      eyebrow: "AGENDA",
      confirmText: "Eliminar",
      cancelText: "Cancelar",
      icon: "🗑"
    }).then(function (confirmed) {
      if (!confirmed) { return; }
      var user = auth && auth.currentUser;
      if (db && apiAuthenticated && user && eventData.id) {
        var userEventRef = db.ref("users/" + user.uid + "/events/" + eventData.id);
        deleteEventWithFallback(user, userEventRef, eventData.id).then(function () {
          calendarEvents = calendarEvents.filter(function (event) { return event.id !== eventData.id; });
          renderCalendar();
          renderAgendaDay();
          renderTodayEvents();
          recordActivity("Evento eliminado: " + (eventData.title || "Evento"), "ok", formatAgendaDate(eventData.date));
          if (typeof onDeleted === "function") { onDeleted(); }
        }).catch(function (err) {
          console.error("Error al eliminar evento:", err);
          recordActivity("No se pudo eliminar el evento: " + (eventData.title || "Evento"), "error", err.message);
          addNotification("alert", "⚠", "NO SE PUDO ELIMINAR", eventData.title || "Evento", err.message);
        });
      } else {
        addNotification("alert", "⚠", "NO SE PUDO ELIMINAR", eventData.title || "Evento", "Iniciá sesión para modificar tu agenda.");
      }
    });
  }

  function eventsForDate(dateValue) {
    return calendarEvents.filter(function (ev) { return ev.date === dateValue; }).sort(function (a, b) {
      if (a.all_day !== b.all_day) { return a.all_day ? -1 : 1; }
      return String(a.start_time || "").localeCompare(String(b.start_time || ""));
    });
  }

  function loadArgentinaHolidays(year) {
    var cacheKey = "smart-panel-holidays-ar-v2-" + year;
    try {
      var cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
      if (cached && Array.isArray(cached.items) && cached.items.length && Date.now() - cached.savedAt < 7 * 86400000) {
        cached.items.forEach(function (holiday) { holidaysByDate[holiday.date] = holiday.name; });
        renderCalendar(); renderAgendaDay(); renderTodayEvents();
        return;
      }
    } catch (e) {}
    fetch("https://date.nager.at/api/v3/PublicHolidays/" + year + "/AR", { cache: "force-cache" }).then(function (response) {
      if (!response.ok) { throw new Error("HTTP " + response.status); }
      return response.json();
    }).then(function (holidays) {
      if (!Array.isArray(holidays)) { return; }
      var nationalHolidays = holidays.filter(function (holiday) { return holiday.date && holiday.localName && holiday.global === true; });
      nationalHolidays.forEach(function (holiday) {
        holidaysByDate[holiday.date] = holiday.localName;
      });
      try { localStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), items: nationalHolidays.map(function (holiday) { return { date: holiday.date, name: holiday.localName }; }) })); } catch (e) {}
      renderCalendar(); renderAgendaDay(); renderTodayEvents();
    }).catch(function (error) { console.warn("[Agenda] No se pudieron cargar los feriados nacionales:", error); });
  }

  function renderCalendar() {
    var heading = byId("calendar-month");
    var grid = byId("calendar-grid");
    if (!heading || !grid) { return; }

    var firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    var offset = (firstDay.getDay() + 6) % 7;
    var start = new Date(firstDay);
    start.setDate(firstDay.getDate() - offset);
    var today = formatDateISO(new Date());

    heading.textContent = calendarMonth.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    while (grid.firstChild) { grid.removeChild(grid.firstChild); }

    for (var i = 0; i < 42; i += 1) {
      var day = new Date(start);
      day.setDate(start.getDate() + i);
      var dayISO = formatDateISO(day);
      var events = eventsForDate(dayISO);
      var holidayName = holidaysByDate[dayISO];
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "calendar-day";

      if (day.getMonth() !== calendarMonth.getMonth()) { btn.classList.add("is-outside"); }
      if (dayISO === today) { btn.classList.add("is-today"); }
      if (dayISO === selectedAgendaDate) { btn.classList.add("is-selected"); }
      if (events.length) { btn.classList.add("has-events"); }
      if (holidayName) { btn.classList.add("has-holiday"); btn.title = holidayName; }

      btn.textContent = String(day.getDate());
      if (holidayName) { btn.setAttribute("aria-label", day.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }) + " · Feriado: " + holidayName); }
      btn.addEventListener("click", (function (d) {
        return function () {
          selectedAgendaDate = d;
          var selDate = parseISODate(d);
          if (selDate.getMonth() !== calendarMonth.getMonth() || selDate.getFullYear() !== calendarMonth.getFullYear()) {
            calendarMonth = new Date(selDate.getFullYear(), selDate.getMonth(), 1);
            loadArgentinaHolidays(calendarMonth.getFullYear());
          }
          renderCalendar();
          renderAgendaDay();
        };
      })(dayISO));

      grid.appendChild(btn);
    }
  }

  function renderAgendaDay() {
    renderEventList(selectedAgendaDate, "agenda-day-events", "agenda-day-status", true);
    var head = byId("agenda-day-heading");
    if (head) {
      head.textContent = formatAgendaDate(selectedAgendaDate, { weekday: "long", day: "numeric", month: "long" });
    }
  }

  function renderTodayEvents() {
    var today = formatDateISO(new Date());
    renderEventList(today, "today-events", "today-agenda-status", false);
  }

  function renderEventList(dateValue, listId, statusId, includeActions) {
    var list = byId(listId);
    var status = byId(statusId);
    if (!list) { return; }
    while (list.firstChild) { list.removeChild(list.firstChild); }

    var events = eventsForDate(dateValue);
    var holidayName = holidaysByDate[dateValue];
    if (status) {
      status.textContent = formatAgendaDate(dateValue, { weekday: "long", day: "numeric", month: "long" }) +
        (events.length ? " · " + events.length + (events.length === 1 ? " evento" : " eventos") : "") +
        (holidayName ? " · Feriado nacional" : "");
    }

    if (holidayName) {
      var holidayRow = createTextElement("article", "event-row holiday-row");
      holidayRow.appendChild(createTextElement("span", "event-time", "FERIADO"));
      var holidayCopy = createTextElement("div", "event-copy");
      holidayCopy.appendChild(createTextElement("strong", "holiday-title", holidayName));
      holidayCopy.appendChild(createTextElement("span", "event-end-time", "Feriado nacional de Argentina"));
      holidayRow.appendChild(holidayCopy);
      list.appendChild(holidayRow);
    }

    if (!events.length && !holidayName) {
      list.appendChild(createTextElement("p", "event-empty", "No hay eventos para esta fecha."));
      return;
    }

    events.forEach(function (ev) {
      var row = document.createElement("article");
      row.className = "event-row";
      var time = createTextElement("span", "event-time", ev.all_day ? "Todo el día" : (ev.start_time || ""));
      var copy = document.createElement("div");
      copy.className = "event-copy";
      var title = document.createElement("button");
      title.type = "button";
      title.className = "event-title";
      title.textContent = ev.title;
      title.addEventListener("click", function () { openEventForm(ev); });
      copy.appendChild(title);

      if (ev.end_time) { copy.appendChild(createTextElement("span", "event-end-time", "Hasta " + ev.end_time)); }
      if (ev.notes) { copy.appendChild(createTextElement("p", "", ev.notes)); }

      row.appendChild(time);
      row.appendChild(copy);

      if (includeActions) {
        var actions = document.createElement("div");
        actions.className = "event-actions";
        var edit = document.createElement("button");
        edit.type = "button";
        edit.className = "event-action";
        edit.textContent = "✎";
        edit.addEventListener("click", function () { openEventForm(ev); });
        var remove = document.createElement("button");
        remove.type = "button";
        remove.className = "event-action is-delete";
        remove.textContent = "×";
        remove.addEventListener("click", function () { deleteCalendarEvent(ev); });
        actions.appendChild(edit);
        actions.appendChild(remove);
        row.appendChild(actions);
      }
      list.appendChild(row);
    });
  }

  function initializeAgenda() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-open-agenda]"), function (btn) {
      btn.addEventListener("click", function () {
        selectedAgendaDate = formatDateISO(new Date());
        calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
        renderCalendar();
        renderAgendaDay();
        var tab = document.querySelector("[data-tab='agenda']");
        if (tab) { tab.click(); }
      });
    });

    byId("new-event-button").addEventListener("click", function () { openEventForm(null); });
    byId("new-event-for-day").addEventListener("click", function () { openEventForm(null); });
    byId("calendar-previous").addEventListener("click", function () {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1);
      loadArgentinaHolidays(calendarMonth.getFullYear());
      renderCalendar();
    });
    byId("calendar-next").addEventListener("click", function () {
      calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1);
      loadArgentinaHolidays(calendarMonth.getFullYear());
      renderCalendar();
    });
    byId("calendar-today").addEventListener("click", function () {
      selectedAgendaDate = formatDateISO(new Date());
      calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
      loadArgentinaHolidays(calendarMonth.getFullYear());
      renderCalendar();
      renderAgendaDay();
    });

    byId("event-form").addEventListener("submit", saveCalendarEvent);
    byId("event-form").elements.all_day.addEventListener("change", function () {
      byId("event-time-row").hidden = this.checked;
    });

    byId("event-delete").addEventListener("click", function () {
      var ev = calendarEvents.find(function (it) { return it.id === eventEditingId; });
      if (ev) {
        deleteCalendarEvent(ev, function () {
          closeEventForm();
        });
      }
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-close-event]"), function (btn) {
      btn.addEventListener("click", closeEventForm);
    });

    byId("event-modal").addEventListener("keydown", function (e) {
      if (e.key === "Escape" || e.keyCode === 27) { closeEventForm(); }
    });

    renderCalendar();
    loadArgentinaHolidays(calendarMonth.getFullYear());
    renderAgendaDay();
    renderTodayEvents();
  }

  // --- DISPOSITIVOS: LUCES, PILETA, PORTÓN ---
  function renderLights() {
    var cards = document.querySelectorAll("[data-device]");
    var count = 0;
    Array.prototype.forEach.call(cards, function (card) {
      var name = card.getAttribute("data-device");
      var isOn = state.lights[name] === true;
      var toggle = card.querySelector(".state-switch");
      card.classList.toggle("is-on", isOn);
      if (toggle) {
        toggle.setAttribute("aria-checked", isOn ? "true" : "false");
        var label = toggle.querySelector(".switch-state");
        if (label) { label.textContent = isOn ? "Encendida" : "Apagada"; }
      }
      if (isOn) { count += 1; }
    });
    byId("summary-lights").textContent = String(count);
    byId("lights-count").textContent = count + (count === 1 ? " encendida" : " encendidas");
    renderSystemStatus();
  }

  function renderPool() {
    var toggle = byId("pool-toggle");
    if (toggle) {
      toggle.setAttribute("aria-checked", state.poolOn ? "true" : "false");
      var label = toggle.querySelector(".switch-state");
      if (label) { label.textContent = state.poolOn ? "Encendido" : "Apagado"; }
    }
    byId("pool-description").textContent = state.poolOn ? "El motor está en funcionamiento (control Wi-Fi)." : "El motor está apagado.";
    byId("summary-pool").textContent = state.poolOn ? "Encendido" : "Apagado";
    renderSystemStatus();
  }

  function renderGate() {
    byId("gate-description").textContent = state.gateOpen ? "El portón está abierto." : "El portón está cerrado.";
    byId("gate-button-label").textContent = state.gateOpen ? "Cerrar portón" : "Abrir portón";
    byId("gate-button").classList.toggle("is-open", state.gateOpen);
    byId("summary-gate").textContent = state.gateOpen ? "Abierto" : "Cerrado";
    renderSystemStatus();
  }

  // --- MULTIMEDIA / TV ---
  function getSelectedTv() {
    return TV_DEVICES.find(function (tv) { return tv.id === state.tvId; }) || TV_DEVICES[0];
  }

  function getSelectedTvState() {
    var tv = getSelectedTv();
    if (!tv) { return { volume: state.volume, muted: state.muted }; }
    if (!state.tvStates[tv.id]) {
      state.tvStates[tv.id] = { volume: tv.volume || 35, muted: tv.muted === true };
    }
    return state.tvStates[tv.id];
  }

  function renderTVs() {
    var list = byId("tv-list");
    if (!list) { return; }
    while (list.firstChild) { list.removeChild(list.firstChild); }

    var selected = getSelectedTv();
    byId("tv-list-empty").hidden = TV_DEVICES.length > 0;
    byId("tv-api-status").textContent = "Control Wi-Fi vía ESP32-S3 · " + TV_DEVICES.length + " dispositivos listos";

    TV_DEVICES.forEach(function (tv) {
      var btn = document.createElement("button");
      var active = selected && tv.id === selected.id;
      btn.type = "button";
      btn.className = "tv-device" + (active ? " is-selected" : "");

      var icon = createTextElement("span", "tv-device-icon", "▣");
      var copy = document.createElement("span");
      copy.className = "tv-device-copy";
      copy.appendChild(createTextElement("strong", "", tv.name));
      copy.appendChild(createTextElement("span", "", tv.room + " · " + tv.model + (tv.ip ? " (" + tv.ip + ")" : "")));

      var power = createTextElement("span", "tv-power-state", tv.poweredOn ? "Encendida" : "Apagada");
      power.classList.add(tv.poweredOn ? "is-on" : "is-off");
      copy.appendChild(power);

      var check = createTextElement("span", "tv-device-check", active ? "●" : "");

      btn.appendChild(icon);
      btn.appendChild(copy);
      btn.appendChild(check);

      btn.addEventListener("click", function () {
        state.tvId = tv.id;
        saveState();
        renderTVs();
        renderMedia();
      });

      list.appendChild(btn);
    });

    byId("tv-control").hidden = !selected;
    if (selected) {
      byId("selected-tv-name").textContent = selected.name;
      byId("selected-tv-location").textContent = selected.room + " · " + selected.model + " · " + (selected.ip || "Wi-Fi LAN");
      byId("selected-tv-power").textContent = selected.poweredOn ? "Encendida" : "Apagada";
      byId("selected-tv-dot").classList.toggle("is-off", !selected.poweredOn);
      byId("selected-tv-dot").classList.remove("is-unknown");
      byId("tv-power-label").textContent = selected.poweredOn ? "Apagar" : "Encender";
      byId("tv-power-button").disabled = false;
      byId("tv-power-hint").hidden = true;
      byId("tv-pairing-panel").hidden = true;

      Array.prototype.forEach.call(document.querySelectorAll("[data-remote-key]"), function (b) {
        b.disabled = false;
      });
      byId("remote-key-hint").textContent = "Comandos Wi-Fi / IR listos para enviar al ESP32.";
    }
  }

  function renderMedia() {
    var tvState = getSelectedTvState();
    byId("volume-value").textContent = tvState.muted ? "--" : tvState.volume + "%";
    byId("volume-slider").value = String(tvState.volume);
    byId("volume-slider").style.setProperty("--volume-level", tvState.volume + "%");
    byId("mute-button").setAttribute("aria-pressed", tvState.muted ? "true" : "false");
    byId("mute-button").classList.toggle("is-muted", tvState.muted);
  }

  // --- CÁMARAS IP ---
  function renderCameraCard(camera, index) {
    var card = document.createElement("article");
    card.className = "camera-card panel-surface";
    var preview = document.createElement("div");
    preview.className = "camera-preview";

    var image = document.createElement("img");
    image.className = "camera-stream";
    image.alt = "Vista de " + camera.name;
    image.hidden = true;

    var message = createTextElement("span", "camera-stream-message", "Conectando stream...");
    var glyph = createTextElement("span", "camera-glyph", "▧");
    var tag = createTextElement("span", "camera-tag", "CÁMARA IP");

    image.onload = function () {
      image.hidden = false;
      glyph.hidden = true;
      message.hidden = true;
    };
    image.onerror = function () {
      glyph.hidden = false;
      message.hidden = false;
      message.textContent = "Sin señal stream MJPEG.";
    };
    image.src = camera.streamUrl;

    preview.appendChild(image);
    preview.appendChild(glyph);
    preview.appendChild(message);
    preview.appendChild(tag);

    var caption = document.createElement("div");
    caption.className = "camera-caption";
    var copy = document.createElement("div");
    copy.appendChild(createTextElement("h3", "", camera.name));
    copy.appendChild(createTextElement("p", "", camera.streamUrl.replace(/^https?:\/\//i, "").split("/")[0]));
    copy.appendChild(createTextElement("span", "camera-type-tag", "Stream Wi-Fi / LAN"));
    caption.appendChild(copy);

    var actions = document.createElement("div");
    actions.className = "camera-actions";
    actions.appendChild(createTextElement("span", "camera-number", String(index + 1).padStart(2, "0")));
    var remove = document.createElement("button");
    remove.type = "button";
    remove.className = "camera-remove";
    remove.textContent = "×";
    remove.addEventListener("click", function () {
      showConfirmDialog({
        title: "¿Eliminar cámara?",
        message: "¿Estás seguro de que deseas eliminar la cámara “" + camera.name + "”? Dejará de mostrarse en este panel.",
        eyebrow: "SEGURIDAD",
        confirmText: "Eliminar",
        cancelText: "Cancelar",
        icon: "📷"
      }).then(function (confirmed) {
        if (!confirmed) { return; }
        state.cameras = state.cameras.filter(function (c) { return c.id !== camera.id; });
        saveState();
        renderCameras();
      });
    });
    actions.appendChild(remove);
    caption.appendChild(actions);

    card.appendChild(preview);
    card.appendChild(caption);
    return card;
  }

  function renderCameras() {
    var grid = byId("camera-grid");
    if (!grid) { return; }
    while (grid.firstChild) { grid.removeChild(grid.firstChild); }
    byId("camera-empty").hidden = state.cameras.length > 0;
    grid.hidden = state.cameras.length === 0;
    state.cameras.forEach(function (cam, idx) {
      grid.appendChild(renderCameraCard(cam, idx));
    });
  }

  function initializeCameraForm() {
    var form = byId("camera-form");
    Array.prototype.forEach.call(document.querySelectorAll("[data-open-camera-form]"), function (b) {
      b.addEventListener("click", function () {
        byId("camera-modal").hidden = false;
        byId("camera-form-error").hidden = true;
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-close-camera-form]"), function (b) {
      b.addEventListener("click", function () {
        byId("camera-modal").hidden = true;
        form.reset();
      });
    });
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = form.elements.cameraName.value.trim();
      var url = form.elements.cameraUrl.value.trim();
      var user = form.elements.cameraUser ? form.elements.cameraUser.value.trim() : "";
      var pass = form.elements.cameraPassword ? form.elements.cameraPassword.value : "";
      if (!name || !url) {
        byId("camera-form-error").textContent = "Completa el nombre y la dirección del stream.";
        byId("camera-form-error").hidden = false;
        return;
      }
      var camId = "cam-" + Date.now();
      if (user || pass) {
        cameraCredentials[camId] = { user: user, pass: pass };
      }
      state.cameras.push({ id: camId, name: name, streamUrl: url });
      saveState();
      renderCameras();
      byId("camera-modal").hidden = true;
      form.reset();
    });
  }

  // --- CONTROLES Y EVENT LISTENERS ---
  function initializeControls() {
    // Luces
    var lightCards = document.querySelectorAll("[data-device]");
    Array.prototype.forEach.call(lightCards, function (card) {
      var btn = card.querySelector(".state-switch");
      if (btn) {
        btn.addEventListener("click", function () {
          var name = card.getAttribute("data-device");
          sendLightCommand(name, !state.lights[name]);
        });
      }
    });

    // Pileta
    byId("pool-toggle").addEventListener("click", function () {
      sendPoolCommand(!state.poolOn);
    });

    // Portón
    byId("gate-button").addEventListener("click", function () {
      sendGateCommand(!state.gateOpen);
    });

    // Slider de volumen
    var slider = byId("volume-slider");
    slider.addEventListener("input", function () {
      var val = Number(this.value);
      var tvState = getSelectedTvState();
      tvState.volume = val;
      tvState.muted = false;
      renderMedia();

      if (volumeCommandTimer) { clearTimeout(volumeCommandTimer); }
      volumeCommandTimer = setTimeout(function () {
        sendTVCommand("set_volume", val);
      }, 200);
    });

    slider.addEventListener("change", function () {
      if (volumeCommandTimer) { clearTimeout(volumeCommandTimer); }
      sendTVCommand("set_volume", Number(this.value));
    });

    // Mute
    byId("mute-button").addEventListener("click", function () {
      sendTVCommand("toggle_mute", null);
    });

    // Power TV
    byId("tv-power-button").addEventListener("click", function () {
      sendTVCommand("power", null);
    });

    // Apps TV
    Array.prototype.forEach.call(document.querySelectorAll("[data-app]"), function (btn) {
      btn.addEventListener("click", function () {
        sendTVCommand("launch_app", this.getAttribute("data-app"));
      });
    });

    // Teclas de control remoto
    Array.prototype.forEach.call(document.querySelectorAll("[data-remote-key]"), function (btn) {
      btn.addEventListener("click", function () {
        sendTVCommand("remote_key", this.getAttribute("data-remote-key"));
      });
    });

    // BUG-04: Pairing TV
    var pairingForm = byId("tv-pairing-form");
    if (pairingForm) {
      pairingForm.addEventListener("submit", function (e) {
        e.preventDefault();
        var code = (byId("tv-pairing-code").value || "").trim().toUpperCase();
        if (code.length === 6) {
          sendTVCommand("pair", code);
          byId("tv-pairing-panel").hidden = true;
          byId("tv-pairing-code").value = "";
          byId("media-feedback").textContent = "Código de vinculación enviado al televisor.";
        } else {
          alert("Ingresa un código de emparejamiento válido de 6 caracteres.");
        }
      });
    }
    var pairingCancel = byId("tv-pairing-cancel");
    if (pairingCancel) {
      pairingCancel.addEventListener("click", function () {
        byId("tv-pairing-panel").hidden = true;
      });
    }

    // A11Y-02: Cerrar modales con tecla Escape
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var confirmModal = byId("confirm-modal");
        if (confirmModal && !confirmModal.hidden) {
          closeConfirmDialog(false);
          return;
        }
        var cameraModal = byId("camera-modal");
        var eventModal = byId("event-modal");
        if (cameraModal && !cameraModal.hidden) {
          cameraModal.hidden = true;
          byId("camera-form").reset();
        }
        if (eventModal && !eventModal.hidden) {
          eventModal.hidden = true;
          byId("event-form").reset();
        }
      }
    });
  }

  function initializeTabs() {
    var tabs = document.querySelectorAll("[data-tab]");
    var panels = document.querySelectorAll("[data-panel]");
    var tabArray = Array.prototype.slice.call(tabs);

    function activate(name) {
      for (var i = 0; i < tabs.length; i += 1) {
        var act = tabs[i].getAttribute("data-tab") === name;
        tabs[i].classList.toggle("is-active", act);
        tabs[i].setAttribute("aria-selected", act ? "true" : "false");
        tabs[i].setAttribute("tabindex", act ? "0" : "-1");
      }
      for (var j = 0; j < panels.length; j += 1) {
        var vis = panels[j].getAttribute("data-panel") === name;
        panels[j].classList.toggle("is-visible", vis);
        panels[j].hidden = !vis;
      }
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", "#" + name);
      }
    }

    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener("click", function () {
        activate(this.getAttribute("data-tab"));
        this.focus();
      });
    });

    // A11Y-01: Navegación por flechas de teclado (ARIA Tabs pattern)
    var tabBar = document.querySelector(".tab-bar");
    if (tabBar) {
      tabBar.addEventListener("keydown", function (e) {
        var idx = tabArray.indexOf(document.activeElement);
        if (idx === -1) { return; }
        var next = -1;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") {
          next = (idx + 1) % tabArray.length;
        } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
          next = (idx - 1 + tabArray.length) % tabArray.length;
        } else if (e.key === "Home") {
          next = 0;
        } else if (e.key === "End") {
          next = tabArray.length - 1;
        }
        if (next !== -1) {
          e.preventDefault();
          tabArray[next].focus();
          activate(tabArray[next].getAttribute("data-tab"));
        }
      });
    }

    var hash = (window.location.hash || "").replace("#", "");
    activate(hash || "inicio");
  }

  // PERF-03: Actualizar reloj cada segundo; date-line solo cuando cambia el día
  // UX-02: Saludo dinámico según la hora del día
  function updateClock() {
    var now = new Date();
    var h = String(now.getHours()).padStart(2, "0");
    var m = String(now.getMinutes()).padStart(2, "0");
    var timeStr = h + ":" + m;
    byId("clock").textContent = timeStr;
    byId("footer-time").textContent = timeStr;

    var todayISO = formatDateISO(now);
    if (todayISO !== lastRenderedDay) {
      lastRenderedDay = todayISO;
      byId("date-line").textContent = now.toLocaleDateString("es-AR", {
        weekday: "long", day: "numeric", month: "long", year: "numeric"
      });
    }

    // Saludo dinámico
    var hour = now.getHours();
    var greeting = hour < 12 ? "Buen día" : hour < 20 ? "Buenas tardes" : "Buenas noches";
    var greetingEl = byId("greeting-text");
    if (greetingEl && greetingEl.textContent !== greeting) {
      greetingEl.textContent = greeting;
    }
  }


  function setPushButtonState(stateName, label, detail) {
    var button = byId("push-enable");
    if (!button) { return; }
    button.dataset.pushState = stateName;
    button.textContent = label;
    button.setAttribute("aria-label", label);
    button.title = detail || label;
  }

  function pushRegistrationKey(uid) {
    return "smart-panel-push-registered-v1-" + uid;
  }

  function isAppleMobileDevice() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "") ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  }

  function isInstalledWebApp() {
    return navigator.standalone === true || !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
  }

  function syncPushButtonForUser(user) {
    var button = byId("push-enable");
    if (!button) { return; }
    button.hidden = false;
    if (!user) { return; }
    try {
      if (window.localStorage.getItem(pushRegistrationKey(user.uid)) === "1") {
        button.hidden = true;
        clearStalePushErrors();
      }
    } catch (error) {
      console.warn("[FCM] No se pudo recuperar el estado local del dispositivo registrado.", error);
    }
  }

  function subscriptionUsesVapidKey(subscription, vapidKey) {
    try {
      var encoded = vapidKey.replace(/-/g, "+").replace(/_/g, "/");
      while (encoded.length % 4) { encoded += "="; }
      var decoded = atob(encoded);
      var expected = new Uint8Array(decoded.length);
      for (var i = 0; i < decoded.length; i++) { expected[i] = decoded.charCodeAt(i); }
      var currentKey = subscription && subscription.options && subscription.options.applicationServerKey;
      if (!currentKey) { return false; }
      var actual = currentKey instanceof ArrayBuffer
        ? new Uint8Array(currentKey)
        : new Uint8Array(currentKey.buffer, currentKey.byteOffset, currentKey.byteLength);
      if (actual.length !== expected.length) { return false; }
      for (var j = 0; j < expected.length; j++) {
        if (actual[j] !== expected[j]) { return false; }
      }
      return true;
    } catch (error) {
      console.warn("[FCM] No se pudo verificar la clave de la suscripción Push actual.", error);
      return false;
    }
  }

  async function getFcmTokenWithRecovery(messaging, registration, vapidKey) {
    try {
      return await messaging.getToken({ vapidKey: vapidKey, serviceWorkerRegistration: registration });
    } catch (firstError) {
      // Preserve a working browser subscription on transient FCM failures.
      // A mismatched VAPID subscription is already removed by the caller.
      console.warn("[FCM] Falló el primer registro; se conserva la suscripción actual y se reintenta.", firstError);
      await new Promise(function (resolve) { setTimeout(resolve, 800); });
      try {
        return await messaging.getToken({ vapidKey: vapidKey, serviceWorkerRegistration: registration });
      } catch (retryError) {
        retryError.firstRegistrationError = firstError && (firstError.code || firstError.message);
        throw retryError;
      }
    }
  }

  function initializePWA() {
    var installButton = byId("pwa-install");
    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredInstallPrompt = e;
      if (installButton) { installButton.hidden = false; }
    });
    if (installButton) {
      installButton.addEventListener("click", function () {
        if (deferredInstallPrompt) {
          deferredInstallPrompt.prompt();
          deferredInstallPrompt = null;
        } else {
          byId("pwa-install-dialog").hidden = false;
        }
      });
    }

    if (!("serviceWorker" in navigator)) {
      setPushButtonState("unsupported", "Push no disponible", "Este navegador no admite Service Workers.");
      return;
    }

    // Bind the control immediately so a fast first click is not lost while the
    // Service Worker is still installing.
    initializePushNotifications();
    pushWorkerPromise = navigator.serviceWorker.register("/service-worker.js?v=60").then(function (reg) {
      pushWorkerRegistration = reg;
      reg.update().catch(function () {});
      return reg;
    }).catch(function (error) {
      console.error("[PWA] No se pudo registrar el Service Worker:", error);
      setPushButtonState("error", "Error del worker", error.message || String(error));
      return null;
    });
  }

  // Ask permission only after an explicit user gesture.
  function initializePushNotifications() {
    var button = byId("push-enable");
    if (!button || button.dataset.pushBound === "true") { return; }
    button.dataset.pushBound = "true";

    if (!window.Notification || !navigator.serviceWorker || !firebase.messaging) {
      if (isAppleMobileDevice() && !isInstalledWebApp()) {
        var iosHelp = "En iPad, abre esta web desde su icono en la pantalla de inicio. Web Push requiere iPadOS 16.4 o posterior.";
        setPushButtonState("unsupported", "Agregar a inicio", iosHelp);
        button.addEventListener("click", function () {
          var installDialog = byId("pwa-install-dialog");
          if (installDialog) { installDialog.hidden = false; }
        });
      } else {
        setPushButtonState("unsupported", "Push no disponible", "Este navegador no admite notificaciones web push.");
      }
      return;
    }
    if (Notification.permission === "denied") {
      setPushButtonState("blocked", "Avisos bloqueados", "Cambia el permiso de notificaciones en los ajustes del sitio.");
    } else if (Notification.permission === "granted") {
      setPushButtonState("ready", "Revisar avisos", "Verifica y completa el registro Push de este navegador en tu cuenta.");
    } else {
      setPushButtonState("idle", "Activar avisos", "Activa avisos nativos en este dispositivo.");
    }

    button.addEventListener("click", async function () {
      if (button.dataset.pushBusy === "true") { return; }
      if (!auth || !auth.currentUser || !db) {
        setPushButtonState("error", "Inicia sesion primero", "Inicia sesion en Smart Panel y vuelve a activar los avisos.");
        addNotification("alert", "\uD83D\uDD14", "NOTIFICACIONES", "Inicia sesion primero", "Los avisos se asocian a tu cuenta para sincronizar tus dispositivos.");
        return;
      }

      button.dataset.pushBusy = "true";
      button.disabled = true;
      setPushButtonState("loading", "Activando...", "Solicitando permiso y registrando este dispositivo.");
      try {
        if (Notification.permission === "denied") {
          throw new Error("El permiso esta bloqueado. Abre los ajustes del sitio en el navegador y permite Notificaciones.");
        }
        // Call requestPermission before any await so browsers still recognize
        // the current click as a user gesture.
        var permission = Notification.permission;
        if (permission !== "granted") { permission = await Notification.requestPermission(); }
        if (permission !== "granted") {
          setPushButtonState("blocked", "Permiso no concedido", "Permite las notificaciones del sitio desde los ajustes del navegador.");
          addNotification("alert", "\uD83D\uDD14", "PERMISO DE NOTIFICACIONES", "No se concedio el permiso", "Puedes activarlo mas tarde desde los ajustes del sitio.");
          return;
        }
        if (!firebase.messaging || !(await firebase.messaging.isSupported())) {
          throw new Error("Este navegador o dispositivo no es compatible con Firebase Web Push.");
        }

        var config = window.SMART_PANEL_FIREBASE_CONFIG || {};
        if (!config.vapidKey) { throw new Error("Falta la clave Web Push de Firebase (VAPID)."); }
        var registration = await withTimeout(
          pushWorkerRegistration || (pushWorkerPromise ? pushWorkerPromise : navigator.serviceWorker.ready),
          12000,
          "El Service Worker tardó demasiado en activarse. Recarga la página y vuelve a intentar."
        );
        if (!registration) { throw new Error("No se pudo iniciar el Service Worker de notificaciones."); }
        pushWorkerRegistration = registration;
        var messaging = firebase.messaging();
        // If the browser's Push service rejected the previous subscription,
        // the next deliberate retry repairs this origin's local FCM state.
        if (button.dataset.pushRepair === "true") {
          console.info("[FCM] Renovando la suscripción Push local de este navegador.");
          try {
            await withTimeout(messaging.deleteToken(), 8000, "No se pudo limpiar el token Push anterior.");
          } catch (deleteError) {
            console.warn("[FCM] El SDK no pudo borrar el token anterior; se limpiará la suscripción local.", deleteError);
          }
          var subscriptionToRepair = await registration.pushManager.getSubscription();
          if (subscriptionToRepair) {
            var unsubscribed = await subscriptionToRepair.unsubscribe();
            if (!unsubscribed) { throw new Error("El navegador no permitió renovar su suscripción Push. Borra los datos del sitio y vuelve a intentar."); }
          }
          button.dataset.pushRepair = "false";
        }
        var existingSubscription = await registration.pushManager.getSubscription();
        if (existingSubscription && !subscriptionUsesVapidKey(existingSubscription, config.vapidKey)) {
          console.info("[FCM] Eliminando la suscripción Push anterior, creada con otra clave VAPID.");
          try {
            await messaging.deleteToken();
          } catch (deleteError) {
            console.warn("[FCM] No se pudo borrar el token FCM previo; se eliminará la suscripción local.", deleteError);
            var staleSubscription = await registration.pushManager.getSubscription();
            if (staleSubscription) { await staleSubscription.unsubscribe(); }
          }
        }
        var token = await withTimeout(
          getFcmTokenWithRecovery(messaging, registration, config.vapidKey),
          25000,
          "El navegador no completó el registro Push en 25 segundos. Revisa el permiso del sitio y la conexión del navegador."
        );
        if (!token) { throw new Error("Firebase no devolvio un token para este dispositivo."); }

        var currentUser = auth.currentUser;
        var tokenKey = encodeURIComponent(token);
        await withTimeout(savePushTokenWithFallback(currentUser, db.ref("pushTokens/" + currentUser.uid + "/" + tokenKey), tokenKey, {
          token: token,
          updatedAt: Date.now(),
          platform: navigator.userAgent
        }), 15000, "No se pudo guardar el dispositivo en 15 segundos, ni por Realtime Database ni por HTTPS.");

        if (!foregroundMessageBound) {
          foregroundMessageBound = true;
          messaging.onMessage(function (payload) {
            var data = payload.notification || payload.data || {};
            var title = data.title || "Smart Panel";
            var body = data.body || "Tienes una actualizacion.";
            addNotification("agenda", "\uD83D\uDD14", "AVISO PUSH", title, body, true);
          });
        }
        setPushButtonState("active", "Dispositivo listo", "Permiso y registro FCM confirmados en este dispositivo.");
        button.dataset.pushRepair = "false";
        try { window.localStorage.setItem(pushRegistrationKey(currentUser.uid), "1"); } catch (storageError) {
          console.warn("[FCM] El dispositivo quedó registrado, pero no se pudo guardar el estado local de la UI.", storageError);
        }
        clearStalePushErrors();
        addNotification("important", "\uD83D\uDD14", "NOTIFICACIONES", "Dispositivo registrado", "Este navegador quedó asociado a tu cuenta.");
        button.hidden = true;
      } catch (error) {
        console.error("[FCM] No se pudo activar push:", error);
        var detail = error.code ? error.code + ": " + error.message : error.message || String(error);
        var pushServiceRejected = error.name === "AbortError" && /push service|permission denied/i.test(error.message || "");
        if (pushServiceRejected) {
          button.dataset.pushRepair = "true";
          setPushButtonState("error", "Reparar avisos", "Pulsa para renovar la suscripción Push local de este navegador.");
          detail = "El permiso del sitio está concedido, pero el navegador rechazó su suscripción Push. Pulsa «Reparar avisos» para renovar el registro local; si vuelve a fallar, el navegador o la red está bloqueando su servicio Push.";
        } else {
          button.dataset.pushRepair = "false";
        }
        var blocked = Notification.permission === "denied";
        if (!pushServiceRejected) { setPushButtonState(blocked ? "blocked" : "error", blocked ? "Avisos bloqueados" : "Reintentar avisos", detail); }
        addNotification("alert", "\uD83D\uDD14", "ERROR DE NOTIFICACIONES", "No se pudieron activar los avisos", detail);
      } finally {
        button.disabled = false;
        button.dataset.pushBusy = "false";
      }
    });
  }

  // =====================================================================
  //  SISTEMA DE NOTIFICACIONES IN-APP
  //  - Tipos: "agenda" (eventos), "important" (pileta, etc.), "alert"
  //  - Toasts auto-dismiss + Panel lateral persistente
  // =====================================================================

  var NOTIF_STORAGE_KEY = "smart-panel-notifs-v1";
  var AGENDA_NOTIF_SENT_KEY = "smart-panel-agenda-notif-v1";
  var notifications = [];

  function loadNotifications() {
    try {
      var saved = window.localStorage.getItem(NOTIF_STORAGE_KEY);
      if (saved) { notifications = JSON.parse(saved) || []; }
    } catch (e) { notifications = []; }
  }

  function saveNotifications() {
    try { window.localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notifications)); } catch (e) {}
  }

  function showNativeNotification(title, body, url, tag) {
    if (!window.Notification || Notification.permission !== "granted") { return Promise.resolve(false); }
    var options = {
      body: body || "Tienes una actualizacion.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: tag || "smart-panel-" + Date.now(),
      data: { url: url || "/#agenda" }
    };
    if (pushWorkerRegistration) {
      return pushWorkerRegistration.showNotification(title || "Smart Panel", options).then(function () { return true; }).catch(function (error) {
        console.warn("[Notificaciones] No se pudo mostrar la notificacion del sistema:", error);
        return false;
      });
    } else {
      try { new Notification(title || "Smart Panel", options); return Promise.resolve(true); }
      catch (error) { console.warn("[Notificaciones] API nativa no disponible:", error); return Promise.resolve(false); }
    }
  }

  function addNotification(type, icon, label, title, body, nativeNotification) {
    var notif = {
      id: "n-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
      type: type,     // 'agenda' | 'important' | 'alert'
      icon: icon,
      label: label,
      title: title,
      body: body,
      ts: Date.now(),
      read: false
    };
    notifications.unshift(notif);
    if (notifications.length > 60) { notifications = notifications.slice(0, 60); }
    saveNotifications();
    updateNotifBadge();
    renderNotifPanel();
    showToast(notif);
    if (nativeNotification || (document.visibilityState === "hidden" && type !== "alert")) {
      showNativeNotification(title, body, "/#agenda", notif.id);
    }
    return notif;
  }

  function markAllRead() {
    notifications.forEach(function (n) { n.read = true; });
    saveNotifications();
    updateNotifBadge();
  }

  function dismissNotif(id) {
    notifications = notifications.filter(function (n) { return n.id !== id; });
    saveNotifications();
    updateNotifBadge();
    renderNotifPanel();
  }

  function clearAllNotifs() {
    notifications = [];
    saveNotifications();
    updateNotifBadge();
    renderNotifPanel();
  }

  function updateNotifBadge() {
    var badge = byId("notif-bell-badge");
    if (!badge) { return; }
    var unread = notifications.filter(function (n) { return !n.read; }).length;
    badge.classList.toggle("has-unread", unread > 0);
    var bell = byId("notif-bell");
    if (bell) { bell.setAttribute("aria-label", unread ? "Notificaciones, " + unread + " sin leer" : "Notificaciones"); }
    var clearButton = byId("notif-clear-btn");
    if (clearButton) { clearButton.disabled = notifications.length === 0; }
  }

  // ---- Toast ----
  var activeToasts = {};

  function showToast(notif, durationMs) {
    var dur = durationMs || 7000;
    var container = byId("notif-toast-container");
    if (!container) { return; }

    var toast = document.createElement("div");
    toast.className = "notif-toast notif-" + notif.type;
    toast.setAttribute("role", "status");
    toast.title = "Abrir notificaciones";

    var iconEl = createTextElement("span", "notif-toast-icon", notif.icon);
    var content = document.createElement("div");
    content.className = "notif-toast-content";
    content.appendChild(createTextElement("span", "notif-toast-label", notif.label));
    content.appendChild(createTextElement("span", "notif-toast-title", notif.title));
    if (notif.body) { content.appendChild(createTextElement("span", "notif-toast-body", notif.body)); }

    var closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "notif-toast-close";
    closeBtn.textContent = "×";
    closeBtn.setAttribute("aria-label", "Cerrar notificación");

    var bar = document.createElement("span");
    bar.className = "notif-toast-bar";
    bar.style.animationDuration = dur + "ms";

    toast.appendChild(iconEl);
    toast.appendChild(content);
    toast.appendChild(closeBtn);
    toast.appendChild(bar);
    container.appendChild(toast);

    var timer = setTimeout(function () { dismissToast(toast); }, dur);
    activeToasts[notif.id] = { el: toast, timer: timer };

    closeBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      clearTimeout(timer);
      dismissToast(toast);
    });
    toast.addEventListener("click", function () {
      clearTimeout(timer);
      dismissToast(toast);
      openNotifPanel();
    });
  }

  function dismissToast(toast) {
    if (!toast.parentNode) { return; }
    toast.classList.add("is-leaving");
    setTimeout(function () {
      if (toast.parentNode) { toast.parentNode.removeChild(toast); }
    }, 280);
  }

  // ---- Panel lateral ----
  function openNotifPanel() {
    var panel = byId("notif-panel");
    var backdrop = byId("notif-panel-backdrop");
    if (!panel) { return; }
    panel.classList.add("is-open");
    panel.setAttribute("aria-hidden", "false");
    panel.inert = false;
    document.body.classList.add("notifications-open");
    var appShell = document.querySelector(".app-shell");
    if (appShell) { appShell.inert = true; appShell.setAttribute("aria-hidden", "true"); }
    if (backdrop) { backdrop.classList.add("is-visible"); }
    markAllRead();
    renderNotifPanel();
    var closeButton = byId("notif-panel-close");
    if (closeButton) { closeButton.focus(); }
  }

  function closeNotifPanel() {
    var panel = byId("notif-panel");
    var backdrop = byId("notif-panel-backdrop");
    if (panel) { panel.classList.remove("is-open"); }
    if (panel) { panel.setAttribute("aria-hidden", "true"); panel.inert = true; }
    document.body.classList.remove("notifications-open");
    var appShell = document.querySelector(".app-shell");
    if (appShell) { appShell.inert = false; appShell.removeAttribute("aria-hidden"); }
    if (backdrop) { backdrop.classList.remove("is-visible"); }
    var bell = byId("notif-bell");
    if (bell) { bell.focus(); }
  }

  function renderNotifPanel() {
    var list = byId("notif-panel-list");
    if (!list) { return; }
    while (list.firstChild) { list.removeChild(list.firstChild); }

    if (!notifications.length) {
      var empty = document.createElement("div");
      empty.className = "notif-empty";
      empty.innerHTML = '<span class="notif-empty-icon" aria-hidden="true">\uD83D\uDD14</span><p>No hay notificaciones por ahora.<br>Los avisos de agenda y pileta<br>aparecerán aquí.</p>';
      list.appendChild(empty);
      return;
    }

    notifications.forEach(function (n) {
      var item = document.createElement("div");
      item.className = "notif-item notif-" + n.type + (n.read ? "" : " is-unread");

      var icon = createTextElement("span", "notif-item-icon", n.icon);
      var content = document.createElement("div");
      content.className = "notif-item-content";
      content.appendChild(createTextElement("span", "notif-item-label", n.label));
      content.appendChild(createTextElement("span", "notif-item-title", n.title));
      if (n.body) { content.appendChild(createTextElement("span", "notif-item-body", n.body)); }

      var timeAgo = formatTimeAgo(n.ts);
      content.appendChild(createTextElement("span", "notif-item-time", timeAgo));

      var dismiss = document.createElement("button");
      dismiss.type = "button";
      dismiss.className = "notif-item-dismiss";
      dismiss.textContent = "×";
      dismiss.setAttribute("aria-label", "Descartar notificación");
      dismiss.addEventListener("click", (function (id) {
        return function () { dismissNotif(id); };
      })(n.id));

      item.appendChild(icon);
      item.appendChild(content);
      item.appendChild(dismiss);
      list.appendChild(item);
    });
  }

  function formatTimeAgo(ts) {
    var diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 60) { return "Hace un momento"; }
    if (diff < 3600) { return "Hace " + Math.floor(diff / 60) + " min"; }
    if (diff < 86400) { return "Hace " + Math.floor(diff / 3600) + " h"; }
    return "Hace " + Math.floor(diff / 86400) + " d";
  }

  function initNotifPanel() {
    loadNotifications();
    updateNotifBadge();
    renderNotifPanel();

    var bell = byId("notif-bell");
    if (bell) { bell.addEventListener("click", openNotifPanel); }

    var closeBtn = byId("notif-panel-close");
    if (closeBtn) { closeBtn.addEventListener("click", closeNotifPanel); }

    var clearBtn = byId("notif-clear-btn");
    if (clearBtn) { clearBtn.addEventListener("click", function () { clearAllNotifs(); }); }

    var backdrop = byId("notif-panel-backdrop");
    if (backdrop) { backdrop.addEventListener("click", closeNotifPanel); }

    // Cerrar panel con Escape
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        var panel = byId("notif-panel");
        if (panel && panel.classList.contains("is-open")) {
          closeNotifPanel();
        }
      } else if (e.key === "Tab") {
        var openPanel = byId("notif-panel");
        if (!openPanel || !openPanel.classList.contains("is-open")) { return; }
        var focusable = openPanel.querySelectorAll("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])");
        if (!focusable.length) { e.preventDefault(); return; }
        var first = focusable[0];
        var last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    });
  }

  // =====================================================================
  //  NOTIFICACIONES DE AGENDA
  //  - 1 día antes (a las 09:00 del día previo)
  //  - El mismo día (a las 07:00)
  // =====================================================================

  var agendaNotifSent = {};

  function loadAgendaNotifSent() {
    try {
      var saved = window.localStorage.getItem(AGENDA_NOTIF_SENT_KEY);
      if (saved) { agendaNotifSent = JSON.parse(saved) || {}; }
    } catch (e) { agendaNotifSent = {}; }
  }

  function saveAgendaNotifSent() {
    try { window.localStorage.setItem(AGENDA_NOTIF_SENT_KEY, JSON.stringify(agendaNotifSent)); } catch (e) {}
  }

  function checkAgendaNotifications() {
    if (!calendarEvents.length) { return; }
    var now = new Date();
    var todayISO = formatDateISO(now);
    var tomorrowDate = new Date(now);
    tomorrowDate.setDate(now.getDate() + 1);
    var tomorrowISO = formatDateISO(tomorrowDate);
    var hour = now.getHours();

    // Limpiar enviados de más de 2 días
    var cutoff = formatDateISO(new Date(now.getTime() - 2 * 86400000));
    Object.keys(agendaNotifSent).forEach(function (k) {
      if (k < cutoff) { delete agendaNotifSent[k]; }
    });

    calendarEvents.forEach(function (ev) {
      if (!ev.date || !ev.title) { return; }

      // Notificación 1 DÍA ANTES (se envía cuando ya son las 09:00 del día previo)
      if (ev.date === tomorrowISO && hour >= 9) {
        var keyBefore = "before-" + ev.id;
        if (!agendaNotifSent[keyBefore]) {
          agendaNotifSent[keyBefore] = true;
          saveAgendaNotifSent();
          var timeStr = !ev.all_day && ev.start_time ? " a las " + ev.start_time : " (todo el día)";
          var desc = ev.notes ? ev.notes.split("\n")[0].slice(0, 60) : "";
          addNotification(
            "agenda",
            "📅",
            "AGENDA · MAÑANA",
            ev.title,
            "Mañana" + timeStr + (desc ? " · " + desc : ""),
            true
          );
        }
      }

      // Notificación EL MISMO DÍA (07:00 o cuando se carga la app)
      if (ev.date === todayISO) {
        var keyToday = "today-" + ev.id;
        if (!agendaNotifSent[keyToday]) {
          agendaNotifSent[keyToday] = true;
          saveAgendaNotifSent();
          var timeStrToday = !ev.all_day && ev.start_time ? " a las " + ev.start_time : " (todo el día)";
          var descToday = ev.notes ? ev.notes.split("\n")[0].slice(0, 60) : "";
          addNotification(
            "agenda",
            "📅",
            "AGENDA · HOY",
            ev.title,
            "Hoy" + timeStrToday + (descToday ? " · " + descToday : ""),
            true
          );
        }
      }
    });
    saveAgendaNotifSent();
  }

  // =====================================================================
  //  SISTEMA DE HORARIOS DE PILETA
  //  Guarda franjas horarias en localStorage y envía comandos automáticamente
  // =====================================================================

  var POOL_SCHEDULE_KEY = "smart-panel-pool-schedule-v1";
  var poolSchedules = [];
  var poolScheduleTimer = null;
  var lastPoolScheduleState = null;

  function loadPoolSchedules() {
    try {
      var saved = window.localStorage.getItem(POOL_SCHEDULE_KEY);
      if (saved) { poolSchedules = JSON.parse(saved) || []; }
    } catch (e) { poolSchedules = []; }
  }

  function savePoolSchedules() {
    try { window.localStorage.setItem(POOL_SCHEDULE_KEY, JSON.stringify(poolSchedules)); } catch (e) {}
  }

  function renderPoolSchedules() {
    var list = byId("pool-schedule-list");
    var status = byId("pool-schedule-status");
    if (!list) { return; }
    while (list.firstChild) { list.removeChild(list.firstChild); }

    var active = poolSchedules.filter(function (s) { return s.enabled; });
    if (status) {
      status.hidden = poolSchedules.length > 0;
    }

    poolSchedules.forEach(function (sch, idx) {
      var item = document.createElement("div");
      item.className = "pool-schedule-item" + (sch.enabled ? " is-active" : "");

      var times = document.createElement("div");
      times.className = "pool-schedule-times";
      times.appendChild(createTextElement("strong", "", sch.start + " → " + sch.end));
      times.appendChild(createTextElement("span", "", sch.enabled ? "Activo" : "Inactivo"));

      var toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "state-switch pool-schedule-toggle";
      toggle.setAttribute("role", "switch");
      toggle.setAttribute("aria-checked", sch.enabled ? "true" : "false");
      toggle.setAttribute("aria-label", "Activar horario");
      var track = document.createElement("span");
      track.className = "switch-track";
      var thumb = document.createElement("span");
      thumb.className = "switch-thumb";
      track.appendChild(thumb);
      toggle.appendChild(track);
      toggle.addEventListener("click", (function (i) {
        return function () {
          poolSchedules[i].enabled = !poolSchedules[i].enabled;
          savePoolSchedules();
          renderPoolSchedules();
        };
      })(idx));

      var remove = document.createElement("button");
      remove.type = "button";
      remove.className = "pool-schedule-remove";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Eliminar horario");
      remove.addEventListener("click", (function (i) {
        return function () {
          poolSchedules.splice(i, 1);
          savePoolSchedules();
          renderPoolSchedules();
        };
      })(idx));

      item.appendChild(times);
      item.appendChild(toggle);
      item.appendChild(remove);
      list.appendChild(item);
    });
  }

  function timeToMinutes(timeStr) {
    var parts = (timeStr || "").split(":");
    if (parts.length < 2) { return -1; }
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function checkPoolSchedule() {
    if (!poolSchedules.length) { return; }
    var now = new Date();
    var currentMins = now.getHours() * 60 + now.getMinutes();
    var shouldBeOn = false;
    var matchedSchedule = null;

    poolSchedules.forEach(function (sch) {
      if (!sch.enabled) { return; }
      var start = timeToMinutes(sch.start);
      var end = timeToMinutes(sch.end);
      if (start === -1 || end === -1) { return; }
      if (start <= end) {
        if (currentMins >= start && currentMins < end) { shouldBeOn = true; matchedSchedule = sch; }
      } else {
        // Horario cruzando medianoche
        if (currentMins >= start || currentMins < end) { shouldBeOn = true; matchedSchedule = sch; }
      }
    });

    // Solo actuar si cambia el estado esperado
    if (shouldBeOn !== lastPoolScheduleState) {
      lastPoolScheduleState = shouldBeOn;

      if (shouldBeOn) {
        // Encender la pileta
        if (!state.poolOn) {
          sendPoolCommand(true);
          addNotification(
            "important",
            "≈",
            "PILETA · HORARIO",
            "Sistema de pileta iniciado",
            matchedSchedule
              ? "Horario programado " + matchedSchedule.start + " → " + matchedSchedule.end
              : "Activación automática por horario"
          );
        }
      } else {
        // Apagar la pileta
        if (state.poolOn) {
          sendPoolCommand(false);
          addNotification(
            "important",
            "≈",
            "PILETA · HORARIO",
            "Sistema de pileta finalizado",
            "El ciclo de circulación automático ha terminado."
          );
        }
      }
    }
  }

  function initPoolSchedule() {
    loadPoolSchedules();
    renderPoolSchedules();

    var addBtn = byId("pool-schedule-add");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        byId("pool-schedule-modal").hidden = false;
      });
    }

    Array.prototype.forEach.call(document.querySelectorAll("[data-close-pool-schedule]"), function (btn) {
      btn.addEventListener("click", function () {
        byId("pool-schedule-modal").hidden = true;
        byId("pool-schedule-form").reset();
        byId("pool-schedule-form-error").hidden = true;
      });
    });

    var form = byId("pool-schedule-form");
    if (form) {
      form.addEventListener("submit", function (e) {
        e.preventDefault();
        var start = form.elements.pool_start.value;
        var end = form.elements.pool_end.value;
        var enabled = form.elements.pool_enabled.checked;
        var errEl = byId("pool-schedule-form-error");
        if (!start || !end) {
          errEl.textContent = "Completa los horarios de encendido y apagado.";
          errEl.hidden = false;
          return;
        }
        poolSchedules.push({ start: start, end: end, enabled: enabled });
        savePoolSchedules();
        renderPoolSchedules();
        byId("pool-schedule-modal").hidden = true;
        form.reset();
        errEl.hidden = true;

        addNotification(
          "important",
          "⚙",
          "PILETA · CONFIGURACIÓN",
          "Horario guardado",
          "Encendido: " + start + " · Apagado: " + end
        );
      });
    }

    // Revisar horario cada minuto
    checkPoolSchedule();
    setInterval(checkPoolSchedule, 60000);
  }

  // Notificación cuando el usuario enciende/apaga manualmente la pileta
  var prevPoolStateForNotif = null;

  function watchPoolStateForNotif() {
    setInterval(function () {
      if (prevPoolStateForNotif === null) {
        prevPoolStateForNotif = state.poolOn;
        return;
      }
      if (state.poolOn !== prevPoolStateForNotif) {
        prevPoolStateForNotif = state.poolOn;
        // Solo notificar si no es un cambio por horario automático
        if (lastPoolScheduleState === null) {
          if (state.poolOn) {
            addNotification("important", "≈", "PILETA", "Motor de pileta encendido", "Activado manualmente.");
          } else {
            addNotification("important", "≈", "PILETA", "Motor de pileta apagado", "Apagado manualmente.");
          }
        }
      }
    }, 3000);
  }

  function initialize() {
    byId("frontend-version").textContent = "HTML v60";
    byId("script-build-version").textContent = "JS v60";

    initializeConfirmDialog();
    initializeTabs();
    initializePWA();
    initializeControls();
    initializeCameraForm();
    initializeAgenda();
    renderTVs();
    renderCameras();
    renderLights();
    renderPool();
    renderGate();
    renderSystemStatus();
    setInterval(refreshGatewayFreshness, 5000);
    renderMedia();

    updateClock();
    setInterval(updateClock, 1000);

    byId("weather-refresh").addEventListener("click", loadWeather);
    byId("tv-refresh").addEventListener("click", renderTVs);

    // Inicializar Firebase y Autenticación
    initFirebase();
    initializeAuthentication();

    // Cargar clima (una sola vez al inicio + caché)
    loadCachedWeather();
    loadWeather();
    setInterval(loadWeather, 30 * 60 * 1000);

    // Inicializar sistema de notificaciones
    loadAgendaNotifSent();
    initNotifPanel();
    initPoolSchedule();
    watchPoolStateForNotif();

    // Revisar notificaciones de agenda cada 5 minutos
    setInterval(checkAgendaNotifications, 5 * 60 * 1000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
})();
