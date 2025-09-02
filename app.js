/* TFS Documents – app shell (manifest-compatible, ES2018-safe)
   Highlights:
   - Uses item.href (or item.url) from docs/manifest.json
   - Right-side "<GROUP> (count)" in section header
   - Single-button doc rows that open in a new tab
   - Visible progress bar during "Download Docs"
   - "Update recommended" shows if cache is older than 14 days OR manifest version changed
*/

var STATE = {
  manifestVersion: null,
  sections: [],
  tags: [],
  activeTag: 'ALL',
  lastDownloadedAt: null
};

var els = {
  meta: function () { return document.getElementById('meta'); },
  tagChips: function () { return document.getElementById('tagChips'); },
  sections: function () { return document.getElementById('sections'); },
  btnDownload: function () { return document.getElementById('btnDownload'); },
  btnRemove: function () { return document.getElementById('btnRemove'); },
  progressWrap: function () { return document.getElementById('progressWrap'); },
  progressBar: function () { return document.getElementById('progressBar'); },
  progressLabel: function () { return document.getElementById('progressLabel'); }
};

var EMER_KEY = 'EMER';
var STORAGE_KEY = 'tfs-docs:lastDownloadedAt';
var STORAGE_VERSION_KEY = 'tfs-docs:lastVersion';
var STALE_DAYS = 14;

