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

}());
