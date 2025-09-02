// ========== Config ==========
const APP_VERSION  = (window.APP_VERSION  || "dev").toString();
const MANIFEST_URL = (window.MANIFEST_URL || "docs/manifest.json").toString();
const CACHE_NAME   = "tfs-docs-" + APP_VERSION;

// ========== State ==========
let TAGS = [];             // from manifest.tagMeta
let DOCS = [];             // from manifest.sections
let selectedTag = localStorage.getItem("tfs.selectedTag") || "All";

// ========== DOM helpers ==========
const $  = (s, r=document) => r.querySelector(s);
const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

function toast(msg, ms = 2600){
  const host = $("#toast");
  if (!host) return;
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(()=>{ el.remove(); }, ms);
}

// ========== SW registration ==========
async function registerSW(){
  if (!("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("sw.js?v=" + encodeURIComponent(APP_VERSION));
  } catch (e) {
    // silent
  }
}

// ========== Render tag chips ==========
function renderTagBar(){
  const bar = $("#tagbar");
  if (!bar) return;
  bar.innerHTML = "";

  const allTags = ["All", ...TAGS];
  allTags.forEach(tag => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (selectedTag === tag ? " active" : "");
    chip.textContent = tag;
    chip.addEventListener("click", () => {
      selectedTag = tag;
      localStorage.setItem("tfs.selectedTag", selectedTag);
      renderTagBar();
      renderSections(DOCS);
    });
    bar.appendChild(chip);
  });
}

// ========== Render sections/cards ==========
function renderSections(sections){
  const host = $("#sections");
  if (!host) return;
  host.innerHTML = "";

  const showAll = selectedTag === "All";

  sections.forEach(sec => {
    const secTags = Array.isArray(sec.tags) ? sec.tags : [];
    const shouldShowSection = showAll || secTags.includes(selectedTag);
    if (!shouldShowSection) return;

    const secEl = document.createElement("div");
    secEl.className = "section" + (secTags.includes("EMER") ? " emer" : "");
    secEl.innerHTML = `<h2>${sec.title || ""}</h2>`;

    const grid = document.createElement("div");
    grid.className = "grid";

    (sec.items || []).forEach(it => {
      // only show items that match the selected tag (if not "All")
      const itTags = Array.isArray(it.tags) ? it.tags : [];
      if (!showAll && !(itTags.includes(selectedTag))) return;

      const danger = secTags.includes("EMER") || itTags.includes("EMER");

      const card = document.createElement("div");
      card.className = "card" + (danger ? " emer" : "");
      card.innerHTML = `
        <div class="desc">${it.desc ? String(it.desc) : "&nbsp;"}</div>
        <a class="btn ${danger ? "danger" : ""}" href="${it.href}" target="_blank" rel="noopener">${it.label}</a>
      `;
      grid.appendChild(card);
    });

    // if no items remained after item-tag filtering, skip section entirely
    if (!grid.children.length) return;

    secEl.appendChild(grid);
    host.appendChild(secEl);
  });
}

// ========== Offline prefetch with progress ==========
async function downloadForOffline(){
  const overlay = $("#dlOverlay");
  const fill    = $("#dlFill");
  const count   = $("#dlCount");
  const pct     = $("#dlPct");

  function setProg(done, total){
    const p = total ? Math.round((done/total) * 100) : 0;
    fill.style.width = p + "%";
    count.textContent = `${done} / ${total}`;
    pct.textContent = `${p}%`;
  }

  overlay.hidden = false;
  setProg(0, 0);

  const urls = new Set([
    "./",
    "index.html?v=" + encodeURIComponent(APP_VERSION),
    "app.js?v=" + encodeURIComponent(APP_VERSION),
    "sw.js?v=" + encodeURIComponent(APP_VERSION),
    "app.webmanifest?v=" + encodeURIComponent(APP_VERSION),
  ]);

  // add all document URLs (with cache bust)
  DOCS.forEach(s => (s.items || []).forEach(i => {
    if (i.href) urls.add(`${i.href}?v=${encodeURIComponent(APP_VERSION)}`);
  }));

  const list = Array.from(urls);
  setProg(0, list.length);

  if (!("caches" in window)) {
    overlay.hidden = true;
    toast("This browser doesn't support offline caching.");
    return;
  }

  let done = 0;
  try {
    const cache = await caches.open(CACHE_NAME);
    for (const url of list) {
      try {
        // Use 'reload' to bypass HTTP cache, fall back to normal if needed
        const res = await fetch(url, { cache: "reload" });
        if (res.ok) await cache.put(url, res.clone());
      } catch (_) { /* continue */ }
      done++;
      setProg(done, list.length);
      // allow UI to paint
      await new Promise(r => setTimeout(r, 10));
    }
    toast("Documents cached for offline use 👍");
  } catch (e) {
    console.error(e);
    toast("Could not cache all documents. Try again later.");
  } finally {
    setTimeout(() => { overlay.hidden = true; }, 400);
  }
}

// ========== Manifest loader ==========
async function loadDocs(){
  try {
    const r = await fetch(`${MANIFEST_URL}?v=${encodeURIComponent(APP_VERSION)}`, { cache: "no-cache" });
    if (!r.ok) throw new Error("manifest missing");
    const m = await r.json();

    TAGS = Array.isArray(m.tagMeta) ? m.tagMeta : [];
    DOCS = Array.isArray(m.sections) ? m.sections : [];

    // version badge
    const ver = (m.version || APP_VERSION || "").toString();
    const chip = $("#verChip");
    if (chip && ver) chip.textContent = "v" + ver;

    // show "new files" toast if manifest version changed
    const prev = localStorage.getItem("tfs.manifestVersion");
    if (m.version && prev && prev !== m.version) {
      toast("New/updated documents are available.");
    }
    if (m.version) localStorage.setItem("tfs.manifestVersion", m.version);

  } catch (e) {
    console.warn("Manifest load failed, using fallback", e);
    TAGS = [];
    DOCS = [{ title: "MISC", tags:["Misc"], items: [] }];
  }

  renderTagBar();
  renderSections(DOCS);
}

// ========== Wire UI ==========
function wireUI(){
  $("#offlineBtn")?.addEventListener("click", downloadForOffline);
}

// ========== Boot ==========
(async function boot(){
  await registerSW();
  wireUI();
  await loadDocs();
})();
