"use strict";

// Firebase Messaging se ejecuta dentro del mismo worker que controla la PWA.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
// La configuración runtime se genera en el despliegue; puede no existir en desarrollo.
try {
  importScripts("/js/firebase-runtime-config.js?v=75");
} catch (error) {
  console.warn("[ServiceWorker] No se encontró la configuración runtime de Firebase.", error);
}
try {
  var messaging = null;
  if (self.SMART_PANEL_FIREBASE_RUNTIME_CONFIG && self.SMART_PANEL_FIREBASE_RUNTIME_CONFIG.apiKey) {
    firebase.initializeApp(self.SMART_PANEL_FIREBASE_RUNTIME_CONFIG);
    messaging = firebase.messaging();
  }
  if (messaging) {
  messaging.onBackgroundMessage(function (payload) {
    if (payload.notification) { return; }
    var data = payload.data || {};
    return self.registration.showNotification(data.title || "Smart Panel", {
      body: data.body || "Tenés una actualización.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: data.url || "/" }
    });
  });
  }
} catch (error) {
  // Mantiene la PWA funcional en navegadores donde FCM web no está soportado.
  console.warn("[FCM] Messaging no disponible en este navegador.", error);
}
self.addEventListener("notificationclick", function (event) {
  var notificationUrl = event.notification.data && event.notification.data.url || "/#inicio";
  event.notification.close();
  var parsedTarget = new URL(notificationUrl, self.location.origin);
  var target = parsedTarget.origin === self.location.origin ? parsedTarget.href : self.location.origin + "/";
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
    for (var i = 0; i < clients.length; i++) {
      if (new URL(clients[i].url).origin === self.location.origin && "focus" in clients[i]) {
        if ("navigate" in clients[i]) {
          return clients[i].navigate(target).then(function (client) { return client && client.focus(); });
        }
        return clients[i].focus();
      }
    }
    return self.clients.openWindow(target);
  }));
});

var CACHE_PREFIX = "smart-panel-shell-";
var CACHE_NAME = CACHE_PREFIX + "92";
var STATIC_FILES = [
  "/",
  "/manifest.json",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-512-dark.png",
  "/icons/icon-maskable.png",
  "/icons/apple-touch-icon.png",
  "/icons/favicon.ico",
  "/icons/favicon-32.png",
  "/icons/favicon-48.png",
  "/css/styles.css?v=84",
  "/css/swiss-ui.css?v=84",
  "/js/theme-init.js?v=84",
  "/js/bootstrap.js?v=71",
  "/js/firebase-runtime-config.js?v=75",
  "/js/firebase-config.js?v=75",
  "/js/app.js?v=91"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    // Un recurso ausente no debe abortar la instalación completa del worker.
    return Promise.allSettled(STATIC_FILES.map(function (file) {
      return cache.add(new Request(file, { cache: "reload" }));
    })).then(function (results) {
      var failed = results.filter(function (result) { return result.status === "rejected"; });
      if (failed.length) {
        console.warn("[ServiceWorker] No se pudieron precachear " + failed.length + " recursos.");
      }
    });
  }).then(function () {
    return self.skipWaiting();
  }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.map(function (key) {
      if (key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE_NAME) {
        console.log("[ServiceWorker] Purgando caché obsoleta:", key);
        return caches.delete(key);
      }
      return false;
    }));
  }).then(function () {
    return self.clients.claim();
  }));
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var url = new URL(request.url);

  // Sólo se cachean peticiones GET del propio origen.
  if (request.method !== "GET") { return; }

  // No interceptar peticiones a Firebase ni APIs externas
  if (url.origin.endsWith("firebaseio.com") ||
      url.origin.endsWith("firebasedatabase.app") ||
      url.origin.endsWith("googleapis.com") ||
      url.origin.endsWith("open-meteo.com") ||
      url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(function (response) {
      // Sólo se guarda en "/" la navegación real del shell: cachear cualquier otra
      // ruta (SPA fallback, 404, error) envenenaría la entrada "/" del caché.
      if (response.ok && response.type === "basic" && url.pathname === "/") {
        var copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
          return cache.put("/", copy);
        }));
      }
      return response;
    }).catch(function () {
      return caches.match("/").then(function (cached) { return cached || Response.error(); });
    }));
    return;
  }

  var isAppAsset = url.pathname.indexOf("/css/") === 0 || url.pathname.indexOf("/js/") === 0 || url.pathname.indexOf("/icons/") === 0 || url.pathname === "/manifest.json";
  if (!isAppAsset) { return; }

  // Estrategia Network-First para assets JS/CSS para evitar que queden atascados con versiones viejas
  event.respondWith(
    fetch(request).then(function (response) {
      if (response.ok) {
        var copy = response.clone();
        event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
          return cache.put(request, copy);
        }));
      }
      return response;
    }).catch(function () {
      return caches.match(request);
    })
  );
});
