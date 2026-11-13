'use strict';

importScripts('lib.js', 'store.js', 'alerts.js');

// Bump when the cached files change so clients pick up the new shell.
var CACHE = 'haze-tracker-v1';
var SHELL = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'lib.js',
  'store.js',
  'alerts.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(SHELL); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (keys) {
        return Promise.all(
          keys
            .filter(function (k) { return k.indexOf('haze-tracker-') === 0 && k !== CACHE; })
            .map(function (k) { return caches.delete(k); })
        );
      })
      .then(function () { return self.clients.claim(); })
  );
});

// App shell: serve from cache instantly, refresh the cache in the background.
// NEA API calls are cross-origin and are not intercepted.
self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(req, { ignoreSearch: true }).then(function (cached) {
        var network = fetch(req)
          .then(function (res) {
            if (res && res.ok) cache.put(req, res.clone());
            return res;
          })
          .catch(function () { return null; });
        if (cached) return cached;
        return network.then(function (res) {
          if (res) return res;
          return req.mode === 'navigate' ? cache.match('index.html') : Response.error();
        });
      });
    })
  );
});

// Background check where the browser supports it (installed PWA on Android Chrome).
self.addEventListener('periodicsync', function (event) {
  if (event.tag === 'haze-check') {
    event.waitUntil(self.HazeAlerts.checkAlerts(self.registration).catch(function () {}));
  }
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (all) {
      for (var i = 0; i < all.length; i++) {
        if ('focus' in all[i]) return all[i].focus();
      }
      return self.clients.openWindow('./');
    })
  );
});
