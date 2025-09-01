/* sw.js — TFS offline doc hub */
const SW_FALLBACK_VERSION = '2025.09.01';
let APP_VERSION = SW_FALLBACK_VERSION;

const cacheName = () => `tfs-docs-cache-v${APP_VERSION}`;
const SHELL = ['./', './index.html'];

self.addEventListener('message', (event) => {
  const {type} = event.data || {};
  if (type === 'SET_VERSION') {
    APP_VERSION = event.data.version || SW_FALLBACK_VERSION;
  }
  if (type === 'CACHE_DOCS') {
    const urls = (event.data.urls || []).filter(Boolean);
    event.waitUntil((async () => {
      const c = await caches.open(cacheName());
      await c.addAll(urls.map(u => new Request(u, {cache:'reload'})));
    })());
  }
});

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const c = await caches.open(cacheName());
    await c.addAll(SHELL);
  })());
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => { if (!k.endsWith(`v${APP_VERSION}`)) return caches.delete(k); }));
  })());
  self.clients.claim();
});

// Cache-first for everything under our scope
self.addEventListener('fetch', (event) => {
  const {request} = event;
  if (request.method !== 'GET') return;
  event.respondWith((async () => {
    const c = await caches.open(cacheName());
    const match = await c.match(request, {ignoreVary:true});
    if (match) return match;
    try {
      const resp = await fetch(request);
      // cache PDFs and same-origin assets
      if (new URL(request.url).origin === location.origin) {
        c.put(request, resp.clone());
      }
      return resp;
    } catch (err) {
      // simple offline fallback: return cached shell if request not found
      const shell = await c.match('./index.html');
      return shell || new Response("Offline", {status: 503});
    }
  })());
});
