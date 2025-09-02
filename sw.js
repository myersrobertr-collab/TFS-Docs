/* TFS Documents – Service Worker (v11, robust PDF clicks)
   Key fixes:
   - Search *all caches* for PDFs (so prefetched docs in any cache name are found)
   - Never return index.html (HTML) when a PDF was requested
   - Cache-first for PDFs; Range passthrough; network-first for navigations; cache-first for static assets
*/

const SW_VERSION = 'tfs-sw-v11';
const ASSET_CACHE = `assets-${SW_VERSION}`;
const PDF_CACHE   = `pdfs-${SW_VERSION}`;
const ASSET_EXTS  = ['.js', '.css', '.html', '.webmanifest', '.png', '.jpg', '.jpeg', '.svg', '.ico'];

// Helpers
const lowerPath = (u) => u.pathname.toLowerCase();
const isAsset = (urlObj) => ASSET_EXTS.some(ext => lowerPath(urlObj).endsWith(ext));

// Detect PDF even with query/hash/CDN suffixes
function looksLikePDF(urlObj, req) {
  const p = lowerPath(urlObj);
  if (p.endsWith('.pdf')) return true;
  if (p.includes('.pdf/')) return true;               // e.g., /file.pdf/preview
  if (urlObj.search.toLowerCase().includes('.pdf')) return true;
  if (urlObj.hash.toLowerCase().includes('.pdf')) return true;
  const accept = req.headers.get('accept') || '';
  if (accept.includes('application/pdf')) return true;
  return false;
}

// Match in any cache (not just our own)
async function matchAnyCache(req) {
  try { return await caches.match(req); } catch { return null; }
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.map(k => (k.startsWith('assets-') || k.startsWith('pdfs-')) && k !== ASSET_CACHE && k !== PDF_CACHE
        ? caches.delete(k)
        : Promise.resolve())
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

  // (A) PDF (or PDF-like) requests: cache-first + Range passthrough
  if (pdfLike) {
    event.respondWith((async () => {
      try {
        // Range requests: stream from network; if it fails, try *any* cache
        if (wantsRange) {
          const net = await fetch(req);
          if (!net || !net.ok) {
            const cached = await matchAnyCache(req);
            if (cached) return cached;
            return new Response('PDF unavailable (network error).', { status: 502 });
          }
          return net;
        }

        // Non-range: cache-first from ANY cache
        const cachedAny = await matchAnyCache(req);
        if (cachedAny) return cachedAny;

        // Otherwise fetch; only accept non-HTML for a PDF request
        const net = await fetch(req, { cache: 'no-cache' });
        const ct = (net.headers.get('content-type') || '').toLowerCase();
        if (ct.includes('text/html')) {
          // This is likely an SPA fallback (index.html). Do NOT serve it for PDFs.
          return new Response('PDF not found (got HTML).', { status: 404 });
        }

        // Store successful PDF responses in a dedicated cache for speed/offline
        if (net && net.ok) {
          const cache = await caches.open(PDF_CACHE);
          cache.put(req, net.clone());
        }
        return net;
      } catch {
        return new Response('PDF unavailable (offline).', { status: 503 });
      }
    })());
    return;
  }

  // (B) HTML navigations: network-first with offline fallback
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

  // (D) JSON/other: network-first with cached fallback
  event.respondWith((async () => {
    try {
      const net = await fetch(req, { cache: 'no-cache' });
      if (net && net.ok && (net.headers.get('content-type') || '').includes('application/json')) {
        const cache = await caches.open(ASSET_CACHE);
        cache.put(req, net.clone());
      }
      return net;
    } catch {
      const cached = await matchAnyCache(req);
      return cached || new Response('Offline.', { status: 503 });
    }
  })());
});
