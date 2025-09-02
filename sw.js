/* TFS Documents – Service Worker
   Changes in this version:
   - Ensures PDF clicks open the actual PDF (and not the app shell)
   - Cache-first for assets; network for navigations, with a simple offline fallback
   - Basic Range request passthrough for PDF viewers
*/

const SW_VERSION = 'tfs-sw-v7';
const ASSET_CACHE = `assets-${SW_VERSION}`;

// Match simple static assets for cache-first
const ASSET_EXTS = ['.js', '.css', '.html', '.webmanifest', '.png', '.jpg', '.jpeg', '.svg', '.ico'];

// Utility helpers
const isPDF = (url) => url.pathname.toLowerCase().endsWith('.pdf');
const isAsset = (url) => ASSET_EXTS.some(ext => url.pathname.toLowerCase().endsWith(ext));

self.addEventListener('install', (event) => {
  // no pre-cache required; app prefetch flow handles large files
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    // Clean old caches if you rev SW_VERSION often
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.startsWith('assets-') && k !== ASSET_CACHE) ? caches.delete(k) : Promise.resolve()));
  })());
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const wantsRange = req.headers.has('range');
  const pdf = isPDF(url);

  // (A) PDF handling — let the PDF actually load, not the app shell.
  // Use cache-first for offline support; support basic Range passthrough.
  if (pdf) {
    event.respondWith((async () => {
      try {
        const cache = await caches.open(ASSET_CACHE);

        // Range requests: pass through to network (viewer will request more chunks)
        if (wantsRange) {
          const netRes = await fetch(req);
          if (!netRes || !netRes.ok) {
            const cached = await cache.match(req);
            return cached || netRes;
          }
          // Optionally cache full-body responses if server sends 200 + Accept-Ranges
          return netRes;
        }

        // Non-range: cache-first
        const cached = await cache.match(req);
        if (cached) return cached;

        const netRes = await fetch(req, { cache: 'no-cache' });
        if (netRes && netRes.ok) {
          cache.put(req, netRes.clone());
        }
        return netRes;
      } catch (e) {
        // Last-resort: try any cached index as an offline indicator (not ideal for PDFs)
        const fallback = await caches.match('index.html');
        return fallback || new Response('Offline and PDF not cached.', { status: 503 });
      }
    })());
    return;
  }

  // (B) HTML navigations (the app itself)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        // Network first so updates deploy immediately
        const net = await fetch(req);
        return net;
      } catch {
        // Offline fallback to any cached index
        const cached = await caches.match('index.html');
        return cached || new Response('Offline.', { status: 503 });
      }
    })());
    return;
  }

  // (C) Static assets: cache-first
  if (isAsset(url)) {
    event.respondWith((async () => {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(req);
      if (cached) return cached;
      const net = await fetch(req);
      if (net && net.ok) cache.put(req, net.clone());
      return net;
    })());
    return;
  }

  // (D) Everything else (e.g., JSON manifest, API): network with gentle fallback; cache updated responses
  event.respondWith((async () => {
    try {
      const net = await fetch(req, { cache: 'no-cache' });
      // Optionally cache small text/json for resiliency
      if (net && net.ok && (net.headers.get('content-type') || '').includes('application/json')) {
        const cache = await caches.open(ASSET_CACHE);
        cache.put(req, net.clone());
      }
      return net;
    } catch {
      const cache = await caches.open(ASSET_CACHE);
      const cached = await cache.match(req);
      return cached || new Response('Offline.', { status: 503 });
    }
  })());
});
