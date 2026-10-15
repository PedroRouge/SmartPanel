(function () {
  "use strict";

  var STORAGE_KEY = "smart-panel-theme-v1";
  var root = document.documentElement;
  var themeColorMeta = document.querySelector('meta[name="theme-color"]');
  var systemPreference = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  var savedTheme = null;
  var hasManualPreference = false;

  try {
    savedTheme = window.localStorage.getItem(STORAGE_KEY);
    hasManualPreference = savedTheme === "light" || savedTheme === "dark";
  } catch (error) {
    // Private browsing may block storage; keep the system preference in memory.
  }

  function updateThemeControl(theme) {
    var button = document.getElementById("theme-toggle");
    if (!button) { return; }
    var nextLabel = theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro";
    button.setAttribute("aria-label", nextLabel);
    button.setAttribute("title", nextLabel);
    button.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
  }

  function applyTheme(theme) {
    var normalizedTheme = theme === "dark" ? "dark" : "light";
    root.setAttribute("data-theme", normalizedTheme);
    if (themeColorMeta) {
      themeColorMeta.setAttribute("content", normalizedTheme === "dark" ? "#0a0e1a" : "#edf2f9");
    }
    updateThemeControl(normalizedTheme);
  }

  function systemTheme() {
    return systemPreference && systemPreference.matches ? "dark" : "light";
  }

  applyTheme(hasManualPreference ? savedTheme : systemTheme());

  if (systemPreference) {
    var handleSystemChange = function () {
      if (!hasManualPreference) { applyTheme(systemTheme()); }
    };
    if (systemPreference.addEventListener) {
      systemPreference.addEventListener("change", handleSystemChange);
    } else if (systemPreference.addListener) {
      systemPreference.addListener(handleSystemChange);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var button = document.getElementById("theme-toggle");
    if (!button) { return; }
    updateThemeControl(root.getAttribute("data-theme"));
    button.addEventListener("click", function () {
      var nextTheme = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
      hasManualPreference = true;
      applyTheme(nextTheme);
      try {
        window.localStorage.setItem(STORAGE_KEY, nextTheme);
      } catch (error) {
        // The current page remains themed even when storage is unavailable.
      }
    });
  });
}());
