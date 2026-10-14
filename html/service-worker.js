"use strict";

var CACHE_PREFIX = "smart-panel-shell-";
var CACHE_NAME = CACHE_PREFIX + "34";
var STATIC_FILES = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/css/styles.css?v=34",
  "/js/firebase-config.js?v=34",
  "/js/app.js?v=34"
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