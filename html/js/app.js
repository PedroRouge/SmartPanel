(function () {
  "use strict";

  var APP_BUILD_VERSION = "28";
  var STORAGE_KEY = "smart-panel-state-v1";
  var API_BASE_URL = (window.SMART_PANEL_API_URL || "https://open-cost-levy-ignored.trycloudflare.com").replace(/\/+$/, "");
  var API_TOKEN_KEY = "smart-panel-api-session-v1";
  var API_USERNAME_KEY = "smart-panel-api-username-v1";
  var WEATHER_CONFIG = {
    latitude: -31.86519,
    longitude: -60.57469,
    location: "Colonia Ensayo, Entre Ríos"
  };
  var WEATHER_STORAGE_KEY = "smart-panel-weather-v3-" + WEATHER_CONFIG.latitude + "-" + WEATHER_CONFIG.longitude;
  var TV_CONFIG = {
    endpoint: "/api/tvs",
    refreshMs: 30000,
    timeoutMs: 15000
  };
  var TV_DEVICES = [
    { id: "tv-principal", name: "TV principal", room: "Living", model: "Smart TV" },
    { id: "tv-dormitorio", name: "TV dormitorio", room: "Dormitorio", model: "Smart TV" }
  ];
  var state = readState();
  var cameraCredentials = {};
  var tvApiAvailable = false;
  var tvApiEverConnected = false;
  var backendHealth = null;
  var apiToken = null;
  var apiAuthenticated = false;
  var remoteDataInitialized = false;
  var remotePollingStarted = false;
  var weatherRetryTimer = null;
  var weatherHasData = false;
  var volumeCommandTimer = null;
  var tvPairingId = null;
  var calendarMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  var selectedAgendaDate = formatDateISO(new Date());
  var calendarEvents = [];
  var eventEditingId = null;
  var lastTvRefresh = null;
  var deferredInstallPrompt = null;
  var pwaRefreshing = false;

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
    var saved;
    try {
      saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        saved = JSON.parse(saved);
        if (saved && typeof saved === "object") {
          if (saved.lights && typeof saved.lights === "object") {
            Object.keys(defaults.lights).forEach(function (key) {
              defaults.lights[key] = saved.lights[key] === true;
            });
          }
          defaults.poolOn = saved.poolOn === true;
          defaults.gateOpen = saved.gateOpen === true;
          defaults.volume = typeof saved.volume === "number" ? Math.max(0, Math.min(100, saved.volume)) : defaults.volume;
          defaults.muted = saved.muted === true;
          defaults.tvId = typeof saved.tvId === "string" ? saved.tvId : defaults.tvId;
          if (saved.tvStates && typeof saved.tvStates === "object") {
            Object.keys(saved.tvStates).forEach(function (tvId) {
              var savedTv = saved.tvStates[tvId];
              if (savedTv && typeof savedTv === "object") {
                defaults.tvStates[tvId] = {
                  volume: typeof savedTv.volume === "number" ? Math.max(0, Math.min(100, savedTv.volume)) : 35,
                  muted: savedTv.muted === true
                };
              }
            });
          }
          defaults.cameras = Array.isArray(saved.cameras) ? saved.cameras.filter(function (camera) {
            return camera && typeof camera.id === "string" && typeof camera.name === "string" && typeof camera.streamUrl === "string";
          }) : defaults.cameras;
        }
      }
    } catch (error) {
      return defaults;
    }
    return defaults;
  }

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      // The controls remain usable when browser storage is unavailable.
    }
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function localApiUrl(path) {
    return API_BASE_URL + path;
  }

  function localApiAddress() {
    return API_BASE_URL;
  }

  function setAuthorizationHeader(request) {
    if (apiToken) {
      request.setRequestHeader("Authorization", "Bearer " + apiToken);
    }
  }

  function handleUnauthorized(request) {
    if (request.status !== 401) { return false; }
    apiAuthenticated = false;
    remoteDataInitialized = false;
    apiToken = null;
    try { window.sessionStorage.removeItem(API_TOKEN_KEY); } catch (error) { }
    showAuthGate("La sesión venció. Vuelve a iniciar sesión.");
    return true;
  }

  function showAuthGate(message) {
    byId("auth-gate").hidden = false;
    byId("api-logout").hidden = true;
    byId("auth-error").textContent = message || "";
    byId("auth-error").hidden = !message;
    if (!byId("auth-username").value) { byId("auth-username").focus(); }
    else if (!byId("auth-password").value) { byId("auth-password").focus(); }
  }

  function acceptSession(token) {
    apiToken = token;
    apiAuthenticated = true;
    try { window.sessionStorage.setItem(API_TOKEN_KEY, token); } catch (error) { }
    byId("auth-gate").hidden = true;
    byId("api-logout").hidden = false;
    byId("auth-password").value = "";
    byId("auth-error").hidden = true;
    initializeRemoteData();
  }

  function checkAuthentication() {
    try { apiToken = window.sessionStorage.getItem(API_TOKEN_KEY); } catch (error) { apiToken = null; }
    var request = new XMLHttpRequest();
    request.open("GET", localApiUrl("/api/auth/status"), true);
    setAuthorizationHeader(request);
    request.timeout = 8000;
    request.onreadystatechange = function () {
      if (request.readyState !== 4) { return; }
      var result = {};
      try { result = JSON.parse(request.responseText); } catch (error) { }
      if (request.status >= 200 && request.status < 300 && result.authenticated && apiToken) {
        acceptSession(apiToken);
      } else if (request.status >= 200 && request.status < 300) {
        apiToken = null;
        try { window.sessionStorage.removeItem(API_TOKEN_KEY); } catch (error) { }
        showAuthGate();
      } else {
        showAuthGate("No se pudo validar la sesión. Revisa el túnel y vuelve a intentar.");
      }
    };
    request.onerror = function () { showAuthGate("No se pudo conectar con la API de la notebook."); };
    request.ontimeout = request.onerror;
    try { request.send(null); } catch (error) { request.onerror(); }
  }

  function initializeAuthentication() {
    try { byId("auth-username").value = window.localStorage.getItem(API_USERNAME_KEY) || ""; } catch (error) { }
    byId("auth-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var submit = byId("auth-submit");
      var request = new XMLHttpRequest();
      submit.disabled = true;
      byId("auth-error").hidden = true;
      request.open("POST", localApiUrl("/api/auth/login"), true);
      request.timeout = 10000;
      request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
      request.onreadystatechange = function () {
        if (request.readyState !== 4) { return; }
        submit.disabled = false;
        var result = {};
        try { result = JSON.parse(request.responseText); } catch (error) { }
        if (request.status >= 200 && request.status < 300 && result.token) {
          try { window.localStorage.setItem(API_USERNAME_KEY, byId("auth-username").value.trim()); } catch (error) { }
          acceptSession(result.token);
        } else {
          byId("auth-error").textContent = result.error || "No se pudo iniciar sesión.";
          byId("auth-error").hidden = false;
        }
      };
      request.onerror = function () {
        submit.disabled = false;
        byId("auth-error").textContent = "Sin conexión con la API de la notebook.";
        byId("auth-error").hidden = false;
      };
      request.ontimeout = request.onerror;
      try {
        request.send(JSON.stringify({
          username: byId("auth-username").value,
          password: byId("auth-password").value
        }));
      } catch (error) { request.onerror(); }
    });
    byId("api-logout").addEventListener("click", function () {
      var request = new XMLHttpRequest();
      request.open("POST", localApiUrl("/api/auth/logout"), true);
      setAuthorizationHeader(request);
      request.timeout = 5000;
      request.onreadystatechange = function () {
        if (request.readyState === 4) { finishLogout(); }
      };
      request.onerror = finishLogout;
      request.ontimeout = finishLogout;
      try { request.send(null); } catch (error) { finishLogout(); }
    });
  }

  function finishLogout() {
      apiAuthenticated = false;
      apiToken = null;
      try { window.sessionStorage.removeItem(API_TOKEN_KEY); } catch (error) { }
      remoteDataInitialized = false;
      showAuthGate("Sesión cerrada.");
  }

  function initializeVersionReader() {
    var versionTag = document.querySelector("meta[name='smart-panel-version']");
    var loadedVersion = versionTag ? versionTag.getAttribute("content") : "desconocida";
    byId("frontend-version").textContent = "HTML v" + loadedVersion;
    byId("script-build-version").textContent = "JS v" + APP_BUILD_VERSION;
    byId("backend-version").textContent = "API · inicia sesión";
  }

  function initializePWA() {
    var installButton = byId("pwa-install");
    var isStandalone = window.navigator.standalone === true || (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);
    installButton.hidden = isStandalone;
    window.addEventListener("beforeinstallprompt", function (event) {
      event.preventDefault();
      deferredInstallPrompt = event;
      installButton.hidden = false;
    });
    window.addEventListener("appinstalled", function () {
      deferredInstallPrompt = null;
      installButton.hidden = true;
    });
    function showInstallOption() {
      if (!deferredInstallPrompt) {
        byId("pwa-install-dialog").hidden = false;
        return;
      }
      deferredInstallPrompt.prompt();
      deferredInstallPrompt.userChoice.then(function () {
        deferredInstallPrompt = null;
      });
    }
    installButton.addEventListener("click", showInstallOption);
    byId("pwa-install-auth").addEventListener("click", showInstallOption);
    Array.prototype.forEach.call(document.querySelectorAll("[data-close-pwa-install]"), function (button) {
      button.addEventListener("click", function () { byId("pwa-install-dialog").hidden = true; });
    });
    byId("pwa-install-dialog").addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.keyCode === 27) { byId("pwa-install-dialog").hidden = true; }
    });
    if (!("serviceWorker" in window.navigator) || window.location.protocol !== "https:") { return; }
    var hasController = !!window.navigator.serviceWorker.controller;
    window.navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (hasController && !pwaRefreshing) {
        pwaRefreshing = true;
        window.location.reload();
      }
      hasController = true;
    });
    window.navigator.serviceWorker.register("/service-worker.js?v=28").then(function (registration) {
      registration.update().catch(function () {});
    }).catch(function () {});
  }

  function checkBackendVersion() {
    if (!apiAuthenticated) { return; }
    var request = new XMLHttpRequest();
    var dot = byId("backend-health-dot");
    var startedAt = new Date().getTime();
    request.open("GET", localApiUrl("/api/health"), true);
    setAuthorizationHeader(request);
    request.timeout = 4000;
    request.onreadystatechange = function () {
      if (request.readyState !== 4) { return; }
      if (handleUnauthorized(request)) { return; }
      if (request.status >= 200 && request.status < 300) {
        try {
          backendHealth = JSON.parse(request.responseText);
          var latency = new Date().getTime() - startedAt;
          byId("backend-version").textContent = "API v" + (backendHealth.version || "?") + " · " + latency + " ms";
          dot.classList.remove("is-checking", "is-error");
          dot.classList.add("is-online");
          return;
        } catch (error) {
          // Treat malformed health responses as an unavailable notebook API.
        }
      }
      byId("backend-version").textContent = "API sin respuesta · " + localApiAddress();
      dot.classList.remove("is-checking", "is-online");
      dot.classList.add("is-error");
    };
    request.onerror = function () {
      byId("backend-version").textContent = "API sin respuesta · " + localApiAddress();
      dot.classList.remove("is-checking", "is-online");
      dot.classList.add("is-error");
    };
    request.ontimeout = request.onerror;
    try { request.send(null); } catch (error) { request.onerror(); }
  }

  function initializeTabs() {
    var tabs = document.querySelectorAll("[data-tab]");
    var panels = document.querySelectorAll("[data-panel]");

    function activate(name, moveFocus) {
      var index;
      for (index = 0; index < tabs.length; index += 1) {
        var active = tabs[index].getAttribute("data-tab") === name;
        tabs[index].classList.toggle("is-active", active);
        tabs[index].setAttribute("aria-selected", active ? "true" : "false");
        tabs[index].setAttribute("tabindex", active ? "0" : "-1");
        if (active && moveFocus) {
          tabs[index].focus();
        }
      }
      for (index = 0; index < panels.length; index += 1) {
        var visible = panels[index].getAttribute("data-panel") === name;
        panels[index].classList.toggle("is-visible", visible);
        panels[index].hidden = !visible;
      }
      if (window.history && window.history.replaceState) {
        window.history.replaceState(null, "", "#" + name);
      }
    }

    Array.prototype.forEach.call(tabs, function (tab) {
      tab.addEventListener("click", function () {
        activate(tab.getAttribute("data-tab"), false);
      });
      tab.addEventListener("keydown", function (event) {
        var current = Array.prototype.indexOf.call(tabs, tab);
        var next = current;
        if (event.key === "ArrowRight" || event.keyCode === 39) {
          next = (current + 1) % tabs.length;
        } else if (event.key === "ArrowLeft" || event.keyCode === 37) {
          next = (current + tabs.length - 1) % tabs.length;
        } else if (event.key === "Home" || event.keyCode === 36) {
          next = 0;
        } else if (event.key === "End" || event.keyCode === 35) {
          next = tabs.length - 1;
        } else {
          return;
        }
        event.preventDefault();
        activate(tabs[next].getAttribute("data-tab"), true);
      });
    });

    var initialTab = window.location.hash.replace("#", "");
    var found = false;
    Array.prototype.forEach.call(tabs, function (tab) {
      if (tab.getAttribute("data-tab") === initialTab) {
        found = true;
      }
    });
    activate(found ? initialTab : "inicio", false);
  }

  function updateClock() {
    var now = new Date();
    var hours = String(now.getHours());
    var minutes = String(now.getMinutes());
    if (hours.length < 2) { hours = "0" + hours; }
    if (minutes.length < 2) { minutes = "0" + minutes; }
    var timeText = hours + ":" + minutes;
    byId("clock").textContent = timeText;
    byId("footer-time").textContent = timeText;
    byId("date-line").textContent = now.toLocaleDateString("es-AR", {
      weekday: "long", day: "numeric", month: "long", year: "numeric"
    });
  }

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
    if (!apiAuthenticated) { return; }
    var status = byId("weather-status");
    byId("weather-location").textContent = WEATHER_CONFIG.location.toUpperCase();
    if (typeof WEATHER_CONFIG.latitude !== "number" || typeof WEATHER_CONFIG.longitude !== "number") {
      status.textContent = "Sin ubicación";
      return;
    }
    if (!window.XMLHttpRequest) {
      showWeatherError("Navegador no compatible");
      return;
    }
    var url = localApiUrl("/api/weather?latitude=" + WEATHER_CONFIG.latitude + "&longitude=" + WEATHER_CONFIG.longitude);
    var request = new XMLHttpRequest();
    var finished = false;
    status.textContent = "Consultando (máx. 12 s)";
    byId("weather-refresh").disabled = true;

    function fail(message) {
      if (finished) { return; }
      finished = true;
      byId("weather-refresh").disabled = false;
      showWeatherError(message);
      scheduleWeatherRetry();
    }

    request.open("GET", url, true);
    setAuthorizationHeader(request);
    request.timeout = 12000;
    request.onreadystatechange = function () {
      if (request.readyState !== 4 || finished) { return; }
      if (handleUnauthorized(request)) {
        fail("Inicia sesión para consultar el clima.");
        return;
      }
      if (request.status < 200 || request.status >= 300) {
        var errorMessage = request.status ? "Error HTTP " + request.status : "Sin respuesta de red/CORS";
        try {
          var errorPayload = JSON.parse(request.responseText);
          if (errorPayload.detail) { errorMessage += ": " + errorPayload.detail; }
        } catch (error) {
          // Keep the HTTP status when the server response is not JSON.
        }
        fail(errorMessage);
        return;
      }
      var data;
      try {
        data = JSON.parse(request.responseText);
      } catch (error) {
        fail("Respuesta inválida de Open-Meteo");
        return;
      }
      if (!data.current || !data.daily || !data.daily.time || data.daily.time.length < 7) {
        fail(data.reason || "Open-Meteo no devolvió 7 días");
        return;
      }
      finished = true;
      applyWeatherData(data, "Actualizado");
      try {
        window.localStorage.setItem(WEATHER_STORAGE_KEY, JSON.stringify(data));
      } catch (error) {
        // The live weather display does not depend on local storage.
      }
      if (weatherRetryTimer) {
        window.clearTimeout(weatherRetryTimer);
        weatherRetryTimer = null;
      }
      byId("weather-refresh").disabled = false;
    };
    request.onerror = function () { fail("API local inaccesible en " + localApiAddress()); };
    request.ontimeout = function () { fail("Tiempo agotado (12 s)"); };
    request.onabort = function () { fail("Solicitud cancelada"); };
    try {
      request.send(null);
    } catch (error) {
      fail("No se pudo iniciar la solicitud");
    }
  }

  function showWeatherError(message) {
    byId("weather-refresh").disabled = false;
    byId("weather-status").textContent = message;
    if (!weatherHasData) {
      byId("weather-description").textContent = "Comprueba la conexión a Internet";
      byId("forecast-list").innerHTML = "";
      byId("forecast-list").appendChild(createTextElement("div", "forecast-placeholder", "No se pudo conectar con Open-Meteo. Pulsa ↻ para volver a intentar."));
    } else {
      byId("weather-description").textContent = "Últimos datos guardados";
    }
  }

  function scheduleWeatherRetry() {
    if (weatherRetryTimer) { return; }
    weatherRetryTimer = window.setTimeout(function () {
      weatherRetryTimer = null;
      loadWeather();
    }, 2 * 60 * 1000);
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
    byId("weather-status").textContent = statusText;
    renderForecast(daily, current);
  }

  function loadCachedWeather() {
    try {
      var cached = window.localStorage.getItem(WEATHER_STORAGE_KEY);
      if (cached) {
        var data = JSON.parse(cached);
        if (data.current && data.daily && data.daily.time && data.daily.time.length >= 7) {
          applyWeatherData(data, "Datos guardados");
        }
      }
    } catch (error) {
      // Ignore invalid or unavailable cached weather.
    }
  }

  function renderForecast(daily, current) {
    var list = byId("forecast-list");
    var index;
    while (list.firstChild) { list.removeChild(list.firstChild); }
    for (index = 0; index < 7; index += 1) {
      var date = new Date(daily.time[index] + "T12:00:00");
      var dayName = index === 0 ? "Hoy" : date.toLocaleDateString("es-AR", { weekday: "short" });
      var summary = weatherDescription(daily.weather_code[index]);
      var item = document.createElement("div");
      item.className = "forecast-item";
      item.appendChild(createTextElement("span", "forecast-time", dayName));
      item.appendChild(createTextElement("span", "forecast-icon", summary[1]));
      item.lastChild.setAttribute("aria-hidden", "true");
      item.appendChild(createTextElement("span", "forecast-temperature", Math.round(daily.temperature_2m_max[index]) + "° / " + Math.round(daily.temperature_2m_min[index]) + "°"));
      var rainProbability = daily.precipitation_probability_max && typeof daily.precipitation_probability_max[index] === "number" ? daily.precipitation_probability_max[index] : null;
      item.appendChild(createTextElement("span", "forecast-rain", rainProbability === null ? "Lluvia --%" : "Lluvia " + rainProbability + "%"));
      var accessibleForecast = dayName + ": " + summary[0] + ", máxima " + Math.round(daily.temperature_2m_max[index]) + " grados, mínima " + Math.round(daily.temperature_2m_min[index]) + " grados";
      if (rainProbability !== null) { accessibleForecast += ", probabilidad máxima de precipitación " + rainProbability + " por ciento"; }
      item.setAttribute("aria-label", accessibleForecast);
      list.appendChild(item);
    }
  }

  function formatDateISO(dateValue) {
    var year = dateValue.getFullYear();
    var month = String(dateValue.getMonth() + 1);
    var day = String(dateValue.getDate());
    if (month.length < 2) { month = "0" + month; }
    if (day.length < 2) { day = "0" + day; }
    return year + "-" + month + "-" + day;
  }

  function parseISODate(value) {
    var parts = value.split("-");
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function formatAgendaDate(value, options) {
    return parseISODate(value).toLocaleDateString("es-AR", options || { weekday: "long", day: "numeric", month: "long" });
  }

  function getCalendarRange() {
    var firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    var mondayOffset = (firstDay.getDay() + 6) % 7;
    var start = new Date(firstDay);
    start.setDate(firstDay.getDate() - mondayOffset);
    var end = new Date(start);
    end.setDate(start.getDate() + 41);
    var today = new Date();
    today.setHours(0, 0, 0, 0);
    if (today < start) { start = today; }
    if (today > end) { end = today; }
    return { from: formatDateISO(start), to: formatDateISO(end) };
  }

  function loadEvents() {
    if (!apiAuthenticated) { return; }
    var range = getCalendarRange();
    var request = new XMLHttpRequest();
    request.open("GET", localApiUrl("/api/events?from=" + range.from + "&to=" + range.to), true);
    request.timeout = 10000;
    setAuthorizationHeader(request);
    request.onreadystatechange = function () {
      if (request.readyState !== 4) { return; }
      if (handleUnauthorized(request)) { return; }
      if (request.status < 200 || request.status >= 300) {
        byId("agenda-day-status").textContent = "No se pudieron cargar los eventos (HTTP " + request.status + ").";
        byId("today-agenda-status").textContent = "No se pudieron cargar los eventos.";
        return;
      }
      try {
        calendarEvents = JSON.parse(request.responseText);
      } catch (error) {
        calendarEvents = [];
        byId("agenda-day-status").textContent = "La API devolvió una respuesta inválida.";
        return;
      }
      renderCalendar();
      renderAgendaDay();
      renderTodayEvents();
    };
    request.onerror = function () {
      byId("agenda-day-status").textContent = "Sin conexión con la agenda de la notebook.";
      byId("today-agenda-status").textContent = "Sin conexión con la agenda de la notebook.";
    };
    request.ontimeout = request.onerror;
    try { request.send(null); } catch (error) { request.onerror(); }
  }

  function eventsForDate(dateValue) {
    return calendarEvents.filter(function (event) { return event.date === dateValue; }).sort(function (first, second) {
      if (first.all_day !== second.all_day) { return first.all_day ? -1 : 1; }
      return String(first.start_time || "").localeCompare(String(second.start_time || ""));
    });
  }

  function renderCalendar() {
    var heading = byId("calendar-month");
    var grid = byId("calendar-grid");
    var firstDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), 1);
    var offset = (firstDay.getDay() + 6) % 7;
    var start = new Date(firstDay);
    start.setDate(firstDay.getDate() - offset);
    var today = formatDateISO(new Date());
    var index;
    heading.textContent = calendarMonth.toLocaleDateString("es-AR", { month: "long", year: "numeric" });
    while (grid.firstChild) { grid.removeChild(grid.firstChild); }
    for (index = 0; index < 42; index += 1) {
      var day = new Date(start);
      day.setDate(start.getDate() + index);
      var dayISO = formatDateISO(day);
      var events = eventsForDate(dayISO);
      var button = document.createElement("button");
      button.type = "button";
      button.className = "calendar-day";
      if (day.getMonth() !== calendarMonth.getMonth()) { button.classList.add("is-outside"); }
      if (dayISO === today) { button.classList.add("is-today"); }
      if (dayISO === selectedAgendaDate) { button.classList.add("is-selected"); }
      if (events.length) { button.classList.add("has-events"); }
      button.textContent = String(day.getDate());
      button.setAttribute("aria-label", formatAgendaDate(dayISO) + (events.length ? ", " + events.length + (events.length === 1 ? " evento" : " eventos") : ""));
      button.setAttribute("aria-pressed", dayISO === selectedAgendaDate ? "true" : "false");
      button.addEventListener("click", function (dateString) {
        return function () {
          selectedAgendaDate = dateString;
          var selectedDate = parseISODate(dateString);
          if (selectedDate.getMonth() !== calendarMonth.getMonth() || selectedDate.getFullYear() !== calendarMonth.getFullYear()) {
            calendarMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
            loadEvents();
          } else {
            renderCalendar();
            renderAgendaDay();
          }
        };
      }(dayISO));
      grid.appendChild(button);
    }
  }

  function renderEventList(dateValue, listId, statusId, includeActions) {
    var list = byId(listId);
    var status = byId(statusId);
    var events = eventsForDate(dateValue);
    var index;
    while (list.firstChild) { list.removeChild(list.firstChild); }
    status.textContent = formatAgendaDate(dateValue, { weekday: "long", day: "numeric", month: "long" });
    if (!events.length) {
      list.appendChild(createTextElement("p", "event-empty", "No hay eventos para esta fecha."));
      return;
    }
    status.textContent += " · " + events.length + (events.length === 1 ? " evento" : " eventos");
    for (index = 0; index < events.length; index += 1) {
      (function (event) {
        var row = document.createElement("article");
        var time = createTextElement("span", "event-time", event.all_day ? "Todo el día" : (event.start_time || ""));
        var copy = document.createElement("div");
        var title = document.createElement("button");
        row.className = "event-row";
        copy.className = "event-copy";
        title.type = "button";
        title.className = "event-title";
        title.textContent = event.title;
        title.addEventListener("click", function () { openEventForm(event); });
        copy.appendChild(title);
        if (event.end_time) { copy.appendChild(createTextElement("span", "event-end-time", "Hasta " + event.end_time)); }
        if (event.notes) { copy.appendChild(createTextElement("p", "", event.notes)); }
        row.appendChild(time);
        row.appendChild(copy);
        if (includeActions) {
          var actions = document.createElement("div");
          var remove = document.createElement("button");
          actions.className = "event-actions";
          var edit = document.createElement("button");
          edit.type = "button";
          edit.className = "event-action";
          edit.setAttribute("aria-label", "Editar " + event.title);
          edit.title = "Editar evento";
          edit.textContent = "✎";
          edit.addEventListener("click", function () { openEventForm(event); });
          remove.type = "button";
          remove.className = "event-action is-delete";
          remove.setAttribute("aria-label", "Eliminar " + event.title);
          remove.title = "Eliminar evento";
          remove.textContent = "×";
          remove.addEventListener("click", function () { deleteCalendarEvent(event); });
          actions.appendChild(edit);
          actions.appendChild(remove);
          row.appendChild(actions);
        }
        list.appendChild(row);
      }(events[index]));
    }
  }

  function renderAgendaDay() {
    renderEventList(selectedAgendaDate, "agenda-day-events", "agenda-day-status", true);
    byId("agenda-day-heading").textContent = formatAgendaDate(selectedAgendaDate, { weekday: "long", day: "numeric", month: "long" });
  }

  function renderTodayEvents() {
    var today = formatDateISO(new Date());
    renderEventList(today, "today-events", "today-agenda-status", false);
  }

  function openAgenda(dateValue) {
    selectedAgendaDate = dateValue || formatDateISO(new Date());
    var selectedDate = parseISODate(selectedAgendaDate);
    calendarMonth = new Date(selectedDate.getFullYear(), selectedDate.getMonth(), 1);
    renderCalendar();
    renderAgendaDay();
    var tab = document.querySelector("[data-tab='agenda']");
    if (tab) { tab.click(); }
  }

  function shiftCalendarMonth(offset) {
    var previousDay = parseISODate(selectedAgendaDate).getDate();
    calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + offset, 1);
    var lastDay = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
    selectedAgendaDate = formatDateISO(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth(), Math.min(previousDay, lastDay)));
    loadEvents();
  }

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
    form.elements.notes.value = eventData ? eventData.notes : "";
    byId("event-time-row").hidden = form.elements.all_day.checked;
    byId("event-modal").hidden = false;
    form.elements.title.focus();
  }

  function closeEventForm() {
    byId("event-modal").hidden = true;
    byId("event-form").reset();
    byId("event-form-error").hidden = true;
    eventEditingId = null;
  }

  function saveCalendarEvent(event) {
    event.preventDefault();
    if (!apiAuthenticated) { showAuthGate("Inicia sesión para guardar eventos."); return; }
    var form = byId("event-form");
    var payload = {
      title: form.elements.title.value,
      date: form.elements.date.value,
      all_day: form.elements.all_day.checked,
      start_time: form.elements.all_day.checked ? null : form.elements.start_time.value,
      end_time: form.elements.all_day.checked ? null : form.elements.end_time.value,
      notes: form.elements.notes.value
    };
    var request = new XMLHttpRequest();
    var submit = byId("event-submit");
    submit.disabled = true;
    request.open(eventEditingId ? "PUT" : "POST", localApiUrl("/api/events" + (eventEditingId ? "/" + encodeURIComponent(eventEditingId) : "")), true);
    request.timeout = 10000;
    request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    setAuthorizationHeader(request);
    request.onreadystatechange = function () {
      if (request.readyState !== 4) { return; }
      submit.disabled = false;
      if (handleUnauthorized(request)) { return; }
      if (request.status >= 200 && request.status < 300) {
        selectedAgendaDate = payload.date;
        calendarMonth = new Date(parseISODate(payload.date).getFullYear(), parseISODate(payload.date).getMonth(), 1);
        closeEventForm();
        loadEvents();
      } else {
        var result = {};
        try { result = JSON.parse(request.responseText); } catch (error) { }
        byId("event-form-error").textContent = result.error || "No se pudo guardar el evento.";
        byId("event-form-error").hidden = false;
      }
    };
    request.onerror = function () {
      submit.disabled = false;
      byId("event-form-error").textContent = "Sin conexión con la agenda de la notebook.";
      byId("event-form-error").hidden = false;
    };
    request.ontimeout = request.onerror;
    try { request.send(JSON.stringify(payload)); } catch (error) { request.onerror(); }
  }

  function deleteCalendarEvent(eventData) {
    if (!apiAuthenticated || !window.confirm("¿Eliminar el evento \"" + eventData.title + "\"?")) { return; }
    var request = new XMLHttpRequest();
    request.open("DELETE", localApiUrl("/api/events/" + encodeURIComponent(eventData.id)), true);
    setAuthorizationHeader(request);
    request.onreadystatechange = function () {
      if (request.readyState !== 4) { return; }
      if (handleUnauthorized(request)) { return; }
      if (request.status >= 200 && request.status < 300) { loadEvents(); }
    };
    request.onerror = function () { byId("agenda-day-status").textContent = "No se pudo eliminar el evento."; };
    try { request.send(null); } catch (error) { request.onerror(); }
  }

  function initializeAgenda() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-open-agenda]"), function (button) {
      button.addEventListener("click", function () { openAgenda(formatDateISO(new Date())); });
    });
    byId("new-event-button").addEventListener("click", function () { openEventForm(null); });
    byId("new-event-for-day").addEventListener("click", function () { openEventForm(null); });
    byId("calendar-previous").addEventListener("click", function () {
      shiftCalendarMonth(-1);
    });
    byId("calendar-next").addEventListener("click", function () {
      shiftCalendarMonth(1);
    });
    byId("calendar-today").addEventListener("click", function () { openAgenda(formatDateISO(new Date())); });
    byId("event-form").addEventListener("submit", saveCalendarEvent);
    byId("event-form").elements.all_day.addEventListener("change", function () {
      byId("event-time-row").hidden = this.checked;
    });
    byId("event-delete").addEventListener("click", function () {
      var eventData = calendarEvents.filter(function (item) { return item.id === eventEditingId; })[0];
      if (eventData) {
        closeEventForm();
        deleteCalendarEvent(eventData);
      }
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-close-event]"), function (button) {
      button.addEventListener("click", closeEventForm);
    });
    byId("event-modal").addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.keyCode === 27) { closeEventForm(); }
    });
    renderCalendar();
    renderAgendaDay();
    renderTodayEvents();
  }

  function getSelectedTv() {
    var index;
    for (index = 0; index < TV_DEVICES.length; index += 1) {
      if (TV_DEVICES[index].id === state.tvId) {
        return TV_DEVICES[index];
      }
    }
    state.tvId = TV_DEVICES.length ? TV_DEVICES[0].id : "";
    return TV_DEVICES.length ? TV_DEVICES[0] : null;
  }

  function renderTvApiStatus(message) {
    byId("tv-api-status").textContent = message;
  }

  function requestTVs() {
    if (!apiAuthenticated) { return; }
    var request = new XMLHttpRequest();
    var finished = false;
    byId("tv-refresh").disabled = true;
    request.open("GET", localApiUrl(TV_CONFIG.endpoint), true);
    setAuthorizationHeader(request);
    request.timeout = TV_CONFIG.timeoutMs;
    request.onreadystatechange = function () {
      if (request.readyState !== 4 || finished) { return; }
      finished = true;
      byId("tv-refresh").disabled = false;
      if (handleUnauthorized(request)) { return; }
      if (request.status < 200 || request.status >= 300) {
        tvApiAvailable = false;
        lastTvRefresh = new Date();
        renderTvApiStatus(tvApiEverConnected ? "API local sin respuesta en " + localApiAddress() + "; datos posiblemente antiguos." : "No responde " + localApiAddress() + ". Inicia servidor.py; se muestran TVs demo.");
        renderMedia();
        return;
      }
      var payload;
      try {
        payload = JSON.parse(request.responseText);
      } catch (error) {
        tvApiAvailable = false;
        renderTvApiStatus("La API local no devolvió JSON válido; mostrando TVs de demostración.");
        renderMedia();
        return;
      }
      var devices = Array.isArray(payload) ? payload : (payload.tvs || payload.devices);
      if (!Array.isArray(devices)) {
        tvApiAvailable = false;
        renderTvApiStatus("Formato de API inválido: se esperaba una lista de TVs.");
        renderMedia();
        return;
      }
      TV_DEVICES = devices.filter(function (device) {
        return device && device.id !== undefined;
      }).map(function (device) {
        return {
          id: String(device.id),
          name: device.name || device.label || "Televisor",
          room: device.room || device.location || "Ubicación no indicada",
          model: device.model || device.brand || "TV",
          manufacturer: device.manufacturer || "",
          deviceUuid: device.deviceUuid || null,
          poweredOn: typeof device.poweredOn === "boolean" ? device.poweredOn : (device.state === "on" ? true : (device.state === "off" ? false : null)),
          online: device.online === true,
          powerControlReady: false,
          volume: typeof device.volume === "number" ? Math.max(0, Math.min(100, device.volume)) : null,
          muted: typeof device.muted === "boolean" ? device.muted : null
        };
      });
      tvApiAvailable = true;
      tvApiEverConnected = true;
      lastTvRefresh = new Date();
      if (TV_DEVICES.length && !getTvById(state.tvId)) { state.tvId = TV_DEVICES[0].id; }
      TV_DEVICES.forEach(function (device) {
        if (!state.tvStates[device.id]) {
          state.tvStates[device.id] = { volume: device.volume === null ? 35 : device.volume, muted: device.muted === true };
        } else if (device.volume !== null) {
          state.tvStates[device.id].volume = device.volume;
          state.tvStates[device.id].muted = device.muted === true;
        }
      });
      saveState();
      renderTVs();
      renderMedia();
      TV_DEVICES.forEach(requestTVStatus);
    };
    request.onerror = function () {
      if (finished) { return; }
      finished = true;
      byId("tv-refresh").disabled = false;
      tvApiAvailable = false;
      lastTvRefresh = new Date();
      renderTvApiStatus(tvApiEverConnected ? "API local desconectada en " + localApiAddress() : "No responde " + localApiAddress() + ". Inicia servidor.py; se muestran TVs demo.");
      renderMedia();
    };
    request.ontimeout = request.onerror;
    try { request.send(null); } catch (error) { request.onerror(); }
  }

  function getTvById(id) {
    var index;
    for (index = 0; index < TV_DEVICES.length; index += 1) {
      if (TV_DEVICES[index].id === id) { return TV_DEVICES[index]; }
    }
    return null;
  }

  function requestTVStatus(tv) {
    var request = new XMLHttpRequest();
    request.open("GET", localApiUrl(TV_CONFIG.endpoint + "/" + encodeURIComponent(tv.id) + "/status"), true);
    setAuthorizationHeader(request);
    request.timeout = TV_CONFIG.timeoutMs;
    request.onreadystatechange = function () {
      if (request.readyState === 4 && handleUnauthorized(request)) { return; }
      if (request.readyState !== 4 || request.status < 200 || request.status >= 300) { return; }
      var result;
      try { result = JSON.parse(request.responseText); } catch (error) { return; }
      var current = getTvById(tv.id);
      if (!current) { return; }
      var volumeIsBeingEdited = current.id === state.tvId && (volumeCommandTimer !== null || document.activeElement === byId("volume-slider"));
      current.online = result.online === true;
      current.poweredOn = typeof result.poweredOn === "boolean" ? result.poweredOn : null;
      current.powerControlReady = result.powerControlReady === true;
      current.volume = typeof result.volume === "number" ? Math.max(0, Math.min(100, result.volume)) : null;
      current.muted = typeof result.muted === "boolean" ? result.muted : null;
      if (current.volume !== null && !volumeIsBeingEdited) {
        if (!state.tvStates[current.id]) { state.tvStates[current.id] = { volume: current.volume, muted: current.muted === true }; }
        state.tvStates[current.id].volume = current.volume;
        if (current.muted !== null) { state.tvStates[current.id].muted = current.muted; }
      }
      saveState();
      renderTVs();
      renderMedia();
    };
    try { request.send(null); } catch (error) { return; }
  }

  function requestTVPairing(tv, action, payload, onSuccess) {
    var request = new XMLHttpRequest();
    request.open("POST", localApiUrl(TV_CONFIG.endpoint + "/" + encodeURIComponent(tv.id) + "/pairing/" + action), true);
    request.timeout = 30000;
    request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    setAuthorizationHeader(request);
    request.onreadystatechange = function () {
      if (request.readyState !== 4) { return; }
      if (handleUnauthorized(request)) { return; }
      var result = {};
      try { result = JSON.parse(request.responseText); } catch (error) { result = {}; }
      if (request.status >= 200 && request.status < 300) {
        onSuccess(result);
      } else {
        byId("media-feedback").textContent = result.error || tv.name + " · no se pudo emparejar.";
      }
    };
    request.onerror = function () { byId("media-feedback").textContent = tv.name + " · error al contactar la API de la notebook."; };
    request.ontimeout = request.onerror;
    try { request.send(JSON.stringify(payload || {})); } catch (error) { request.onerror(); }
  }

  function startTVPairing(tv) {
    byId("media-feedback").textContent = "Iniciando emparejamiento; confirma la solicitud en el ONN...";
    requestTVPairing(tv, "start", {}, function (result) {
      if (result.paired) {
        tv.powerControlReady = true;
        renderTVs();
        requestTVStatus(tv);
        return;
      }
      tvPairingId = tv.id;
      byId("tv-pairing-panel").hidden = false;
      byId("tv-power-hint").hidden = true;
      byId("media-feedback").textContent = "Código solicitado en el ONN. Escríbelo aquí para vincular el panel.";
      byId("tv-pairing-code").focus();
    });
  }

  function cancelTVPairing(tv) {
    tvPairingId = null;
    byId("tv-pairing-panel").hidden = true;
    byId("tv-pairing-code").value = "";
    requestTVPairing(tv, "cancel", {}, function () {});
  }

  function sendTVCommand(action, value) {
    var tv = getSelectedTv();
    if (!tv) { return; }
    if (!tvApiAvailable) {
      byId("media-feedback").textContent = tvApiEverConnected ? "No se envió: API de la notebook desconectada." : tv.name + " · modo demostración; conecta /api/tvs para enviar comandos.";
      return;
    }
    var request = new XMLHttpRequest();
    request.open("POST", localApiUrl(TV_CONFIG.endpoint + "/" + encodeURIComponent(tv.id) + "/command"), true);
    request.timeout = TV_CONFIG.timeoutMs;
    request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    setAuthorizationHeader(request);
    request.onreadystatechange = function () {
      if (request.readyState !== 4) { return; }
      if (handleUnauthorized(request)) { return; }
      if (request.status >= 200 && request.status < 300) {
        var result = {};
        try { result = JSON.parse(request.responseText); } catch (error) { result = {}; }
        var tvState = getSelectedTvState();
        if (typeof result.volume === "number") { tvState.volume = result.volume; state.volume = result.volume; }
        if (typeof result.muted === "boolean") { tvState.muted = result.muted; state.muted = result.muted; }
        if (typeof result.poweredOn === "boolean") {
          var commandTv = getTvById(tv.id);
          if (commandTv) { commandTv.poweredOn = result.poweredOn; }
        }
        saveState();
        renderTVs();
        renderMedia();
        byId("media-feedback").textContent = result.action === "launch_app" ? tv.name + " · app enviada al Cast." : (result.action === "power" ? tv.name + (typeof result.poweredOn === "boolean" ? (result.poweredOn ? " · encendida." : " · apagada.") : " · comando enviado.") : tv.name + " · control aplicado.");
      } else {
        var message = tv.name + " · comando rechazado (HTTP " + request.status + ").";
        try {
          var errorResponse = JSON.parse(request.responseText);
          if (errorResponse.error) { message = errorResponse.error; }
        } catch (error) {
          // Keep a readable status when the API response is not JSON.
        }
        byId("media-feedback").textContent = message;
      }
    };
    request.onerror = function () { byId("media-feedback").textContent = "No se pudo contactar la API de la notebook: " + localApiAddress(); };
    request.ontimeout = request.onerror;
    try {
      request.send(JSON.stringify({ action: action, value: value }));
      byId("media-feedback").textContent = tv.name + " · enviando comando a la notebook...";
    } catch (error) {
      request.onerror();
    }
  }

  function renderTVs() {
    var list = byId("tv-list");
    var index;
    var selected = getSelectedTv();
    var statusMessage;
    while (list.firstChild) { list.removeChild(list.firstChild); }
    byId("tv-list-empty").hidden = TV_DEVICES.length > 0;
    if (tvApiAvailable) {
      statusMessage = "API de notebook conectada · " + TV_DEVICES.length + (TV_DEVICES.length === 1 ? " TV" : " TVs");
      if (!TV_DEVICES.length && backendHealth && backendHealth.scan_cidr) { statusMessage += " · escaneo " + backendHealth.scan_cidr; }
      if (lastTvRefresh) { statusMessage += " · actualizado " + lastTvRefresh.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }); }
    } else if (tvApiEverConnected) {
      statusMessage = "API de notebook desconectada · datos posiblemente antiguos";
    } else {
      statusMessage = "API de notebook no conectada · lista de demostración";
    }
    renderTvApiStatus(statusMessage);
    for (index = 0; index < TV_DEVICES.length; index += 1) {
      (function (tv) {
        var button = document.createElement("button");
        var icon = document.createElement("span");
        var copy = document.createElement("span");
        var name = document.createElement("strong");
        var location = document.createElement("span");
        var power = document.createElement("span");
        var check = document.createElement("span");
        var active = selected && tv.id === selected.id;
        button.type = "button";
        button.className = "tv-device" + (active ? " is-selected" : "");
        button.setAttribute("aria-pressed", active ? "true" : "false");
        icon.className = "tv-device-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = "▣";
        copy.className = "tv-device-copy";
        name.textContent = tv.name;
        location.textContent = tv.room + " · " + tv.model;
        power.className = "tv-power-state";
        if (tv.poweredOn === true) {
          power.textContent = "Encendida";
          power.classList.add("is-on");
        } else if (tv.poweredOn === false) {
          power.textContent = "Apagada";
          power.classList.add("is-off");
        } else {
          power.textContent = tv.online ? "En red · encendido desconocido" : (tvApiAvailable ? "Estado no reportado" : "Sin conexión real");
          power.classList.add("is-unknown");
        }
        copy.appendChild(name);
        copy.appendChild(location);
        copy.appendChild(power);
        check.className = "tv-device-check";
        check.setAttribute("aria-hidden", "true");
        check.textContent = active ? "●" : "";
        button.appendChild(icon);
        button.appendChild(copy);
        button.appendChild(check);
        button.addEventListener("click", function () {
          if (volumeCommandTimer !== null) {
            window.clearTimeout(volumeCommandTimer);
            volumeCommandTimer = null;
          }
          if (!state.tvStates[tv.id]) {
            state.tvStates[tv.id] = { volume: 35, muted: false };
          }
          state.tvId = tv.id;
          state.volume = state.tvStates[tv.id].volume;
          state.muted = state.tvStates[tv.id].muted;
          saveState();
          renderTVs();
          renderMedia();
        });
        list.appendChild(button);
      }(TV_DEVICES[index]));
    }
    byId("tv-control").hidden = !selected;
    if (selected) {
      byId("selected-tv-name").textContent = selected.name;
      byId("selected-tv-location").textContent = selected.room + " · " + selected.model;
      var powerText = selected.poweredOn === true ? "Encendida" : (selected.poweredOn === false ? "Apagada" : (selected.online ? "En red · encendido desconocido" : (tvApiAvailable ? "Estado no reportado" : "Demo · API no conectada")));
      byId("selected-tv-power").textContent = powerText;
      byId("selected-tv-dot").classList.toggle("is-off", selected.poweredOn === false);
      byId("selected-tv-dot").classList.toggle("is-unknown", selected.poweredOn !== true && selected.poweredOn !== false);
      var powerButton = byId("tv-power-button");
      var powerLabel = selected.poweredOn === true ? "Apagar " + selected.name : "Encender " + selected.name;
      var powerReady = selected.powerControlReady === true;
      powerButton.disabled = !tvApiAvailable;
      byId("tv-power-label").textContent = powerReady ? (selected.poweredOn === true ? "Apagar" : "Encender") : "Emparejar";
      powerButton.setAttribute("aria-label", tvApiAvailable ? (powerReady ? powerLabel : "Emparejar " + selected.name) : "API de notebook no conectada");
      powerButton.title = powerReady ? powerLabel : "Emparejar con el código del ONN";
      byId("tv-pairing-panel").hidden = tvPairingId !== selected.id;
      byId("tv-power-hint").hidden = powerReady || tvPairingId === selected.id;
      Array.prototype.forEach.call(document.querySelectorAll("[data-remote-key]"), function (button) {
        button.disabled = !tvApiAvailable || !powerReady;
      });
      byId("remote-key-hint").textContent = powerReady ? "Navegación enviada mediante Android TV Remote." : "Toca Emparejar para vincular este Android TV y habilitar la navegación.";
    }
  }

  function sendTvAction(action, value) {
    var tv = getSelectedTv();
    if (tv) {
      sendTVCommand(action, value);
    }
  }

  function createTextElement(tagName, className, text) {
    var element = document.createElement(tagName);
    element.className = className;
    element.textContent = text;
    return element;
  }

  function renderCameraCard(camera, index) {
    var card = document.createElement("article");
    var preview = document.createElement("div");
    var image = document.createElement("img");
    var message = document.createElement("span");
    var glyph = createTextElement("span", "camera-glyph", "▧");
    var tag = document.createElement("span");
    var caption = document.createElement("div");
    var copy = document.createElement("div");
    var typeText = camera.streamUrl.toLowerCase().indexOf("rtsp://") === 0 ? "RTSP · gateway requerido" : "Stream HTTP";
    var authenticated = !!camera.authRequired || !!cameraCredentials[camera.id];
    var useImage = camera.streamUrl.toLowerCase().indexOf("http://") === 0 || camera.streamUrl.toLowerCase().indexOf("https://") === 0;
    var remove = document.createElement("button");

    card.className = "camera-card panel-surface";
    preview.className = "camera-preview";
    image.className = "camera-stream";
    image.alt = "Vista de " + camera.name;
    image.hidden = true;
    message.className = "camera-stream-message";
    tag.className = "camera-tag";
    tag.textContent = useImage && !authenticated ? "CÁMARA IP" : "CONFIGURADA";
    if (!useImage) {
      message.textContent = "RTSP requiere un gateway local HLS o WebRTC.";
    } else if (authenticated) {
      message.textContent = "La vista con autenticación requiere un proxy local.";
    } else {
      message.textContent = "Conectando con el stream...";
      image.onload = function () {
        image.hidden = false;
        glyph.hidden = true;
        message.hidden = true;
      };
      image.onerror = function () {
        glyph.hidden = false;
        message.hidden = false;
        message.textContent = "No se pudo cargar. Revisa URL, red o formato MJPEG.";
      };
    }
    preview.appendChild(image);
    preview.appendChild(glyph);
    preview.appendChild(message);
    preview.appendChild(tag);
    if (useImage && !authenticated) {
      image.src = camera.streamUrl;
    }

    caption.className = "camera-caption";
    copy.appendChild(createTextElement("h2", "", camera.name));
    copy.appendChild(createTextElement("p", "", camera.streamUrl.replace(/^https?:\/\//i, "").split("/")[0]));
    copy.appendChild(createTextElement("span", "camera-type-tag", typeText));
    caption.appendChild(copy);
    var actions = document.createElement("div");
    actions.className = "camera-actions";
    actions.appendChild(createTextElement("span", "camera-number", String(index + 1).length < 2 ? "0" + (index + 1) : String(index + 1)));
    remove.type = "button";
    remove.className = "camera-remove";
    remove.setAttribute("aria-label", "Eliminar cámara " + camera.name);
    remove.textContent = "×";
    remove.addEventListener("click", function () {
      if (!window.confirm("¿Eliminar la cámara “" + camera.name + "”?")) { return; }
      state.cameras = state.cameras.filter(function (entry) { return entry.id !== camera.id; });
      delete cameraCredentials[camera.id];
      saveState();
      renderCameras();
    });
    actions.appendChild(remove);
    caption.appendChild(actions);
    card.appendChild(preview);
    card.appendChild(caption);
    return card;
  }

  function renderCameras() {
    var grid = byId("camera-grid");
    var index;
    while (grid.firstChild) { grid.removeChild(grid.firstChild); }
    byId("camera-empty").hidden = state.cameras.length > 0;
    grid.hidden = state.cameras.length === 0;
    for (index = 0; index < state.cameras.length; index += 1) {
      grid.appendChild(renderCameraCard(state.cameras[index], index));
    }
  }

  function openCameraForm() {
    byId("camera-modal").hidden = false;
    byId("camera-form-error").hidden = true;
    byId("camera-form").querySelector("[name='cameraName']").focus();
  }

  function closeCameraForm() {
    byId("camera-modal").hidden = true;
    byId("camera-form").reset();
    byId("camera-form-error").hidden = true;
  }

  function normalizeCameraUrl(value) {
    var url = value.replace(/^\s+|\s+$/g, "");
    if (!/^https?:\/\//i.test(url) && !/^rtsp:\/\//i.test(url)) {
      url = "http://" + url;
    }
    if (!/^(https?:|rtsp:)\/\/[^\s/?#]+(?:[/?#]|$)/i.test(url)) {
      return null;
    }
    var authority = url.match(/^[a-z][a-z0-9+.-]*:\/\/([^/?#]+)/i);
    if (!authority || authority[1].indexOf("@") !== -1) {
      return null;
    }
    return url;
  }

  function initializeCameraForm() {
    var form = byId("camera-form");
    Array.prototype.forEach.call(document.querySelectorAll("[data-open-camera-form]"), function (button) {
      button.addEventListener("click", openCameraForm);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-close-camera-form]"), function (button) {
      button.addEventListener("click", closeCameraForm);
    });
    byId("add-camera-button").addEventListener("click", openCameraForm);
    byId("camera-modal").addEventListener("keydown", function (event) {
      if (event.key === "Escape" || event.keyCode === 27) {
        closeCameraForm();
      }
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var name = form.querySelector("[name='cameraName']").value.replace(/^\s+|\s+$/g, "");
      var url = normalizeCameraUrl(form.querySelector("[name='cameraUrl']").value);
      var user = form.querySelector("[name='cameraUser']").value;
      var password = form.querySelector("[name='cameraPassword']").value;
      var error = byId("camera-form-error");
      if (!name) {
        error.textContent = "Escribe un nombre para identificar la cámara.";
        error.hidden = false;
        return;
      }
      if (!url) {
        error.textContent = "Usa una dirección HTTP, HTTPS o RTSP válida, sin credenciales dentro de la URL.";
        error.hidden = false;
        return;
      }
      var cameraId = "cam-" + new Date().getTime() + "-" + (state.cameras.length + 1);
      state.cameras.push({ id: cameraId, name: name, streamUrl: url, authRequired: !!(user || password) });
      if (user || password) {
        cameraCredentials[cameraId] = { user: user, password: password };
      }
      saveState();
      renderCameras();
      closeCameraForm();
    });
  }

  function renderLights() {
    var lights = document.querySelectorAll("[data-device]");
    var count = 0;
    Array.prototype.forEach.call(lights, function (card) {
      var name = card.getAttribute("data-device");
      var on = state.lights[name] === true;
      var toggle = card.querySelector(".state-switch");
      card.classList.toggle("is-on", on);
      toggle.setAttribute("aria-checked", on ? "true" : "false");
      toggle.querySelector(".switch-state").textContent = on ? "Encendida" : "Apagada";
      if (on) { count += 1; }
    });
    byId("summary-lights").textContent = String(count);
    byId("lights-count").textContent = count + (count === 1 ? " encendida" : " encendidas");
  }

  function renderPool() {
    var toggle = byId("pool-toggle");
    toggle.setAttribute("aria-checked", state.poolOn ? "true" : "false");
    toggle.querySelector(".switch-state").textContent = state.poolOn ? "Encendido" : "Apagado";
    byId("pool-description").textContent = state.poolOn ? "El motor está en funcionamiento." : "El motor está apagado.";
    byId("summary-pool").textContent = state.poolOn ? "Encendido" : "Apagado";
  }

  function renderGate() {
    byId("gate-description").textContent = state.gateOpen ? "El portón está abierto." : "El portón está cerrado.";
    byId("gate-button-label").textContent = state.gateOpen ? "Cerrar portón" : "Abrir portón";
    byId("gate-button").classList.toggle("is-open", state.gateOpen);
    byId("summary-gate").textContent = state.gateOpen ? "Abierto" : "Cerrado";
  }

  function renderMedia() {
    var tvState = getSelectedTvState();
    byId("volume-value").textContent = tvState.muted ? "--" : tvState.volume + "%";
    byId("volume-slider").value = String(tvState.volume);
    byId("volume-slider").style.setProperty("--volume-level", tvState.volume + "%");
    byId("mute-button").setAttribute("aria-pressed", tvState.muted ? "true" : "false");
    byId("mute-button").classList.toggle("is-muted", tvState.muted);
    byId("media-feedback").textContent = tvApiAvailable ? "TV conectada · controles listos." : (tvApiEverConnected ? "API de notebook desconectada · los comandos no se enviarán." : "Demostración · conecta la API de la notebook para controlar una TV.");
  }

  function getSelectedTvState() {
    var tv = getSelectedTv();
    if (!tv) {
      return { volume: state.volume, muted: state.muted };
    }
    if (!state.tvStates[tv.id]) {
      state.tvStates[tv.id] = {
        volume: tv.id === state.tvId ? state.volume : 35,
        muted: tv.id === state.tvId ? state.muted : false
      };
    }
    state.volume = state.tvStates[tv.id].volume;
    state.muted = state.tvStates[tv.id].muted;
    return state.tvStates[tv.id];
  }

  function initializeControls() {
    var lights = document.querySelectorAll("[data-device]");
    Array.prototype.forEach.call(lights, function (card) {
      card.querySelector(".state-switch").addEventListener("click", function () {
        var name = card.getAttribute("data-device");
        state.lights[name] = !state.lights[name];
        saveState();
        renderLights();
      });
    });
    byId("pool-toggle").addEventListener("click", function () {
      state.poolOn = !state.poolOn;
      saveState();
      renderPool();
    });
    byId("gate-button").addEventListener("click", function () {
      var button = byId("gate-button");
      var nextState = !state.gateOpen;
      button.disabled = true;
      byId("gate-feedback").textContent = nextState ? "Enviando comando de apertura..." : "Enviando comando de cierre...";
      window.setTimeout(function () {
        state.gateOpen = nextState;
        button.disabled = false;
        byId("gate-feedback").textContent = "Estado actualizado localmente. Conecta tu API para accionar el portón.";
        saveState();
        renderGate();
      }, 700);
    });
    byId("volume-slider").addEventListener("input", function () {
      var tvState = getSelectedTvState();
      tvState.volume = Number(this.value);
      tvState.muted = false;
      state.volume = tvState.volume;
      state.muted = false;
      saveState();
      renderMedia();
      if (volumeCommandTimer !== null) { window.clearTimeout(volumeCommandTimer); }
      if (tvApiAvailable) {
        volumeCommandTimer = window.setTimeout(function () {
          sendTvAction("set_volume", tvState.volume);
          volumeCommandTimer = null;
        }, 250);
      }
    });
    byId("volume-slider").addEventListener("change", function () {
      if (volumeCommandTimer !== null) {
        window.clearTimeout(volumeCommandTimer);
        volumeCommandTimer = null;
      }
      if (tvApiAvailable) { sendTvAction("set_volume", Number(this.value)); }
    });
    byId("tv-power-button").addEventListener("click", function () {
      var tv = getSelectedTv();
      if (!tv) { return; }
      if (tv.powerControlReady === true) {
        sendTvAction("power", null);
      } else {
        startTVPairing(tv);
      }
    });
    byId("mute-button").addEventListener("click", function () {
      if (tvApiAvailable) {
        sendTvAction("toggle_mute", null);
        return;
      }
      var tvState = getSelectedTvState();
      tvState.muted = !tvState.muted;
      state.muted = tvState.muted;
      saveState();
      renderMedia();
      sendTvAction("set_mute", tvState.muted);
    });
    byId("tv-pairing-form").addEventListener("submit", function (event) {
      event.preventDefault();
      var tv = getSelectedTv();
      if (!tv) { return; }
      var code = byId("tv-pairing-code").value.replace(/\s+/g, "").toUpperCase();
      byId("media-feedback").textContent = "Verificando el código con el ONN...";
      requestTVPairing(tv, "finish", { code: code }, function (result) {
        tvPairingId = null;
        tv.powerControlReady = result.powerControlReady === true;
        byId("tv-pairing-code").value = "";
        renderTVs();
        requestTVStatus(tv);
        byId("media-feedback").textContent = "ONN emparejado. Consultando su estado...";
      });
    });
    byId("tv-pairing-cancel").addEventListener("click", function () {
      var tv = getSelectedTv();
      if (tv) { cancelTVPairing(tv); }
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-app]"), function (button) {
      button.addEventListener("click", function () {
        sendTvAction("launch_app", button.getAttribute("data-app"));
      });
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-remote-key]"), function (button) {
      button.addEventListener("click", function () {
        var tv = getSelectedTv();
        if (!tv || !tv.powerControlReady) {
          byId("media-feedback").textContent = "Empareja primero este Android TV desde el botón de energía.";
          return;
        }
        sendTvAction("remote_key", button.getAttribute("data-remote-key"));
      });
    });
  }

  function initialize() {
    initializeTabs();
    initializeVersionReader();
    initializePWA();
    initializeAuthentication();
    initializeControls();
    initializeCameraForm();
    initializeAgenda();
    renderTVs();
    renderCameras();
    renderLights();
    renderPool();
    renderGate();
    renderMedia();
    updateClock();
    window.setInterval(updateClock, 1000);
    loadCachedWeather();
    byId("weather-refresh").addEventListener("click", loadWeather);
    byId("tv-refresh").addEventListener("click", requestTVs);
    checkAuthentication();
  }

  function initializeRemoteData() {
    if (!apiAuthenticated || remoteDataInitialized) { return; }
    remoteDataInitialized = true;
    checkBackendVersion();
    loadWeather();
    requestTVs();
    loadEvents();
    if (!remotePollingStarted) {
      remotePollingStarted = true;
      window.setInterval(loadWeather, 30 * 60 * 1000);
      window.setInterval(requestTVs, TV_CONFIG.refreshMs);
      window.setInterval(loadEvents, 60 * 1000);
      window.setInterval(checkBackendVersion, 60 * 1000);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
}());