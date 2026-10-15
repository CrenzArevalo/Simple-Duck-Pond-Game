/* Kinay's Duck Pond — offline service worker.
   The whole game is static, so we precache the shell + scripts and then serve
   from cache. Navigations are network-first so a new deploy shows up quickly,
   with the cached shell as the offline fallback. */

const VERSION = 'v1';
const CACHE = 'duckpond-' + VERSION;

const ASSETS = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'vendor/three.min.js',
  'js/sounds-data.js',
  'js/audio.js',
  'js/items.js',
  'js/renderer-utils.js',
  'js/preview.js',
  'js/world.js',
  'js/game.js',
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Navigations: try the network first, fall back to the cached shell offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put('index.html', copy));
          return res;
        })
        .catch(() => caches.match('index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // Everything else: cache-first, refresh in the background.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
