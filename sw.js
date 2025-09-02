/* TFS Documents – Service Worker (robust PDF handling)
   - Detect PDFs even with query/hash (e.g., file.pdf#page=2 or file.pdf?dl=1)
   - Never serve index.html as a fallback for a PDF (avoid "reopens the app")
   - Cache-first for static assets; network-first for navigations
   - Basic Range passthrough for PDF viewers
*/

const SW_VERSION = 'tfs-sw-v9';
const ASSET_CACHE = `assets-${SW_VERSION}`;
const ASSET_EXTS = ['.js', '.css', '.html', '.webmanifest', '.png', '.jpg', '.jpeg', '.svg', '.ico'];

// Helpers
function cleanPathname(u) {
  // Strip trailing slashes from path segments used by some CDNs, keep file name exact
  return u.pathname.toLowerCase();
}
function looksLikePDF(urlObj, req) {
  // 1) Path ends with .pdf, or contains ".pdf" before a slash
  const p = cleanPathname(urlObj);
  if (p.endsWith('.pdf') || p.includes('.pdf/')) return true;

  // 2) Some servers put .pdf in the last segment but add a trailing slash and query/hash
  // Already covered by includes('.pdf/'), but we also check search/hash just in case:
  if (urlObj.search.toLowerCase().includes('.pdf') || urlObj.hash.toLowerCase().includes('.pdf')) return true;

  // 3) Content negotiation hint (not always present)
  const accept = req.headers.get('accept') || '';
  if (accept.includes('application/pdf')) return true;

  return false;
}
const isAsset = (urlObj) => ASSET_EXTS.some(ext => cleanPathname(urlObj).endsWith(ext));

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(k => (k.startsWith('assets-') && k !== ASSET_CACHE) ? caches.delete(k) : Promise.resolve())
    );
  })());
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const wantsRange = req.headers.has('range');
  const pdfLike = looksLikePDF(url, req);

  // (A) PDF (or PDF-like) requests — cache-first + Range passthrough
  if (pdfLike) {
    event.respondWith((async () => {
      try {
        const cache = await caches.open(ASSET_CACHE);

        // Range requests: stream from network (viewer does chunked reads)
        if (wantsRange) {
          const net = await fetch(req);
          // If network fails, try cache; DO NOT return index.html
          if (!net || !net.ok) {
            const cached = await cache.match(req);
            if (cached) return cached;
            return new Response('PDF unavailable (network error).', { status: 502 });
          }
          return net;
        }

        // Non-range: cache-first for offline usage
        const cached = await cache.match(req);
        if (cached) return cached;

        const net = await fetch(req, { cache: 'no-cache' });
        if (net && net.ok) {
          // Cache only successful responses
          cache.put(req, net.clone());
        }
        return net.ok ? net : new Response('PDF not found.', { status: net.status || 404 });
      } catch (e) {
        // Never return app shell for a PDF
        return new Response('PDF unavailable (offline).', { status: 503 });
      }
    })());
    return;
  }

  // (B) HTML navigations (the app)
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

  // (D) JSON / everything else: network-first, cache fallback for resilience
  event.respondWith((async () => {
    try {
      const net = await fetch(req, { cache: 'no-cache' });
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
