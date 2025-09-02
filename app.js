// ====== CONFIG ======
const APP_VERSION  = window.APP_VERSION  || "dev";
const MANIFEST_URL = window.MANIFEST_URL || "docs/manifest.json";
const CACHE_NAME   = window.CACHE_NAME   || ("tfs-docs-" + APP_VERSION);

// ====== STATE ======
let TAGS = [];
let DOCS = [];
let selectedTag = localStorage.getItem("tfs.selectedTag") || "All";

// ====== EL ======
const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));
const chipsEl = $("#chips");
const sectionsEl = $("#sections");
const verEl = $("#manifestVer");
const offlineBtn = $("#offlineBtn");
const lastCacheEl = $("#lastCache");
const pWrap = $("#progressWrap");
const pBar  = $("#progressBar");
const pTxt  = $("#progressText");

// ====== SW register (if present) ======
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("sw.js").catch(()=>{});
}

// ====== Offline Button State ======
function setOfflineButtonWarning(on) {
  if (!offlineBtn) return;
  offlineBtn.classList.toggle("warn", !!on);
}

function fmtDate(ts) {
  try {
    const d = new Date(ts);
    if (!isFinite(d)) return "—";
    return d.toLocaleString([], { year:"numeric", month:"short", day:"numeric", hour:"2-digit", minute:"2-digit" });
  } catch { return "—"; }
}

function updateLastCacheText() {
  const ts = Number(localStorage.getItem("tfs.lastCacheAt") || 0);
  lastCacheEl.textContent = "Last downloaded: " + (ts ? fmtDate(ts) : "—");
}

function updateStalenessBadge() {
  const lastTs = Number(localStorage.getItem("tfs.lastCacheAt") || 0);
  const now = Date.now();
  const olderThan2w = lastTs ? (now - lastTs) > 14*24*3600*1000 : true;

  const seenVer = localStorage.getItem("tfs.manifestVersion") || "";
  const currentVer = localStorage.getItem("tfs.manifestVersion_current") || "";
  const manifestNew = (seenVer && currentVer && seenVer !== currentVer);

  setOfflineButtonWarning(olderThan2w || manifestNew);
}

// ====== Tag bar + sections ======
function renderTagBar() {
  chipsEl.innerHTML = "";
  const allBtn = document.createElement("button");
  allBtn.className = "tagbtn" + (selectedTag === "All" ? " active" : "");
  allBtn.textContent = "All";
  allBtn.onclick = ()=>{ selectedTag="All"; localStorage.setItem("tfs.selectedTag","All"); renderTagBar(); renderSections(DOCS); };
  chipsEl.appendChild(allBtn);

  TAGS.forEach(tag=>{
    const b = document.createElement("button");
    b.className = "tagbtn" + (selectedTag === tag ? " active" : "") + (tag.toUpperCase()==="EMER" ? " emer" : "");
    b.textContent = tag;
    b.onclick = ()=>{
      selectedTag = tag;
      localStorage.setItem("tfs.selectedTag", tag);
      renderTagBar();
      renderSections(DOCS);
    };
    chipsEl.appendChild(b);
  });
}

function renderSections(sections) {
  sectionsEl.innerHTML = "";
  const active = selectedTag;

  sections.forEach(sec=>{
    // if tag selected, filter whole section by sec.tags OR keep section but filter items? We'll filter items.
    const items = (sec.items || []).filter(it=>{
      if (active === "All") return true;
      const t = (it.tags || sec.tags || []);
      return t.includes(active);
    });
    if (!items.length) return;

    const wrapper = document.createElement("div");
    wrapper.className = "section";
    const count = items.length;
    wrapper.innerHTML = `<h2>${sec.title || ""} <span style="color:#94a3b8;font-weight:600">(${count})</span></h2>`;

    const grid = document.createElement("div");
    grid.className = "grid";

    items.forEach(it=>{
      const card = document.createElement("div");
      card.className = "card";
      const isEmer = (it.tags || []).some(t=>t.toUpperCase()==="EMER") ||
                     (sec.tags || []).some(t=>t.toUpperCase()==="EMER");
      const cls = "btn" + (isEmer ? " emer" : "");
      // Route through the built-in viewer
      const url = `viewer.html?file=${encodeURIComponent(it.href)}&label=${encodeURIComponent(it.label)}`;
      card.innerHTML = `<a class="${cls}" href="${url}">${it.label}</a>`;
      grid.appendChild(card);
    });

    wrapper.appendChild(grid);
    sectionsEl.appendChild(wrapper);
  });
}

// ====== Manifest + versioning ======
async function loadDocs() {
  try {
    const r = await fetch(`${MANIFEST_URL}?v=${encodeURIComponent(APP_VERSION)}`, { cache: "no-cache" });
    if (!r.ok) throw new Error("manifest missing");
    const m = await r.json();

    TAGS = Array.isArray(m.tagMeta) ? m.tagMeta : [];
    DOCS = Array.isArray(m.sections) ? m.sections : [];

    if (m.version) {
      // show in header
      if (verEl) verEl.textContent = "v" + m.version;
      // stash "current" to compare with last-seen
      localStorage.setItem("tfs.manifestVersion_current", String(m.version));
    }
  } catch (e) {
    console.warn("Manifest load failed", e);
    TAGS = [];
    DOCS = [{ title: "MISC", items: [] }];
  }
  renderTagBar();
  renderSections(DOCS);
  updateLastCacheText();
  updateStalenessBadge();
}

// ====== Offline prefetch with progress ======
async function downloadForOffline() {
  try {
    // progress UI on
    pWrap.style.display = "flex";
    pBar.style.width = "0%";
    pTxt.textContent = "0%";

    // what to cache
    const docUrls = DOCS.flatMap(s => (s.items || []).map(i => i.href));
    const staticUrls = [
      "./", "index.html", "app.js", "viewer.html", "viewer.js",
      "app.webmanifest", "sw.js"
    ];

    // pdf.js (CDN); if you prefer, vendor these under /lib/pdfjs/ and change paths
    const PDFJS_VER = "4.4.168";
    const pdfjsUrls = [
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.min.js`,
      `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VER}/pdf.worker.min.js`
    ];

    const all = [...new Set([...staticUrls, ...pdfjsUrls, ...docUrls])];

    const cache = await caches.open(CACHE_NAME);
    let done = 0;
    const total = all.length;

    // fetch+put one-by-one to update progress
    for (const url of all) {
      try {
        // use no-cache to ensure latest; SW will still capture
        const res = await fetch(url, { cache: "no-cache", mode: "cors" });
        if (res.ok) await cache.put(url, res.clone());
      } catch (e) {
        // ignore individual failures; user can re-run
      }
      done++;
      const pct = Math.round((done/total)*100);
      pBar.style.width = pct + "%";
      pTxt.textContent = pct + "%";
    }

    // mark cache time + mark this version as "seen"
    localStorage.setItem("tfs.lastCacheAt", String(Date.now()));
    const currentVer = localStorage.getItem("tfs.manifestVersion_current") || "";
    if (currentVer) localStorage.setItem("tfs.manifestVersion", currentVer);

    updateLastCacheText();
    updateStalenessBadge();
  } finally {
    // progress UI off
    setTimeout(()=>{
      pWrap.style.display = "none";
    }, 400);
  }
}

// ====== Wire UI ======
offlineBtn?.addEventListener("click", downloadForOffline);

// Kickoff
loadDocs();
