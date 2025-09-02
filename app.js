/* app.js — TFS Docs
   Works with index.html + docs/manifest.json + sw.js
   ------------------------------------------------- */

// ---------- Config ----------
const APP_VERSION   = window.APP_VERSION  || "2025.9.1";
const MANIFEST_URL  = window.MANIFEST_URL || "docs/manifest.json";
const RUNTIME_CACHE = "tfs-runtime-" + APP_VERSION;

// ---------- State ----------
let DOCS = [];            // sections array from manifest
let TAGS = [];            // tagMeta from manifest
let selectedTag =
  localStorage.getItem("tfs.selectedTag") || "All";

// Detect PWA / standalone mode (iOS + other)
const isStandalone =
  window.matchMedia?.("(display-mode: standalone)").matches ||
  window.navigator.standalone === true;

// ---------- Utils ----------
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const abs = (u) => new URL(u, location.href).toString();

function setVersionLabel() {
  const el = $("#ver");
  if (el) el.textContent = APP_VERSION;
}

function getTagBarHost() {
  // be forgiving about container id
  return $("#tagBar") || $("#tags") || $("#tagbar");
}

function ensureSW() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
}

// ---------- Rendering ----------
function renderTagBar() {
  const host = getTagBarHost();
  if (!host) return;

  host.innerHTML = "";

  const allBtn = document.createElement("button");
  allBtn.className = "tag-btn" + (selectedTag === "All" ? " active" : "");
  allBtn.textContent = "All";
  allBtn.addEventListener("click", () => {
    selectedTag = "All";
    localStorage.setItem("tfs.selectedTag", selectedTag);
    renderTagBar();
    renderSections(DOCS);
  });
  host.appendChild(allBtn);

  TAGS.forEach((tag) => {
    const b = document.createElement("button");
    // Give EMER a special class so CSS can style it red
    const emer = tag.toLowerCase() === "emer";
    b.className =
      "tag-btn" + (emer ? " tag-emer" : "") + (selectedTag === tag ? " active" : "");
    b.textContent = tag;
    b.addEventListener("click", () => {
      selectedTag = tag;
      localStorage.setItem("tfs.selectedTag", selectedTag);
      renderTagBar();
      renderSections(DOCS);
    });
    host.appendChild(b);
  });
}

function renderSections(sections) {
  const host = $("#sections");
  if (!host) return;
  host.innerHTML = "";

  const passTag = (sec) => {
    if (selectedTag === "All") return true;
    const tags = (sec.tags || []).map((t) => t.toLowerCase());
    return tags.includes(selectedTag.toLowerCase());
  };

  sections
    .filter(passTag)
    .forEach((sec) => {
      const section = document.createElement("section");
      section.className = "section";

      // Section Header
      const h = document.createElement("div");
      h.className = "section-head";
      const title = document.createElement("h2");
      title.textContent = sec.title || "";
      h.appendChild(title);
      section.appendChild(h);

      // Grid
      const grid = document.createElement("div");
      grid.className = "grid";

      (sec.items || []).forEach((it) => {
        const card = document.createElement("div");
        card.className = "card";

        const label = document.createElement("div");
        label.className = "label";
        label.textContent = it.label || "Untitled";

        const button = document.createElement("a");
        button.className = "btn";
        // Keep PDFs inside app when installed; new tab in browser
        button.target = isStandalone ? "_self" : "_blank";
        button.rel = "noopener";
        button.href = it.href;

        // EMER card button look? Add a class for CSS to hook if item/section tagged EMER
        const itemTags = (it.tags || []).map((t) => t.toLowerCase());
        if (
          itemTags.includes("emer") ||
          (sec.tags || []).map((t) => t.toLowerCase()).includes("emer")
        ) {
          card.classList.add("emer-card");
          button.classList.add("emer-btn");
        }

        button.textContent = it.label || "Open";

        // Offline blob fallback (PWA only, and only when offline)
        button.addEventListener("click", async (e) => {
          if (!isStandalone) return;      // browser path can use normal
          if (navigator.onLine) return;   // online can use normal

          e.preventDefault();
          const url = abs(it.href);
          const match = await caches.match(url);
          if (match) {
            const blob = await match.blob();
            const objectUrl = URL.createObjectURL(blob);
            // navigate in-place so we stay under SW control
            location.href = objectUrl;
          } else {
            // Try normal nav (likely fails offline)
            location.href = it.href;
          }
        });

        card.appendChild(label);
        card.appendChild(button);
        grid.appendChild(card);
      });

      section.appendChild(grid);
      host.appendChild(section);
    });
}

