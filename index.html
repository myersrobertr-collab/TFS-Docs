// ===== Globals =====
const APP_VERSION  = window.APP_VERSION || "dev";
const MANIFEST_URL = window.MANIFEST_URL || "docs/manifest.json";
const CACHE_NAME   = window.CACHE_NAME || ("tfs-docs-" + APP_VERSION);

let TAGS = [];
let DOCS = [];
let SELECTED = localStorage.getItem("tfs.selectedTag") || "All";

// ===== Boot =====
document.getElementById("appVerText").textContent = APP_VERSION;
document.getElementById("dlProg").style.width = "0%";

// Register SW (optional but recommended for offline)
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(()=>{});
}

loadDocs();

async function loadDocs() {
  try {
    const r = await fetch(`${MANIFEST_URL}?v=${encodeURIComponent(APP_VERSION)}`, { cache:"no-cache" });
    if (!r.ok) throw new Error("manifest fetch failed");
    const m = await r.json();

    // versions
    if (m.version) {
      const el = document.getElementById("manVer");
      document.getElementById("manVerText").textContent = m.version;
      el.style.display = "inline-block";
      const prev = localStorage.getItem("tfs.manifestVersion");
      if (prev && prev !== m.version) {
        // light hint—flash appVer chip
        const av = document.getElementById("appVer");
        av.style.boxShadow = "0 0 0 2px #22c55e inset";
        setTimeout(()=>{ av.style.boxShadow="none"; }, 1800);
      }
      localStorage.setItem("tfs.manifestVersion", m.version);
    }

    TAGS = ["All", ...(Array.isArray(m.tagMeta) ? m.tagMeta : [])];
    DOCS = Array.isArray(m.sections) ? m.sections : [];

  } catch (e) {
    console.warn("Using fallback manifest", e);
    TAGS = ["All"];
    DOCS = [{ title:"MISC", items:[] }];
  }
  renderChips();
  renderSections();
  wireDownload();
}

// ===== Render chips =====
function renderChips() {
  const host = document.getElementById("chips");
  host.innerHTML = "";
  TAGS.forEach(tag => {
    const b = document.createElement("button");
    b.className = "chip" + (tag === "EMER" ? " chip-emer" : "");
    if (tag === SELECTED) b.classList.add("active");
    b.textContent = tag;
    b.onclick = () => {
      SELECTED = tag;
      localStorage.setItem("tfs.selectedTag", SELECTED);
      renderChips();
      renderSections();
    };
    host.appendChild(b);
  });
}

// ===== Render sections =====
function renderSections() {
  const host = document.getElementById("sections");
  host.innerHTML = "";

  const match = (sec) => {
    if (SELECTED === "All") return true;
    const tags = Array.isArray(sec.tags) ? sec.tags : [];
    return tags.includes(SELECTED);
  };

  DOCS.filter(match).forEach(sec => {
    const isEmer = (sec.tags || []).includes("EMER");

    const secEl = document.createElement("section");
    secEl.className = "section";

    const h = document.createElement("h2");
    h.className = isEmer ? "sectionTitle title-emer" : "sectionTitle";
    h.textContent = sec.title || "";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = (sec.items?.length || 0) + " docs";
    h.appendChild(badge);

    const grid = document.createElement("div");
    grid.className = "grid";

    (sec.items || []).forEach(it => {
      const card = document.createElement("div");
      card.className = "card" + (isEmer ? " card-emer" : "");
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = it.desc || " ";
      const a = document.createElement("a");
      a.className = "btn" + (isEmer ? " btn-emer" : "");
      a.href = it.href;
      a.target = "_blank";
      a.rel = "noopener";
      a.textContent = it.label || "Open";
      card.append(label, a);
      grid.appendChild(card);
    });

    secEl.append(h, grid);
    host.appendChild(secEl);
  });
}

// ===== Offline download =====
function wireDownload() {
  const btn  = document.getElementById("dlBtn");
  const prog = document.getElementById("dlProg");

  btn.onclick = async () => {
    // Build unique URL list
    const urls = new Set([
      "./", "index.html", "app.webmanifest", "sw.js"
    ]);
    DOCS.forEach(sec => (sec.items||[]).forEach(it => urls.add(it.href)));

    // Prefetch with progress
    const all = Array.from(urls);
    const cache = await caches.open(CACHE_NAME);
    let done = 0;

    // To make progress visible, stream via fetch then cache.put
    for (const u of all) {
      try {
        const res = await fetch(u, { cache:"no-cache" });
        if (res.ok) await cache.put(new Request(u), res.clone());
      } catch (_) {}
      done++;
      prog.style.width = Math.round(done / all.length * 100) + "%";
    }
    // brief completion flash
    setTimeout(()=>{ prog.style.width = "0%"; }, 1200);
  };
}
