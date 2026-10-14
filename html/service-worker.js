"use strict";

// Firebase Messaging se ejecuta dentro del mismo worker que controla la PWA.
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js");
firebase.initializeApp({
  apiKey: "AIzaSyAnf7z9wl24JNJgFutE0qRvnnBnquNWoNc",
  authDomain: "smart-panel-53d7b.firebaseapp.com",
  databaseURL: "https://smart-panel-53d7b-default-rtdb.firebaseio.com",
  projectId: "smart-panel-53d7b",
  storageBucket: "smart-panel-53d7b.firebasestorage.app",
  messagingSenderId: "1085885262056",
  appId: "1:1085885262056:web:90373760572ff556f1015d"
});
try {
  var messaging = firebase.messaging();
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
} catch (error) {
  // Mantiene la PWA funcional en navegadores donde FCM web no está soportado.
  console.warn("[FCM] Messaging no disponible en este navegador.", error);
}
self.addEventListener("notificationclick", function (event) {
  var notificationUrl = event.notification.data && event.notification.data.url;
  if (!notificationUrl) { return; }
  event.notification.close();
  var target = new URL(notificationUrl, self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (clients) {
    for (var i = 0; i < clients.length; i++) {
      if (clients[i].url === target && "focus" in clients[i]) { return clients[i].focus(); }
    }
    return self.clients.openWindow(target);
  }));
});

var CACHE_PREFIX = "smart-panel-shell-";
var CACHE_NAME = CACHE_PREFIX + "36";
var STATIC_FILES = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/css/styles.css?v=36",
  "/js/firebase-config.js?v=36",
  "/js/app.js?v=36"
];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE_NAME).then(function (cache) {
    return cache.addAll(STATIC_FILES);
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

  // No interceptar peticiones a Firebase ni APIs externas
  if (url.origin.indexOf("firebaseio.com") !== -1 ||
      url.origin.indexOf("googleapis.com") !== -1 ||
      url.origin.indexOf("open-meteo.com") !== -1 ||
      url.origin !== self.location.origin) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(fetch(request).then(function (response) {
      if (response.ok) {
        caches.open(CACHE_NAME).then(function (cache) { cache.put("/", response.clone()); });
      }
      return response;
    }).catch(function () {
      return caches.match("/").then(function (cached) { return cached || Response.error(); });
    }));
    return;
  }

  var isAppAsset = url.pathname.indexOf("/css/") === 0 || url.pathname.indexOf("/js/") === 0 || url.pathname.indexOf("/icons/") === 0 || url.pathname === "/manifest.webmanifest";
  if (!isAppAsset) { return; }

  // Estrategia Network-First para assets JS/CSS para evitar que queden atascados con versiones viejas
  event.respondWith(
    fetch(request).then(function (response) {
      if (response.ok) {
        var copy = response.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(request, copy); });
      }
      return response;
    }).catch(function () {
      return caches.match(request);
    })
  );
});
