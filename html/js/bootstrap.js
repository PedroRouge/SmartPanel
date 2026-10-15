(function () {
  "use strict";

  window.addEventListener("securitypolicyviolation", function (event) {
    console.warn("[CSP]", event.effectiveDirective, event.blockedURI, event.sourceFile || "");
  });

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.getRegistrations().then(function (registrations) {
      registrations.forEach(function (registration) { registration.update(); });
    }).catch(function (error) {
      console.warn("[ServiceWorker] No se pudieron actualizar los registros:", error);
    });
  }

  if ("caches" in window) {
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf("smart-panel-shell-") === 0 && key !== "smart-panel-shell-70";
      }).map(function (key) { return caches.delete(key); }));
    }).catch(function (error) {
      console.warn("[ServiceWorker] No se pudieron limpiar cachés anteriores:", error);
    });
  }
}());
