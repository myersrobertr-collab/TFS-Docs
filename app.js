/* TFS Docs app shell — compact UI, EMER styling, offline with progress */

const APP_VERSION   = window.APP_VERSION  || 'dev';
const MANIFEST_URL  = window.MANIFEST_URL || 'docs/manifest.json';
const CACHE_NAME    = window.CACHE_NAME   || ('tfs-docs-' + APP_VERSION);

let TAGS = [];             // from manifest.tagMeta
let DOCS = [];             // from manifest.sections
let selectedTag = localStorage.getItem('tfs.selectedTag') || 'All';

const $  = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>Array.from(r.querySelectorAll(s));

/* ---------- Render: tag chips ---------- */
function renderTagBar() {
  const host = $('#tagBar');
  host.innerHTML = '';
  const tags = ['All', ...TAGS];

  tags.forEach(tag => {
    const isEmer = tag.toLowerCase() === 'emer';
    const btn = document.createElement('button');
    btn.className = ['chip', isEmer ? 'emer' : '', (tag === selectedTag ? 'active' : '')].join(' ').trim();
    btn.textContent = tag;
    btn.addEventListener('click', () => {
      selectedTag = tag;
      localStorage.setItem('tfs.selectedTag', selectedTag);
      renderTagBar();
      renderSections(DOCS);
    });
    host.appendChild(btn);
  });
}

/* ---------- Render: sections & cards ---------- */
function renderSections(sections) {
  const host = $('#sections');
  host.innerHTML = '';

  const sel = selectedTag.toLowerCase();
  const showAll = selectedTag === 'All';

  (sections || []).forEach(sec => {
    // include section if it has at least one matching item
    const items = (sec.items || []).filter(it => {
      if (showAll) return true;
      const itemTags = (it.tags || []).map(x => String(x).toLowerCase());
      const secTags  = (sec.tags || []).map(x => String(x).toLowerCase());
      return itemTags.includes(sel) || secTags.includes(sel);
    });

    if (!items.length) return;

    const sectionEl = document.createElement('div');
    sectionEl.className = 'section';

    const head = document.createElement('div');
    head.className = 'sectionHead';
    head.innerHTML = `<h2>${sec.title || ''}</h2>`;
    sectionEl.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'grid';

    const isEmerSection = (sec.tags || []).map(t => String(t).toLowerCase()).includes('emer');

    items.forEach(it => {
      const card = document.createElement('div');
      card.className = 'card' + (isEmerSection ? ' emer' : '');

      const btnRow = document.createElement('div');
      btnRow.className = 'btnRow';

      // one card per item with a single button
      const a = document.createElement('a');
      a.className = 'docBtn small' + (isEmerSection ? ' emer' : '');
      a.href = it.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = it.label || 'Open';
      btnRow.appendChild(a);

      card.appendChild(btnRow);
      grid.appendChild(card);
    });

    sectionEl.appendChild(grid);
    host.appendChild(sectionEl);
  });
}

/* ---------- Offline prefetch with progress ---------- */
async function cacheUrlsWithProgress(urls) {
  const statusArea = $('#statusArea');
  const statusText = $('#statusText');
  const bar = $('#progressBar');

  statusArea.style.display = '';
  statusText.textContent = 'Preparing download…';
  bar.style.width = '0%';

  const cache = await caches.open(CACHE_NAME);
  let done = 0;

  // Helper to update bar
  const update = () => {
    const pct = Math.round((done / urls.length) * 100);
    bar.style.width = pct + '%';
    statusText.textContent = `Caching ${done}/${urls.length}…`;
  };

  // Fetch each URL individually for progress reporting
  for (const u of urls) {
    try {
      const url = new URL(u, location.href).toString();
      const res = await fetch(url, { cache: 'no-cache', mode: 'same-origin' });
      if (res.ok) await cache.put(url, res.clone());
    } catch (e) {
      console.warn('Cache miss:', u, e);
    }
    done += 1;
    update();
  }

  statusText.textContent = 'All documents cached for offline use ✅';
  setTimeout(() => { statusArea.style.display = 'none'; }, 1500);
}

function collectCacheList() {
  const core = [
    './',
    'index.html',
    `app.js?v=${encodeURIComponent(APP_VERSION)}`,
    'app.webmanifest',
    'sw.js'
  ];
  const docUrls = DOCS.flatMap(s => (s.items || []).map(i => i.href));
  // de-dup
  return Array.from(new Set([...core, ...docUrls]));
}

/* ---------- Manifest loader ---------- */
async function loadDocs() {
  try {
    const r = await fetch(`${MANIFEST_URL}?v=${encodeURIComponent(APP_VERSION)}`, { cache: 'no-cache' });
    if (!r.ok) throw new Error('manifest missing');
    const m = await r.json();

    TAGS = Array.isArray(m.tagMeta) ? m.tagMeta : [];
    DOCS = Array.isArray(m.sections) ? m.sections : [];

    // show manifest version in badge
    $('#manifestVersion').textContent = 'Docs v' + (m.version || '—');

    // show update banner if version changed
    const prev = localStorage.getItem('tfs.manifestVersion');
    if (m.version && prev && prev !== m.version) {
      $('#updateBanner').classList.add('show');
    }
    if (m.version) localStorage.setItem('tfs.manifestVersion', m.version);
  } catch (e) {
    console.warn('Manifest load failed, using fallback', e);
    TAGS = [];
    DOCS = [{ title: 'MISC', tags: ['Misc'], items: [] }];
    $('#manifestVersion').textContent = 'Docs v—';
  }

  renderTagBar();
  renderSections(DOCS);
}

/* ---------- Service worker (optional but helpful) ---------- */
async function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register('sw.js');
  } catch (e) {
    console.warn('SW registration failed', e);
  }
}

/* ---------- Events ---------- */
function wireEvents() {
  // offline button
  $('#offlineBtn')?.addEventListener('click', async () => {
    const urls = collectCacheList();
    await cacheUrlsWithProgress(urls);
  });

  // update banner reload
  $('#reloadBtn')?.addEventListener('click', () => {
    // Nuke this app cache only; SW (if present) will also help
    caches.delete(CACHE_NAME).finally(() => {
      location.reload();
    });
  });
}

/* ---------- Boot ---------- */
(async function init(){
  wireEvents();
  await registerSW();
  await loadDocs();
})();