async function init() {
  try {
    var res = await fetch(window.MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to load manifest: ' + res.status);
    var data = await res.json();

    // Expected: { version, sections: [{ title, tags?:[], items: [{ label, href|url, tags?[] }] }] }
    STATE.manifestVersion = data.version || '—';
    STATE.sections = normalizeSections(data.sections || []);
    STATE.tags = Array.from(new Set(['ALL'].concat(collectTags(STATE.sections))));

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
  return sections.map(function (s) {
    var items = (s.items || []).map(function (it) {
      return {
        label: it.label,
        href: it.href,
        url: it.url,
        tag: it.tag,
        tags: Array.isArray(it.tags) ? it.tags : (it.tag ? [it.tag] : []),
        _href: getItemUrl(it)
      };
    });
    var groupTag = Array.isArray(s.tags) && s.tags.length ? s.tags[0] : (s.tag || null);
    var title = s.title || groupTag || 'Group';
    var count = items.length;
    return {
      items: items,
      tag: groupTag,
      title: title,
      count: count
    };
  });
}

function collectTags(sections) {
  var set = new Set();
  sections.forEach(function (s) {
    if (Array.isArray(s.tags)) s.tags.forEach(function (t) { set.add(t); });
    if (s.tag) set.add(s.tag);
    (s.items || []).forEach(function (it) {
      (it.tags || []).forEach(function (t) { set.add(t); });
    });
  });
  return Array.from(set).sort(function (a, b) {
    if (a === EMER_KEY) return -1;
    if (b === EMER_KEY) return 1;
    return a.localeCompare(b, undefined, { numeric: true });
  });
}

function renderMeta() {
  var stale = isStale(STATE.lastDownloadedAt);
  els.meta().innerHTML = 'App ' + sanitize(window.APP_VERSION) + ' · Docs ' + sanitize(STATE.manifestVersion) + (stale ? ' · <span class="badge badge--warn">Update recommended</span>' : '');
}

function renderTagChips() {
  var row = els.tagChips();
  row.innerHTML = '';
  STATE.tags.forEach(function (tag) {
    var chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip' + (tag === EMER_KEY ? ' chip--emer' : '');
    chip.dataset.tag = tag;
    chip.setAttribute('aria-pressed', STATE.activeTag === tag ? 'true' : 'false');
    chip.textContent = tag;
    if (STATE.activeTag === tag) chip.classList.add('chip--active');
    chip.addEventListener('click', function () {
      STATE.activeTag = tag;
      Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (el) {
        var isActive = el.dataset.tag === STATE.activeTag;
        el.classList.toggle('chip--active', isActive);
        el.setAttribute('aria-pressed', isActive ? 'true' : 'false');
      });
      renderSections();
    });
    row.appendChild(chip);
  });
}

function renderSections() {
  var mount = els.sections();
  mount.innerHTML = '';

  var tag = STATE.activeTag;
  var isAll = tag === 'ALL';

  STATE.sections.forEach(function (section) {
    var visibleItems = section.items.filter(function (it) {
      return isAll || (it.tags || []).indexOf(tag) !== -1;
    });
    if (!visibleItems.length) return;

    var sec = document.createElement('section');
    sec.className = 'section';

    // Header: ONLY right-side "<GROUP> (count)"
    var head = document.createElement('div');
    head.className = 'section-head';

    var spacer = document.createElement('div');
    spacer.style.minHeight = '1px'; // keeps layout spacing without an empty CSS rule

    var countChip = document.createElement('span');
    countChip.className = 'chip chip--count';
    var groupName = section.title || section.tag || 'Group';
    countChip.textContent = groupName + ' (' + visibleItems.length + ')';

    head.appendChild(spacer);
    head.appendChild(countChip);

    var body = document.createElement('div');
    body.className = 'section-body';
    var grid = document.createElement('div');
    grid.className = 'doc-grid';

    // Each card is a single “button” link with the doc name (opens new tab)
    visibleItems.forEach(function (item) {
      var card = document.createElement('div');
      card.className = 'doc-card';

      var a = document.createElement('a');
      a.className = 'link' + ((item.tags || []).indexOf(EMER_KEY) !== -1 ? ' danger' : '');
      a.href = resolveHref(item._href);
      a.target = '_blank';
      a.rel = 'noopener';
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

  var urls = collectAllUrls();
  if (!urls.length) return;

  showProgress(true);
  var done = 0;

  var cache = await caches.open(window.CACHE_NAME);
  for (var i = 0; i < urls.length; i++) {
    var url = urls[i];
    try {
      var res = await fetch(url, { cache: 'no-cache' });
      if (res.ok || res.type === 'opaque') {
        await cache.put(new Request(url), res.clone());
      }
    } catch (e) {
      // continue; still show progress
    } finally {
      done++;
      updateProgress(Math.round((done / urls.length) * 100));
    }
  }

  STATE.lastDownloadedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, String(STATE.lastDownloadedAt));
  localStorage.setItem(STORAGE_VERSION_KEY, STATE.manifestVersion); // save the manifest version we just downloaded
  renderMeta();
  reflectCacheFreshness();
  showProgress(false);
}

function collectAllUrls() {
  var urls = new Set();
  // Prefetch all document URLs exactly as provided
  STATE.sections.forEach(function (s) {
    (s.items || []).forEach(function (it) {
      var u = getItemUrl(it);
      if (u) urls.add(resolveHref(u));
    });
  });
  // Also cache the manifest & app shell
  urls.add(window.MANIFEST_URL);
  urls.add('index.html');
  urls.add('app.js');
  urls.add('sw.js');
  return Array.from(urls);
}

/* ---------- helpers ---------- */

function getItemUrl(item) {
  if (!item) return '';
  return item.href ? item.href : (item.url ? item.url : '');
}

function resolveHref(u) {
  if (!u) return '#';
  try {
    if (/^https?:\/\//i.test(u)) return u;                    // absolute
    if (u.indexOf('/') === 0) return new URL(u, location.origin).href; // root-relative
    var safe = u.replace(/ /g, '%20');                        // encode spaces
    return new URL(safe, location.href).href;                 // relative to page
  } catch (e) {
    return u;
  }
}

function showProgress(show) {
  els.progressWrap().style.display = show ? 'flex' : 'none';
  els.progressWrap().setAttribute('aria-hidden', show ? 'false' : 'true');
  if (!show) updateProgress(0);
}

function updateProgress(pct) {
  els.progressBar().style.width = pct + '%';
  els.progressLabel().textContent = pct + '%';
}

function clearAllCachesHard() {
  Promise.all([
    navigator.serviceWorker && navigator.serviceWorker.getRegistrations
      ? navigator.serviceWorker.getRegistrations().then(function (regs) { return Promise.all(regs.map(function (r) { return r.unregister(); })); })
      : Promise.resolve(),
    caches.keys().then(function (keys) { return Promise.all(keys.map(function (k) { return caches.delete(k); })); })
  ]).then(function () {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(STORAGE_VERSION_KEY);
    location.reload();
  });
}

function reflectCacheFreshness() {
  var lastVersion = localStorage.getItem(STORAGE_VERSION_KEY);
  var versionMismatch = lastVersion && lastVersion !== STATE.manifestVersion;
  var stale = isStale(STATE.lastDownloadedAt) || !!versionMismatch;

  var btn = els.btnDownload();
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
  var ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return ageDays > STALE_DAYS;
}

function sanitize(s) {
  return String(s).replace(/[<>&]/g, function (c) {
    return c === '<' ? '&lt;' : (c === '>' ? '&gt;' : '&amp;');
  });
}

init();
