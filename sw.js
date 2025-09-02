// sw.js — network-first for HTML, cache-first for everything else
const VER = new URL(self.location.href).searchParams.get('v') || 'dev';
const CACHE_NAME = `tfs-docs-${VER}`;
const CORE = [
  './',
  `/sw.js?v=${VER}`,
  '/app.webmanifest',     // ok to cache
  // NOTE: we intentionally DO NOT put /index.html in CORE
];

// Allow page to force activation
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
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

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // 🟢 Network-first for navigations (HTML)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const live = await fetch(req, { cache: 'no-store' });
        // put a copy in cache for offline fallback
        const cache = await caches.open(CACHE_NAME);
        cache.put('/index.html', live.clone());
        return live;
      } catch (e) {
        // offline: serve cached index if we have it
        const cached = await caches.match('/index.html');
        if (cached) return cached;
        // last resort: try any cached root
        return caches.match('./');
      }
    })());
    return;
  }

  // 🗂️ Cache-first for same-origin assets (PDFs, manifest, etc.)
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
        return cached || Response.error();
      }
    })());
  }
});
