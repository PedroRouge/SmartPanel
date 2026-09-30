(function () {
  "use strict";

  var STORAGE_KEY = "smart-panel-state-v1";
  var WEATHER_CONFIG = {
    latitude: null,
    longitude: null
  };
  var state = readState();

  function readState() {
    var defaults = {
      lights: { living: false, kitchen: false, bedroom: false, garden: false },
      poolOn: false,
      gateOpen: false,
      volume: 35,
      muted: false
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
    if (typeof WEATHER_CONFIG.latitude !== "number" || typeof WEATHER_CONFIG.longitude !== "number") {
      status.textContent = "Sin ubicación";
      return;
    }
    if (!window.fetch) {
      status.textContent = "API no disponible";
      return;
    }
    var url = "https://api.open-meteo.com/v1/forecast?latitude=" + WEATHER_CONFIG.latitude +
      "&longitude=" + WEATHER_CONFIG.longitude +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min&forecast_days=1&timezone=auto";
    status.textContent = "Actualizando...";
    window.fetch(url).then(function (response) {
      if (!response.ok) { throw new Error("Weather request failed"); }
      return response.json();
    }).then(function (data) {
      var current = data.current;
      var daily = data.daily;
      var summary = weatherDescription(current.weather_code);
      byId("weather-temperature").textContent = Math.round(current.temperature_2m) + "°";
      byId("weather-description").textContent = summary[0];
      byId("weather-symbol").textContent = summary[1];
      byId("weather-high").textContent = Math.round(daily.temperature_2m_max[0]) + "°";
      byId("weather-low").textContent = Math.round(daily.temperature_2m_min[0]) + "°";
      status.textContent = "Actualizado";
      renderForecast(daily, data);
    }).catch(function () {
      status.textContent = "Sin conexión";
      byId("weather-description").textContent = "No se pudo actualizar";
    });
  }

  function renderForecast(daily, data) {
    var list = byId("forecast-list");
    var item = document.createElement("div");
    var summary = weatherDescription(daily.weather_code[0]);
    var day = new Date(daily.time[0] + "T12:00:00");
    item.className = "forecast-item";
    item.innerHTML = "<span class=\"forecast-time\">Hoy</span><span class=\"forecast-icon\" aria-hidden=\"true\"></span><span class=\"forecast-temperature\"></span>";
    item.querySelector(".forecast-icon").textContent = summary[1];
    item.querySelector(".forecast-temperature").textContent = Math.round(daily.temperature_2m_max[0]) + "° / " + Math.round(daily.temperature_2m_min[0]) + "°";
    list.innerHTML = "";
    list.appendChild(item);
    if (data.current && data.current.time) {
      var currentHour = parseInt(data.current.time.slice(11, 13), 10);
      var timeItem = document.createElement("div");
      timeItem.className = "forecast-item";
      timeItem.innerHTML = "<span class=\"forecast-time\"></span><span class=\"forecast-icon\" aria-hidden=\"true\">◷</span><span class=\"forecast-temperature\"></span>";
      timeItem.querySelector(".forecast-time").textContent = "Ahora";
      timeItem.querySelector(".forecast-temperature").textContent = Math.round(data.current.temperature_2m) + "°";
      list.appendChild(timeItem);
      timeItem.setAttribute("aria-label", "Temperatura actual " + Math.round(data.current.temperature_2m) + " grados");
      item.setAttribute("aria-label", "Pronóstico de hoy, " + summary[0] + ", máxima " + Math.round(daily.temperature_2m_max[0]) + " grados");
      day.setHours(currentHour);
    }
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
    byId("volume-value").textContent = state.muted ? "--" : state.volume + "%";
    byId("volume-meter-fill").style.width = (state.muted ? 0 : state.volume) + "%";
    byId("mute-button").setAttribute("aria-pressed", state.muted ? "true" : "false");
    byId("mute-button").classList.toggle("is-muted", state.muted);
    byId("media-feedback").textContent = state.muted ? "Audio silenciado." : "Volumen simulado: " + state.volume + "%";
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
        state.volume = Math.max(0, Math.min(100, state.volume + (button.getAttribute("data-volume") === "up" ? 5 : -5)));
        state.muted = false;
        saveState();
        renderMedia();
      });
    });
    byId("mute-button").addEventListener("click", function () {
      state.muted = !state.muted;
      saveState();
      renderMedia();
    });
  }

  function initialize() {
    initializeTabs();
    initializeControls();
    renderLights();
    renderPool();
    renderGate();
    renderMedia();
    updateClock();
    window.setInterval(updateClock, 1000);
    loadWeather();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initialize);
  } else {
    initialize();
  }
}());