/* TFS Documents – app shell logic
   - Renders tag filter chips
   - Renders sections/cards
   - Handles prefetch w/ progress
   - Adds “glow” selection on tag chips and outlined/glowing count chips
*/

const STATE = {
  manifestVersion: null,
  sections: [],
  tags: [],
  activeTag: 'ALL',
  lastDownloadedAt: null,
};

const els = {
  meta:          () => document.getElementById('meta'),
  tagChips:      () => document.getElementById('tagChips'),
  sections:      () => document.getElementById('sections'),
  btnDownload:   () => document.getElementById('btnDownload'),
  btnRemove:     () => document.getElementById('btnRemove'),
  progressWrap:  () => document.getElementById('progressWrap'),
  progressBar:   () => document.getElementById('progressBar'),
  progressLabel: () => document.getElementById('progressLabel'),
};

const EMER_KEY = 'EMER';
const STORAGE_KEY = 'tfs-docs:lastDownloadedAt';
const STALE_DAYS = 14;

async function init() {
  try {
    const res = await fetch(window.MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
    const data = await res.json();

    // Expected structure:
    // { version: "2025.9.51", sections: [{ title, tag, count?, items: [{ label, url, tags?:[] }] }], tags?: ["G600","G280","EMER",...] }
    STATE.manifestVersion = data.version || '—';
    STATE.sections = normalizeSections(data.sections || []);
    STATE.tags     = Array.from(new Set(['ALL', ...collectTags(STATE.sections)]));

    STATE.lastDownloadedAt = +(localStorage.getItem(STORAGE_KEY) || 0);

    renderMeta();
    renderTagChips();
    renderSections();
    wireButtons();
    reflectCacheFreshness();
  } catch (err) {
    console.error(err);
    els.meta().textContent = 'Failed to load docs manifest.';
  }
}

function normalizeSections(sections) {
  // Ensure each item has tags array and section count
  return sections.map(s => {
    const items = (s.items || []).map(it => ({
      ...it,
      tags: Array.isArray(it.tags) ? it.tags : (it.tag ? [it.tag] : (s.tag ? [s.tag] : []))
    }));
    const tag = s.tag || null;
    const count = items.length;
    return { ...s, items, tag, count };
  });
}

function collectTags(sections) {
  const set = new Set();
  sections.forEach(s => {
    if (s.tag) set.add(s.tag);
    (s.items || []).forEach(it => (it.tags || []).forEach(t => set.add(t)));
  });
  // Keep EMER near front if present
  return [...set].sort((a, b) => {
    if (a === EMER_KEY) return -1;
    if (b === EMER_KEY) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

function renderMeta() {
  const dt = STATE.lastDownloadedAt ? new Date(STATE.lastDownloadedAt) : null;
  const stale = isStale(STATE.lastDownloadedAt);
  const staleBadge = stale ? ' • cache is getting old' : '';
  els.meta().innerHTML = `App ${sanitize(window.APP_VERSION)} · Docs ${sanitize(STATE.manifestVersion)}${stale ? ' · <span class="badge badge--warn">Update recommended</span>' : ''}${staleBadge}`;
}

function renderTagChips() {
  const row = els.tagChips();
  row.innerHTML = '';
  STATE.tags.forEach(tag => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.role = 'tab';
    chip.className = 'chip' + (tag === EMER_KEY ? ' chip--emer' : '');
    chip.dataset.tag = tag;
    chip.ariaPressed = (STATE.activeTag === tag ? 'true' : 'false');
    chip.textContent = tag;
    if (STATE.activeTag === tag) chip.classList.add('chip--active'); // glow when selected
    chip.addEventListener('click', () => {
      STATE.activeTag = tag;
      // Update all chips selected state (glow)
      document.querySelectorAll('.chip[role="tab"]').forEach(el => {
        const isActive = el.dataset.tag === STATE.activeTag;
        el.classList.toggle('chip--active', isActive);
        el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      renderSections();
    });
    row.appendChild(chip);
  });
}

function renderSections() {
  const mount = els.sections();
  mount.innerHTML = '';

  // filter sections/items by activeTag
  const tag = STATE.activeTag;
  const isAll = tag === 'ALL';

  STATE.sections.forEach(section => {
    // Count visible items under current filter
    const visibleItems = section.items.filter(it => isAll || (it.tags || []).includes(tag));
    if (!visibleItems.length) return;

    const sec = document.createElement('section');
    sec.className = 'section';

    const head = document.createElement('div');
    head.className = 'section-head';

    const titleWrap = document.createElement('div');
    titleWrap.className = 'section-title';
    titleWrap.textContent = section.title || section.tag || 'Section';

    // Make a count chip that is outlined + faint glow
    const countChip = document.createElement('span');
    countChip.className = 'chip chip--count';
    countChip.textContent = `${section.tag || section.title || 'Group'} (${visibleItems.length})`;

    head.appendChild(titleWrap);
    head.appendChild(countChip);

    const body = document.createElement('div');
    body.className = 'section-body';

    const grid = document.createElement('div');
    grid.className = 'doc-grid';

    visibleItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'doc-card';

      const title = document.createElement('div');
      title.className = 'doc-title';
      title.textContent = item.label || item.name || 'Document';

      const meta = document.createElement('div');
      meta.className = 'doc-meta';
      meta.textContent = (item.tags && item.tags.length) ? item.tags.join(' · ') : (section.tag ? section.tag : '');

      const a = document.createElement('a');
      a.className = 'link' + ((item.tags || []).includes(EMER_KEY) ? ' danger' : '');
      a.href = item.url || '#';
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'Open';

      card.appendChild(title);
      card.appendChild(meta);
      card.appendChild(a);
      grid.appendChild(card);
    });

    body.appendChild(grid);
    sec.appendChild(head);
    sec.appendChild(body);
    mount.appendChild(sec);
  });
}

function wireButtons() {
  els.btnDownload().addEventListener('click', prefetchAll);
  els.btnRemove().addEventListener('click', clearAllCachesHard);
}

async function prefetchAll() {
  if (!('serviceWorker' in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg || !navigator.serviceWorker.controller) {
    // Ensure SW is active before prefetch
    await navigator.serviceWorker.register('sw.js');
  }

  const urls = collectAllUrls();
  if (!urls.length) return;

  showProgress(true);
  let done = 0;

  const cache = await caches.open(window.CACHE_NAME);
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) await cache.put(new Request(url), res.clone());
    } catch (e) {
      console.warn('Prefetch failed for', url);
    } finally {
      done++;
      const pct = Math.round((done / urls.length) * 100);
      updateProgress(pct);
    }
  }

  STATE.lastDownloadedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, String(STATE.lastDownloadedAt));
  renderMeta();
  reflectCacheFreshness();
  showProgress(false);
}

