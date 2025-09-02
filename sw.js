// sw.js — TFS Docs service worker
// Bump this string when you update the worker to ensure it updates on clients:
const SW_VERSION = "2025.09.15-1";

self.addEventListener("install", (event) => {
  // Activate immediately so this page is controlled without an extra refresh
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  // Take control of all open pages under scope
  event.waitUntil(self.clients.claim());
});

// Utility: respond to Range requests (needed for Chrome's PDF viewer offline)
async function handleRangeRequest(event, cachedResponse) {
  try {
    const rangeHeader = event.request.headers.get("range");
    if (!rangeHeader) return null;

    // Parse "bytes=start-end"
    const m = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (!m) return null;

    const resp = cachedResponse || (await caches.match(event.request));
    if (!resp) return null;

    const buf = await resp.arrayBuffer();
    const total = buf.byteLength;

    let start = m[1] ? parseInt(m[1], 10) : 0;
    let end   = m[2] ? parseInt(m[2], 10) : total - 1;
    start = Math.min(start, total - 1);
    end   = Math.min(end, total - 1);

    const chunk = buf.slice(start, end + 1);
    return new Response(chunk, {
      status: 206,
      statusText: "Partial Content",
      headers: {
        "Content-Type": resp.headers.get("Content-Type") || "application/octet-stream",
        "Content-Range": `bytes ${start}-${end}/${total}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunk.byteLength),
      },
    });
  } catch (e) {
    // If anything goes wrong, allow normal flow
    return null;
  }
}

self.addEventListener("fetch", (event) => {
  // Only handle GETs
  if (event.request.method !== "GET") return;

  event.respondWith((async () => {
    // 1) For navigations (index.html): try network first, then cache
    if (event.request.mode === "navigate") {
      try {
        const net = await fetch(event.request);
        return net;
      } catch {
        const cached = await caches.match(event.request) ||
                       await caches.match(new URL("./", self.registration.scope).toString()) ||
                       await caches.match("index.html");
        if (cached) return cached;
        return new Response("Offline", { status: 503, statusText: "Offline" });
      }
    }

    // 2) For everything else: Range-aware cache-first, then network
    // First try Cache
    const cached = await caches.match(event.request);
    if (cached) {
      // Serve Range if requested (e.g., PDFs)
      const ranged = await handleRangeRequest(event, cached);
      return ranged || cached;
    }

    // Not cached: go to network, then drop into cache for future offline
    try {
      const net = await fetch(event.request);
      // Store a clone in a best-effort cache
      try {
        const cache = await caches.open("tfs-runtime"); // generic runtime cache name
        cache.put(event.request, net.clone());
      } catch { /* ignore cache put errors */ }

      // If Range requested and we just fetched full response, still try to honor range
      const ranged = await handleRangeRequest(event, net.clone());
      return ranged || net;
    } catch {
      return new Response("Offline", { status: 503, statusText: "Offline" });
    }
  })());
});
