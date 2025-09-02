// Service Worker (version comes from URL param ?v=...)
const VER = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = `tfs-docs-${VER}`;
const CORE = [
  './',
  '/index.html',
  '/app.webmanifest',
  `/sw.js?v=${VER}`,
];

// Allow page to trigger skip waiting
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await cache.addAll(CORE);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)));
  })());
  self.clients.claim();
});

// Cache-first for same-origin GET requests; fall back to network
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    event.respondWith((async () => {
      const cached = await caches.match(req, { ignoreSearch: false });
      if (cached) return cached;
      try {
        const resp = await fetch(req);
        const cache = await caches.open(CACHE_NAME);
        cache.put(req, resp.clone());
        return resp;
      } catch (e) {
        // offline and not cached
        return caches.match('/index.html');
      }
    })());
  }
});
