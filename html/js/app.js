(function () {
  "use strict";

  var STORAGE_KEY = "smart-panel-state-v1";
  var WEATHER_STORAGE_KEY = "smart-panel-weather-v1";
  var WEATHER_CONFIG = {
    latitude: -34.6037,
    longitude: -58.3816,
    location: "Buenos Aires, Argentina"
  };
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
  var weatherRetryTimer = null;
  var weatherHasData = false;

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
    if (window.location.protocol === "file:") {
      return "http://localhost:5000" + path;
    }
    return window.location.protocol + "//" + window.location.hostname + ":5000" + path;
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
    request.timeout = 12000;
    request.onreadystatechange = function () {
      if (request.readyState !== 4 || finished) { return; }
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
    request.onerror = function () { fail("Error de red o CORS"); };
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
      item.setAttribute("aria-label", dayName + ": " + summary[0] + ", máxima " + Math.round(daily.temperature_2m_max[index]) + " grados, mínima " + Math.round(daily.temperature_2m_min[index]) + " grados");
      list.appendChild(item);
    }
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
    var request = new XMLHttpRequest();
    var finished = false;
    byId("tv-refresh").disabled = true;
    request.open("GET", localApiUrl(TV_CONFIG.endpoint), true);
    request.timeout = TV_CONFIG.timeoutMs;
    request.onreadystatechange = function () {
      if (request.readyState !== 4 || finished) { return; }
      finished = true;
      byId("tv-refresh").disabled = false;
      if (request.status < 200 || request.status >= 300) {
        tvApiAvailable = false;
        renderTvApiStatus(tvApiEverConnected ? "API local sin respuesta; estado posiblemente desactualizado." : "API local no conectada; mostrando TVs de demostración.");
        renderMedia();
        return;
      }
      var payload;
      try {
        payload = JSON.parse(request.responseText);
      } catch (error) {
        tvApiAvailable = false;
        renderTvApiStatus(tvApiEverConnected ? "La API devolvió JSON inválido; se conserva el último estado." : "La API local no devolvió JSON válido; mostrando TVs de demostración.");
        renderMedia();
        return;
      }
      var devices = Array.isArray(payload) ? payload : (payload.tvs || payload.devices);
      if (!Array.isArray(devices)) {
        tvApiAvailable = false;
        renderTvApiStatus(tvApiEverConnected ? "La API devolvió un formato inválido; se conserva el último estado." : "Formato de API inválido: se esperaba una lista de TVs.");
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
          poweredOn: typeof device.poweredOn === "boolean" ? device.poweredOn : (device.state === "on" ? true : (device.state === "off" ? false : null)),
          online: device.online === true,
          volume: typeof device.volume === "number" ? Math.max(0, Math.min(100, device.volume)) : null,
          muted: typeof device.muted === "boolean" ? device.muted : null
        };
      });
      tvApiAvailable = true;
      tvApiEverConnected = true;
      if (TV_DEVICES.length && !getTvById(state.tvId)) {
        state.tvId = TV_DEVICES[0].id;
      }
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
    };
    request.onerror = function () {
      if (finished) { return; }
      finished = true;
      byId("tv-refresh").disabled = false;
      tvApiAvailable = false;
      renderTvApiStatus(tvApiEverConnected ? "API local desconectada; estado posiblemente desactualizado." : "API local no conectada; mostrando TVs de demostración.");
      renderMedia();
    };
    request.ontimeout = request.onerror;
    try {
      request.send(null);
    } catch (error) {
      request.onerror();
    }
  }

  function getTvById(id) {
    var index;
    for (index = 0; index < TV_DEVICES.length; index += 1) {
      if (TV_DEVICES[index].id === id) { return TV_DEVICES[index]; }
    }
    return null;
  }

  function sendTVCommand(action, value) {
    var tv = getSelectedTv();
    if (!tv) { return; }
    if (!tvApiAvailable) {
      byId("media-feedback").textContent = tvApiEverConnected ? "No se envió: API local desconectada." : tv.name + " · modo demostración; conecta /api/tvs para enviar comandos.";
      return;
    }
    var request = new XMLHttpRequest();
    request.open("POST", localApiUrl(TV_CONFIG.endpoint + "/" + encodeURIComponent(tv.id) + "/command"), true);
    request.timeout = TV_CONFIG.timeoutMs;
    request.setRequestHeader("Content-Type", "application/json;charset=UTF-8");
    request.onreadystatechange = function () {
      if (request.readyState !== 4) { return; }
      if (request.status >= 200 && request.status < 300) {
        byId("media-feedback").textContent = tv.name + " · comando enviado.";
      } else {
        byId("media-feedback").textContent = tv.name + " · no se pudo enviar el comando.";
      }
    };
    request.onerror = function () { byId("media-feedback").textContent = tv.name + " · error al contactar la API local."; };
    request.ontimeout = request.onerror;
    try {
      request.send(JSON.stringify({ action: action, value: value }));
      byId("media-feedback").textContent = tv.name + " · enviando comando...";
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
      statusMessage = "API local conectada · " + TV_DEVICES.length + (TV_DEVICES.length === 1 ? " TV" : " TVs");
    } else if (tvApiEverConnected) {
      statusMessage = "API local desconectada · datos posiblemente antiguos";
    } else {
      statusMessage = "API local no conectada · lista de demostración";
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
    byId("volume-meter-fill").style.width = (tvState.muted ? 0 : tvState.volume) + "%";
    byId("mute-button").setAttribute("aria-pressed", tvState.muted ? "true" : "false");
    byId("mute-button").classList.toggle("is-muted", tvState.muted);
    byId("media-feedback").textContent = tvApiAvailable ? "TV conectada · controles listos." : "Demostración · no hay conexión con una TV real.";
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
    Array.prototype.forEach.call(document.querySelectorAll("[data-volume]"), function (button) {
      button.addEventListener("click", function () {
        var tvState = getSelectedTvState();
        tvState.volume = Math.max(0, Math.min(100, tvState.volume + (button.getAttribute("data-volume") === "up" ? 5 : -5)));
        state.volume = tvState.volume;
        state.muted = false;
        saveState();
        renderMedia();
        sendTvAction("set_volume", tvState.volume);
      });
    });
    byId("mute-button").addEventListener("click", function () {
      var tvState = getSelectedTvState();
      tvState.muted = !tvState.muted;
      state.muted = tvState.muted;
      saveState();
      renderMedia();
      sendTvAction("set_mute", tvState.muted);
    });
    Array.prototype.forEach.call(document.querySelectorAll("[data-app]"), function (button) {
      button.addEventListener("click", function () {
        sendTvAction("launch_app", button.getAttribute("data-app"));
      });
    });
  }

  function initialize() {
    initializeTabs();
    initializeControls();
    initializeCameraForm();
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
    loadWeather();
    window.setInterval(loadWeather, 30 * 60 * 1000);
    byId("tv-refresh").addEventListener("click", requestTVs);
    requestTVs();
    window.setInterval(requestTVs, TV_CONFIG.refreshMs);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
}());