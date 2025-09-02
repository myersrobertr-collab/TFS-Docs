/* TFS Docs – App logic
   - Loads docs/manifest.json
   - Renders chips + sections (with count)
   - EMER styling + chip
   - Offline caching with progress (Cache Storage)
   - Service worker registration
*/

(() => {
  // ----- Config from index.html -----
  const APP_VERSION  = window.APP_VERSION || 'dev';
  const MANIFEST_URL = window.MANIFEST_URL || 'docs/manifest.json';
  const CACHE_NAME   = window.CACHE_NAME   || ('tfs-docs-' + APP_VERSION);

  // ----- State -----
  let TAGS = [];
  let DOCS = [];
  let SELECTED_TAG = localStorage.getItem('tfs.selectedTag') || 'All';
  let MANIFEST_VERSION = null;

  // DOM helpers
  const $  = (s, r=document) => r.querySelector(s);
  const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));

  // ----- Service worker -----
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(()=>{});
  }

  // ----- Manifest Loader -----
  async function loadDocs() {
    try {
      const r = await fetch(`${MANIFEST_URL}?v=${encodeURIComponent(APP_VERSION)}`, { cache: 'no-cache' });
      if (!r.ok) throw new Error('manifest missing');
      const m = await r.json();
      TAGS = Array.isArray(m.tagMeta) ? m.tagMeta : [];
      DOCS = Array.isArray(m.sections) ? m.sections : [];
      MANIFEST_VERSION = m.version || null;

      // show manifest version
      const verEl = $('#manifestVer');
      if (verEl) verEl.textContent = 'v' + (MANIFEST_VERSION || APP_VERSION);

      // Keep SELECTED_TAG valid
      if (SELECTED_TAG !== 'All' && !TAGS.includes(SELECTED_TAG)) {
        SELECTED_TAG = 'All';
        localStorage.setItem('tfs.selectedTag', SELECTED_TAG);
      }
    } catch (e) {
      console.warn('Manifest load failed, using fallback', e);
      TAGS = ['Misc'];
      DOCS = [{ title: 'Misc', tags: ['Misc'], items: [] }];
      MANIFEST_VERSION = null;
    }

    renderChips();
    renderSections(DOCS);
  }

  // ----- Chips -----
  function renderChips() {
    const bar = $('#chips');
    bar.innerHTML = '';

    function chip(tag, active, extraClass='') {
      const c = document.createElement('button');
      c.className = `chip ${active ? 'active' : ''} ${extraClass}`.trim();
      c.dataset.tag = tag;
      c.textContent = tag;
      c.addEventListener('click', () => {
        SELECTED_TAG = tag;
        localStorage.setItem('tfs.selectedTag', SELECTED_TAG);
        // update active
        $$('.chip').forEach(b => b.classList.toggle('active', b.dataset.tag === tag));
        renderSections(DOCS);
      });
      return c;
    }

    bar.appendChild(chip('All', SELECTED_TAG === 'All'));
    TAGS.forEach(t => {
      const extra = (t === 'EMER') ? 'emer' : '';
      bar.appendChild(chip(t, SELECTED_TAG === t, extra));
    });
  }

  // ----- Sections -----
  function isEmerSection(sec) {
    const t = (sec.tags || []).map(s => String(s).toUpperCase());
    return t.includes('EMER');
  }

  function itemVisibleByTag(item) {
    if (SELECTED_TAG === 'All') return true;
    const itags = (item.tags || []).map(s => String(s));
    return itags.includes(SELECTED_TAG);
  }

  function renderSections(sections) {
    const host = $('#sections');
    host.innerHTML = '';

    sections.forEach(sec => {
      const items = (sec.items || []).filter(itemVisibleByTag);
      if (!items.length) return;

      const secEl = document.createElement('section');
      secEl.className = 'section' + (isEmerSection(sec) ? ' emer' : '');

      // header with count
      secEl.innerHTML = `
        <h2>${sec.title || ''} <span class="count">${items.length}</span></h2>
        <div class="grid"></div>
      `;
      const grid = secEl.querySelector('.grid');

      items.forEach(it => {
        const card = document.createElement('div');
        card.className = 'doc-card';
        const href = it.href || '#';
        const label = it.label || href;
        card.innerHTML = `
          <a class="doc-btn" href="${href}" target="_blank" rel="noopener">${label}</a>
        `;
        grid.appendChild(card);
      });

      host.appendChild(secEl);
    });
  }

  // ----- Offline download -----
  const progressWrap = $('#progressWrap');
  const progressBar  = $('#progressBar');
  const progressText = $('#progressText');
  const offlineBtn   = $('#offlineBtn');

  function setProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `${pct}%`;
  }

  function showProgress(show) {
    progressWrap.style.display = show ? 'flex' : 'none';
  }

  function uniqueUrls(list) {
    const s = new Set();
    list.forEach(u => { if (u) s.add(u); });
    return Array.from(s);
  }

  function collectAllUrls() {
    const core = ['/', 'index.html', 'app.js', 'sw.js', 'app.webmanifest'];
    const docUrls = DOCS.flatMap(sec => (sec.items || []).map(it => it.href)).filter(Boolean);
    return uniqueUrls(core.concat(docUrls));
  }

  async function downloadForOffline() {
    try {
      offlineBtn.disabled = true;
      showProgress(true);
      setProgress(0, 1);

      const urls = collectAllUrls();
      const cache = await caches.open(CACHE_NAME);

      let done = 0;
      for (const url of urls) {
        try {
          const res = await fetch(url, { cache: 'reload' });
          if (res.ok) await cache.put(url, res.clone());
        } catch (_) {
          // ignore individual failures
        }
        done += 1;
        setProgress(done, urls.length);
      }

      showProgress(false);
      offlineBtn.disabled = false;
      alert('✅ Documents cached for offline use.');
    } catch (e) {
      showProgress(false);
      offlineBtn.disabled = false;
      console.error(e);
      alert('Could not cache all documents. Try again later.');
    }
  }

  if (offlineBtn) {
    offlineBtn.addEventListener('click', downloadForOffline);
  }

  // ----- Init -----
  loadDocs();
})();
