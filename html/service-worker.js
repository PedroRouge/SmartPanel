"use strict";

var CACHE_PREFIX = "smart-panel-shell-";
var CACHE_NAME = CACHE_PREFIX + "28";
var STATIC_FILES = [
  "/",
  "/manifest.webmanifest",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/apple-touch-icon.png",
  "/css/styles.css?v=28",
  "/js/app.js?v=28"
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
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.indexOf("/api/") === 0) {
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
  event.respondWith(caches.open(CACHE_NAME).then(function (cache) {
    return cache.match(request).then(function (cached) {
      var update = fetch(request).then(function (response) {
        if (response.ok) { cache.put(request, response.clone()); }
        return response;
      });
      return cached || update.catch(function () { return Response.error(); });
    });
  }));
});