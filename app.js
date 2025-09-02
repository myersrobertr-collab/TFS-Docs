/* TFS Docs — no in-app viewer (direct open) */
(() => {
  // ---- config pulled from index.html ----
  const APP_VERSION  = window.APP_VERSION  || 'dev';
  const MANIFEST_URL = window.MANIFEST_URL || 'docs/manifest.json';
  const CACHE_NAME   = window.CACHE_NAME   || ('tfs-docs-' + APP_VERSION);

  // ---- state ----
  let TAGS = [];
  let DOCS = [];
  let selectedTag = localStorage.getItem('tfs.selectedTag') || 'All';

  // ---- elements ----
  const sectionsEl     = document.getElementById('sections');
  const chipsEl        = document.getElementById('chips') || document.getElementById('tagbar') || null;
  const offlineBtn     = document.getElementById('offlineBtn');
  const manifestVerEl  = document.getElementById('manifestVer');
  const progressWrap   = document.getElementById('progressWrap');
  const progressTrack  = document.getElementById('progressTrack');
  const progressBar    = document.getElementById('progressBar');
  const progressText   = document.getElementById('progressText');

  // ---- utils ----
  const isStandalone = () =>
    window.navigator.standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;

  const fmtDate = d => new Date(d).toLocaleString([], {year:'numeric', month:'short', day:'2-digit'});

  // ---- load manifest ----
  async function loadDocs() {
    let m;
    try {
      const r = await fetch(`${MANIFEST_URL}?v=${encodeURIComponent(APP_VERSION)}`, { cache: 'no-cache' });
      if (!r.ok) throw new Error('manifest missing');
      m = await r.json();
    } catch (e) {
      console.warn('Manifest load failed; using fallback', e);
      m = { tagMeta: [], sections: [{ title:'MISC', items:[] }] };
    }

    // version label (from manifest)
    if (manifestVerEl) manifestVerEl.textContent = m.version ? `v${m.version}` : '';

    TAGS = Array.isArray(m.tagMeta) ? m.tagMeta : [];
    DOCS = Array.isArray(m.sections) ? m.sections : [];

    // selected tag still valid?
    if (selectedTag !== 'All' && !TAGS.includes(selectedTag)) {
      selectedTag = 'All';
      localStorage.setItem('tfs.selectedTag', selectedTag);
    }

    renderTagBar();
    renderSections(DOCS);
    updateOfflineButtonState(m.version);
  }

  // ---- tag bar ----
  function renderTagBar() {
    if (!chipsEl) return;

    const tags = ['All', ...TAGS];
    chipsEl.innerHTML = '';
    tags.forEach(tag => {
      const count = countItemsForTag(tag);
      const btn = document.createElement('button');
      btn.className = 'tagbtn' + (tag === 'EMER' ? ' emer' : '') + (tag === selectedTag ? ' active' : '');
      btn.textContent = count > 0 ? `${tag} (${count})` : tag;
      btn.onclick = () => {
        selectedTag = tag;
        localStorage.setItem('tfs.selectedTag', tag);
        renderTagBar();
        renderSections(DOCS);
      };
      chipsEl.appendChild(btn);
    });
  }

  function countItemsForTag(tag) {
    if (tag === 'All') {
      return DOCS.reduce((acc, s) => acc + (s.items?.length || 0), 0);
    }
    let n = 0;
    DOCS.forEach(sec => {
      for (const it of (sec.items || [])) {
        const tags = it.tags || sec.tags || [];
        if (tags.includes(tag)) n++;
      }
    });
    return n;
  }

  // ---- render sections/cards ----
  function renderSections(sections) {
    sectionsEl.innerHTML = '';
    sections.forEach(sec => {
      const items = (sec.items || []).filter(it => {
        if (selectedTag === 'All') return true;
        const t = it.tags || sec.tags || [];
        return t.includes(selectedTag);
      });
      if (!items.length) return;

      const wrap = document.createElement('div');
      wrap.className = 'section';

      // title with count chip
      const h = document.createElement('h2');
      const cnt = items.length;
      h.innerHTML = `${sec.title || ''} <span class="chip"><span class="dot"></span>${cnt}</span>`;
      if ((sec.tags || []).includes('EMER')) h.classList.add('emer');
      wrap.appendChild(h);

      // grid
      const grid = document.createElement('div');
      grid.className = 'grid';

      items.forEach(it => {
        const card = document.createElement('div');
        card.className = 'card';

        // Direct link to the PDF (no in-app viewer)
        const a = document.createElement('a');
        a.className = 'btn' + ((it.tags || sec.tags || []).includes('EMER') ? ' emer' : '');
        a.href = it.href;
        a.textContent = it.label;

        // In standalone (A2HS), opening new tabs is limited — navigate in-place.
        a.onclick = (e) => {
          if (isStandalone()) {
            e.preventDefault();
            location.href = it.href; // simple, dependable
          } else {
            a.target = '_blank';
            a.rel = 'noopener';
          }
        };

        card.appendChild(a);
        grid.appendChild(card);
      });

      wrap.appendChild(grid);
      sectionsEl.appendChild(wrap);
    });
  }

  // ---- offline prefetch & button state ----
  function getAllDocUrls() {
    const urls = [];
    DOCS.forEach(sec => (sec.items || []).forEach(it => urls.push(it.href)));
    return Array.from(new Set(urls));
  }

  function setProgress(pct, label) {
    if (!progressBar || !progressText) return;
    progressWrap?.style.setProperty('display', 'block');
    progressBar.style.width = `${pct}%`;
    progressText.textContent = label || `${Math.round(pct)}%`;
    if (pct >= 100) setTimeout(() => (progressWrap.style.display = 'none'), 600);
  }

  async function downloadForOffline() {
    const urls = new Set([
      './', 'index.html', 'app.webmanifest', 'sw.js'
    ]);
    getAllDocUrls().forEach(u => urls.add(u));

    const list = Array.from(urls);
    const cache = await caches.open(CACHE_NAME);

    let done = 0;
    setProgress(1, 'Starting…');

    for (const url of list) {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await cache.put(url, res.clone());
      } catch (e) {
        console.warn('Cache miss:', url, e);
      } finally {
        done++;
        setProgress((done / list.length) * 100);
      }
    }

    localStorage.setItem('tfs.lastCache', new Date().toISOString());
    // tie what we cached to current manifest version, so we can detect updates
    const manifestVersion = (manifestVerEl?.textContent || '').replace(/^v/, '');
    if (manifestVersion) localStorage.setItem('tfs.cachedManifestVersion', manifestVersion);

    updateOfflineButtonState(manifestVersion);
  }

  function updateOfflineButtonState(currentManifestVersion) {
    if (!offlineBtn) return;

    const last = localStorage.getItem('tfs.lastCache');
    const cachedVer = localStorage.getItem('tfs.cachedManifestVersion') || '';
    const now = Date.now();
    const needsRefresh =
      !last ||
      (now - new Date(last).getTime()) > 14 * 24 * 3600 * 1000 || // >14 days
      (!!currentManifestVersion && cachedVer && cachedVer !== currentManifestVersion);

    // “yellow” look via a class the CSS already styles
    offlineBtn.classList.toggle('warn', needsRefresh);

    // small note under / title tooltip
    const nice = last ? `Last download: ${fmtDate(last)}` : 'Not cached yet';
    offlineBtn.title = nice;
  }

  // wire button
  offlineBtn?.addEventListener('click', downloadForOffline);

  // kick off
  loadDocs();
})();
