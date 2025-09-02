// ---------- Config ----------
const APP_VERSION  = window.APP_VERSION || 'dev';
const MANIFEST_URL = window.MANIFEST_URL || 'docs/manifest.json';
const CACHE_NAME   = window.CACHE_NAME   || ('tfs-docs-' + APP_VERSION);
const STALE_MS     = 14 * 24 * 60 * 60 * 1000; // 14 days

// ---------- DOM ----------
const elSections   = document.getElementById('sections');
const elChips      = document.getElementById('chips');
const elOfflineBtn = document.getElementById('offlineBtn');
const elManVer     = document.getElementById('manifestVer');
const elLastCache  = document.getElementById('lastCache');

const progWrap  = document.getElementById('progressWrap');
const progTrack = document.getElementById('progressTrack');
const progBar   = document.getElementById('progressBar');
const progText  = document.getElementById('progressText');

// ---------- State ----------
let DOCS = [];
let TAGS = [];
let selectedTag = localStorage.getItem('tfs.selectedTag') || 'All';
let manifestVersion = null;

// ---------- Utilities ----------
const fmtDate = ts => {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

function updateLastCacheLabel() {
  const last = localStorage.getItem('tfs.lastPrefetchAt');
  elLastCache.textContent = `Last downloaded: ${fmtDate(last)}`;
}

function needsYellow() {
  const last = Number(localStorage.getItem('tfs.lastPrefetchAt') || 0);
  const tooOld = Date.now() - last > STALE_MS;
  const prevVer = localStorage.getItem('tfs.manifestVersion');
  const newer = !!(manifestVersion && prevVer && prevVer !== manifestVersion);
  return tooOld || newer;
}

function setOfflineBtnState() {
  if (!elOfflineBtn) return;
  if (needsYellow()) {
    elOfflineBtn.classList.add('btn-warn');
    elOfflineBtn.title = 'New/updated docs available or cache is older than 14 days';
  } else {
    elOfflineBtn.classList.remove('btn-warn');
    elOfflineBtn.title = '';
  }
}

function setProgress(pct) {
  progWrap.style.display = 'block';
  progBar.style.width = `${Math.max(0, Math.min(100, pct))}%`;
  progText.textContent = `${Math.round(pct)}%`;
  if (pct >= 100) {
    setTimeout(() => { progWrap.style.display = 'none'; }, 600);
  }
}

// ---------- Render ----------
function renderTagBar() {
  if (!elChips) return;
  const tags = ['All', ...TAGS];
  elChips.innerHTML = tags.map(tag => {
    const emer = tag.toLowerCase() === 'emer' ? ' style="background:#e4002b;border-color:#e4002b;color:#fff"' : '';
    const active = tag === selectedTag ? ' data-active="1"' : '';
    return `<button class="tagbtn"${emer}${active ? ' aria-current="true"' : ''} data-tag="${tag}">${tag}</button>`;
  }).join('');

  elChips.querySelectorAll('.tagbtn').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedTag = btn.dataset.tag;
      localStorage.setItem('tfs.selectedTag', selectedTag);
      renderSections(DOCS);
      // update active state
      elChips.querySelectorAll('.tagbtn').forEach(b => b.removeAttribute('aria-current'));
      btn.setAttribute('aria-current', 'true');
    });
  });
}

function renderSections(sections) {
  const pass = s => selectedTag === 'All' ||
    (Array.isArray(s.tags) && s.tags.includes(selectedTag));

  const chunks = sections.filter(pass).map(sec => {
    const count = (sec.items || []).length;
    const htmlItems = (sec.items || []).map(it => {
      const emerClass = (it.tags || []).some(t => t.toLowerCase() === 'emer') ? ' emer' : '';
      return `
        <div class="card">
          <a class="btn${emerClass}" href="${it.href}" target="_blank" rel="noopener">${it.label}</a>
        </div>
      `;
    }).join('');

    return `
      <div class="section">
        <h2>${sec.title} <span class="count">(${count})</span></h2>
        <div class="grid">
          ${htmlItems}
        </div>
      </div>
    `;
  });

  elSections.innerHTML = chunks.join('') || `<div class="muted">No documents for this filter.</div>`;
}

