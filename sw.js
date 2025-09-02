/* TFS Documents – Service Worker (stable baseline)
   Behavior aligned with your original working setup:
   - Navigations: network-first with offline fallback to cached index.html
   - Static assets: cache-first
   - PDFs: let them load normally (open in a new tab); if cached by the app, serve from cache.
     We do NOT return index.html for PDF requests.
   - Basic support for Range requests by pass-through — Chrome’s PDF viewer will work.
*/

const SW_VERSION  = 'tfs-sw-stable-1';
const ASSET_CACHE = `assets-${SW_VERSION}`;
const ASSET_EXTS  = ['.js', '.css', '.html', '.webmanifest', '.png', '.jpg', '.jpeg', '.svg', '.ico'];

const isAsset = (url) => ASSET_EXTS.some(ext => url.pathname.toLowerCase().endsWith(ext));
const looksLikePDF = (url) => {
  const p = url.pathname.toLowerCase();
  return p.endsWith('.pdf') || p.includes('.pdf/');
};

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map(k => (k.startsWith('assets-') && k !== ASSET_CACHE) ? caches.delete(k) : Promise.resolve()));
  })());
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const wantsRange = req.headers.has('range');
  const isPdf = looksLikePDF(url);

  // A) PDF requests — DO NOT fall back to index.html.
  //    Try cache (any cache) first, then network; for Range, just pass-through.
  if (isPdf) {
    event.respondWith((async () => {
      try {
        if (wantsRange) {
          // Let the browser/OS PDF viewer manage chunked reads
          return await fetch(req);
        }
        const cached = await caches.match(req);
        if (cached) return cached;

        const net = await fetch(req);
        // Optionally store in assets cache to help offline
        if (net && net.ok) {
          const cache = await caches.open(ASSET_CACHE);
          cache.put(req, net.clone());
        }
        return net;
      } catch {
        return new Response('PDF unavailable.', { status: 503 });
      }
    })());
    return;
  }

  // B) Navigations (the app)
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const net = await fetch(req);
        return net;
      } catch {
        const cached = await caches.match('index.html');
        return cached || new Response('Offline.', { status: 503 });
      }
    })());
    return;
  }

  // C) Static assets: cache-first
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

  // D) Everything else (e.g., JSON manifest): network-first with fallback to any cached response
  event.respondWith((async () => {
    try {
      const net = await fetch(req, { cache: 'no-cache' });
      if (net && net.ok && (net.headers.get('content-type') || '').includes('application/json')) {
        const cache = await caches.open(ASSET_CACHE);
        cache.put(req, net.clone());
      }
      return net;
    } catch {
      const cached = await caches.match(req);
      return cached || new Response('Offline.', { status: 503 });
    }
  })());
});
