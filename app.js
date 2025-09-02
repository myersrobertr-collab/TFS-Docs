/* TFS Documents – app shell (stable baseline)
   - Buttons open documents in a new tab (as before)
   - Tag chips glow when active; EMER styling preserved
   - Section header shows ONLY the right-side "<GROUP> (count)" chip
   - Visible progress bar during "Download Docs"
   - "Update recommended" appears when cache is stale
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

const EMER_KEY    = 'EMER';
const STORAGE_KEY = 'tfs-docs:lastDownloadedAt';
const STALE_DAYS  = 14;

async function init() {
  try {
    const res = await fetch(window.MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`Failed to load manifest: ${res.status}`);
    const data = await res.json();

    // Expected: { version, sections: [{ title, tag, items: [{ label, url, tags?[] }] }] }
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
  return sections.map(s => {
    const items = (s.items || []).map(it => ({
      ...it,
      tags: Array.isArray(it.tags) ? it.tags : (it.tag ? [it.tag] : (s.tag ? [s.tag] : []))
    }));
    const tag = s.tag || null;
    const count = items.length;
    return { ...s, items, tag, count, title: s.title || s.tag || 'Group' };
  });
}

function collectTags(seions) {
  const set = new Set();
  seions.forEach(s => {
    if (s.tag) set.add(s.tag);
    (s.items || []).forEach(it => (it.tags || []).forEach(t => set.add(t)));
  });
  return [...set].sort((a, b) => {
    if (a === EMER_KEY) return -1;
    if (b === EMER_KEY) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

function renderMeta() {
  const stale = isStale(STATE.lastDownloadedAt);
  els.meta().innerHTML = `App ${sanitize(window.APP_VERSION)} · Docs ${sanitize(STATE.manifestVersion)}${
    stale ? ' · <span class="badge badge--warn">Update recommended</span>' : ''
  }`;
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
    if (STATE.activeTag === tag) chip.classList.add('chip--active');
    chip.addEventListener('click', () => {
      STATE.activeTag = tag;
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

  const tag = STATE.activeTag;
  const isAll = tag === 'ALL';

  STATE.sections.forEach(section => {
    const visibleItems = section.items.filter(it => isAll || (it.tags || []).includes(tag));
    if (!visibleItems.length) return;

    const sec = document.createElement('section');
    sec.className = 'section';

    // Header: ONLY right-side "<GROUP> (count)"
    const head = document.createElement('div');
    head.className = 'section-head';
    const spacer = document.createElement('div');
    spacer.className = 'section-title';
    spacer.setAttribute('aria-hidden', 'true');

    const countChip = document.createElement('span');
    countChip.className = 'chip chip--count';
    countChip.textContent = `${section.title} (${visibleItems.length})`;

    head.appendChild(spacer);
    head.appendChild(countChip);

    const body = document.createElement('div');
    body.className = 'section-body';
    const grid = document.createElement('div');
    grid.className = 'doc-grid';

    // Each card is just a single “button” link with the doc name (opens new tab)
    visibleItems.forEach(item => {
      const card = document.createElement('div');
      card.className = 'doc-card';

      const a = document.createElement('a');
      a.className = 'link' + ((item.tags || []).includes(EMER_KEY) ? ' danger' : '');
      a.href   = item.url || '#'; // use manifest URL directly (works like original)
      a.target = '_blank';
      a.rel    = 'noopener';
      a.textContent = item.label || item.name || 'Document';

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

  const urls = collectAllUrls();
  if (!urls.length) return;

  showProgress(true);
  let done = 0;

  const cache = await caches.open(window.CACHE_NAME);
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'no-cache' });
      if (res.ok || res.type === 'opaque') {
        await cache.put(new Request(url), res.clone());
      }
    } catch {
      // continue; still show progress
    } finally {
      done++;
      updateProgress(Math.round((done / urls.length) * 100));
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
  // Prefetch all document URLs exactly as provided (matches original behavior)
  STATE.sections.forEach(s => (s.items || []).forEach(it => { if (it.url) urls.add(it.url); }));
  // Also cache the manifest & app shell
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
  Promise.all([
    navigator.serviceWorker?.getRegistrations().then(regs => Promise.all(regs.map(r => r.unregister()))),
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k))))
  ]).then(() => {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
  });
}

function reflectCacheFreshness() {
  const stale = isStale(STATE.lastDownloadedAt);
  const btn = els.btnDownload();
  if (stale) {
    btn.classList.add('badge', 'badge--warn');
    btn.textContent = 'Download Docs (Update recommended)';
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
function sanitize(s) {
  return String(s).replace(/[<>&]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
}

init();