// ---------- Offline download with progress ----------
function buildProgressUI() {
  // Create ephemeral overlay for progress if it doesn't exist
  let overlay = $("#dlOverlay");
  if (overlay) return overlay;

  overlay = document.createElement("div");
  overlay.id = "dlOverlay";
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:9999;display:flex;align-items:center;justify-content:center;";
  overlay.innerHTML = `
    <div style="background:#111827;border:1px solid #1f2937;padding:16px 18px;border-radius:14px;min-width:320px;color:#e5e7eb">
      <div style="font-weight:700;margin-bottom:8px">Caching documents for offline use…</div>
      <div id="dlText" style="font-size:13px;color:#9ca3af;margin-bottom:8px">Starting…</div>
      <div style="height:10px;background:#0f172a;border:1px solid #243041;border-radius:999px;overflow:hidden">
        <div id="dlBar" style="height:100%;width:0%;background:#2563eb"></div>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  return overlay;
}

function updateProgress(current, total) {
  const pct = total ? Math.round((current / total) * 100) : 0;
  const bar = $("#dlBar");
  const text = $("#dlText");
  if (bar) bar.style.width = `${pct}%`;
  if (text) text.textContent = `Downloading ${current} of ${total} (${pct}%)`;
}

async function downloadForOffline(sections) {
  const overlay = buildProgressUI();

  // Build URL list (absolute) for all PDFs + a few critical app files
  const urls = new Set(["./", "index.html", "app.webmanifest", "sw.js"]);
  sections.forEach((s) => (s.items || []).forEach((it) => urls.add(abs(it.href))));

  // Open a versioned runtime cache
  const cache = await caches.open(RUNTIME_CACHE);

  const all = Array.from(urls);
  let done = 0;
  updateProgress(0, all.length);

  for (const url of all) {
    try {
      // Try to fetch fresh, then put; if offline, fall back to any existing cache entry
      const res = await fetch(url, { cache: "no-cache" });
      if (res.ok) await cache.put(url, res.clone());
    } catch {
      // ignore fetch errors; existing cached entry (if any) will remain
    } finally {
      done += 1;
      updateProgress(done, all.length);
    }
  }

  // Seal it
  setTimeout(() => overlay.remove(), 500);
  localStorage.setItem("tfs.offline.cached", "1");
  alert("Documents cached for offline use 👍");
}

// ---------- Manifest loading & update banner ----------
function showUpdateBanner(text) {
  // If a banner already exists, update it; else create one
  let bar = $("#updateBanner");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "updateBanner";
    bar.style.cssText =
      "background:#111827;border-bottom:1px solid #1f2937;color:#e5e7eb;padding:10px 14px;text-align:center";
    document.body.prepend(bar);
  }
  bar.textContent = text || "New documents are available.";
}

async function loadDocs() {
  try {
    const r = await fetch(`${MANIFEST_URL}?v=${encodeURIComponent(APP_VERSION)}`, {
      cache: "no-cache",
    });
    if (!r.ok) throw new Error("manifest missing");
    const m = await r.json();

    TAGS = Array.isArray(m.tagMeta) ? m.tagMeta : [];
    DOCS = Array.isArray(m.sections) ? m.sections : [];

    // Version change banner
    const previous = localStorage.getItem("tfs.manifestVersion") || "";
    if (m.version && previous && previous !== m.version) {
      showUpdateBanner("New or updated documents are available.");
    }
    if (m.version) localStorage.setItem("tfs.manifestVersion", m.version);
  } catch (e) {
    console.warn("Manifest load failed, using fallback", e);
    TAGS = [];
    DOCS = [{ title: "MISC", items: [] }];
  }

  // If the previously selected tag no longer exists, reset to All
  if (selectedTag !== "All" && !TAGS.includes(selectedTag)) {
    selectedTag = "All";
    localStorage.setItem("tfs.selectedTag", selectedTag);
  }

  renderTagBar();
  renderSections(DOCS);
}

// ---------- Event wiring ----------
function wireUI() {
  // Offline download button
  const offlineBtn = $("#offlineBtn");
  if (offlineBtn) {
    offlineBtn.addEventListener("click", () => downloadForOffline(DOCS));
  }

  // Optional: re-render on window focus in case the SW or manifest changed
  window.addEventListener("focus", () => {
    // no heavy reload; just try to refresh banner on manifest change
    // (comment out if you don’t want this behavior)
    // loadDocs();
  });
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", async () => {
  setVersionLabel();
  ensureSW();
  await loadDocs();

  // If installed as PWA, make sure users seed this container’s cache at least once
  if (isStandalone && !localStorage.getItem("tfs.offline.cached")) {
    showUpdateBanner("Tip: Tap ‘Download for offline’ to enable offline in the app.");
  }

  wireUI();
});
