const CACHE_NAME = "game-room-shell-v24";
const APP_SHELL = [
  "./",
  "./index.html",
  "./admin.html",
  "./css/admin.css",
  "./js/admin.js",
  "./css/hub.css",
  "./css/install.css",
  "./js/install.js",
  "./trumps.html",
  "./dominoes.html",
  "./css/dominoes.css",
  "./js/dominoes.js",
  "./js/dominoes-rules.js",
  "./css/app.css",
  "./css/lobby.css",
  "./css/game.css",
  "./js/app.js",
  "./js/config.js",
  "./js/lobby.js",
  "./js/game-ui.js",
  "./js/supabase.js",
  "./js/ui.js",
  "./manifest.webmanifest",
  "./icons/favicon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin && !new URL(event.request.url).searchParams.has('code')) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached || (event.request.mode === 'navigate' ? caches.match(new URL(event.request.url).pathname) : Response.error())))
  );
});