function collectAllUrls() {
  const urls = new Set();
  STATE.sections.forEach(s => (s.items || []).forEach(it => { if (it.url) urls.add(it.url); }));
  // also cache the manifest & app shell
  urls.add(window.MANIFEST_URL);
  urls.add('index.html'); urls.add('app.js'); urls.add('sw.js');
  return Array.from(urls);
}

function showProgress(show) {
  els.progressWrap().style.display = show ? 'flex' : 'none';
  els.progressWrap().setAttribute('aria-hidden', show ? 'false' : 'true');
  if (!show) updateProgress(0);
}
function updateProgress(pct) {
  els.progressBar().style.width = `${pct}%`;
  els.progressLabel().textContent = `${pct}%`;
}

function clearAllCachesHard() {
  // Unregister SWs + clear caches
  Promise.all([
    navigator.serviceWorker?.getRegistrations().then(regs => Promise.all(regs.map(r => r.unregister()))),
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  ]).then(() => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

function reflectCacheFreshness() {
  const stale = isStale(STATE.lastDownloadedAt) || versionMismatch();
  const btn = els.btnDownload();
  if (stale) {
    btn.classList.add('badge', 'badge--warn');
    btn.textContent = 'Download Docs (Update Available)';
  } else {
    btn.classList.remove('badge', 'badge--warn');
    btn.textContent = 'Download Docs';
  }
}

function isStale(ts) {
  if (!ts) return true;
  const ageDays = (Date.now() - ts) / (1000*60*60*24);
  return ageDays > STALE_DAYS;
}
function versionMismatch() {
  // If manifest version changed after last download, we consider it stale
  // (This is a heuristic; in practice, re-download when user clicks)
  return false; // left simple; server-side can nudge SW_VERSION or manifest version
}

// tiny sanitizer for UI text
function sanitize(s) {
  return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
}

init();