// ---------- Manifest loading ----------
async function loadDocs() {
  try {
    const r = await fetch(`${MANIFEST_URL}?v=${encodeURIComponent(APP_VERSION)}&t=${Date.now()}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('manifest missing');
    const m = await r.json();

    TAGS = Array.isArray(m.tagMeta) ? m.tagMeta : [];
    DOCS = Array.isArray(m.sections) ? m.sections : [];
    manifestVersion = m.version || null;

    // UI bits
    if (elManVer) elManVer.textContent = manifestVersion ? `v${manifestVersion}` : 'v—';

    // If current selectedTag no longer exists, fall back to All
    if (selectedTag !== 'All' && !TAGS.includes(selectedTag)) {
      selectedTag = 'All';
      localStorage.setItem('tfs.selectedTag', selectedTag);
    }

    renderTagBar();
    renderSections(DOCS);

    // Compare manifest version to highlight yellow state if needed
    setOfflineBtnState();
  } catch (e) {
    console.warn('Manifest load failed:', e);
    TAGS = [];
    DOCS = [{ title: 'MISC', items: [] }];
    renderTagBar();
    renderSections(DOCS);
  }
}

// ---------- Offline prefetch ----------
async function prefetchAll() {
  // Collect URLs (shell + docs)
  const urls = new Set([
    './',
    'index.html',
    'app.webmanifest',
    'sw.js'
  ]);
  DOCS.forEach(sec => (sec.items || []).forEach(it => urls.add(it.href)));

  const list = Array.from(urls);
  let done = 0;

  try {
    const cache = await caches.open(CACHE_NAME);

    // Fetch sequentially to show progress reliably
    for (const url of list) {
      try {
        const res = await fetch(url, { cache: 'reload' });
        if (res.ok) await cache.put(new Request(url), res.clone());
      } catch {
        // ignore single-file failures; keep going
      } finally {
        done += 1;
        setProgress((done / list.length) * 100);
      }
    }

    // Mark timestamps + version and update UI
    localStorage.setItem('tfs.lastPrefetchAt', String(Date.now()));
    if (manifestVersion) localStorage.setItem('tfs.manifestVersion', manifestVersion);
    updateLastCacheLabel();
    setOfflineBtnState();
    alert('Offline files updated 👍');
  } catch (e) {
    console.error(e);
    alert('Could not cache all files. Try again with good connectivity.');
  } finally {
    setTimeout(() => { progWrap.style.display = 'none'; }, 800);
  }
}

// ---------- Hard refresh ----------
async function hardRefresh() {
  try {
    // 1) Delete app + workbox/runtime caches
    if ('caches' in window) {
      const names = await caches.keys();
      const toDelete = names.filter(n => /^tfs-docs-/i.test(n) || /workbox|runtime|pdf/i.test(n));
      await Promise.all(toDelete.map(n => caches.delete(n)));
    }

    // 2) Unregister all SWs
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r => r.unregister()));
    }

    // 3) Clear app markers
    ['tfs.lastPrefetchAt','tfs.manifestVersion','tfs.selectedTag','tfs.cachedUrlsV2']
      .forEach(k => { try { localStorage.removeItem(k); } catch {} });

    // 4) Reload with cache-bust
    const url = new URL(window.location.href);
    url.searchParams.set('fresh', Date.now().toString());
    window.location.replace(url.toString());
  } catch (e) {
    console.error(e);
    alert('Could not clear caches. Close all tabs and try again.');
  }
}

// ---------- Events ----------
elOfflineBtn?.addEventListener('click', () => {
  const msg = 'This will (re)download all files for offline use. Continue?';
  if (confirm(msg)) prefetchAll();
});

document.getElementById('forceRefreshBtn')?.addEventListener('click', async () => {
  const ok = confirm(
    'This will delete all downloaded files and reload the app.\nYou can re-download offline files afterwards.\n\nProceed?'
  );
  if (!ok) return;
  await hardRefresh();
});

// ---------- Init ----------
updateLastCacheLabel();
loadDocs();
setOfflineBtnState(); // initial state based on whatever is stored
