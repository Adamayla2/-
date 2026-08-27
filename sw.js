// Minimal app-shell cache. This app's core job (AI extraction) needs a live
// network connection no matter what, so this deliberately does NOT try to
// be a full offline-first PWA — it just makes repeat loads of the app UI
// itself faster and lets the browser install it as an app.
const CACHE_NAME = 'tonsil-study-shell-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './css/style.css',
  './manifest.json',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL_FILES)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  // Only ever serve our own static shell from cache. Everything else
  // (Anthropic API, SheetJS/pdf.js CDNs, fonts) always goes to the network.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request))
  );
});
