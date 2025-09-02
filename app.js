/* TFS Documents – app shell (manifest-compatible, ES2018-safe)
   Highlights:
   - Uses item.href (or item.url) from docs/manifest.json
   - Right-side "<GROUP> (count)" in section header
   - Single-button doc rows that open in a new tab
   - Visible progress bar during "Download Docs"
   - "Update recommended" shows if cache is older than 14 days OR server manifest version changed
   - Background polling of docs/manifest.json (offline-safe) + 12h auto-refresh fallback
*/

var STATE = {
  manifestVersion: null,          // version from the manifest loaded into the UI
  remoteManifestVersion: null,    // latest version observed from polling
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
var STORAGE_LAST_LOAD = 'tfs-docs:lastPageLoad';
var STALE_DAYS = 14;

/* ===== Auto-refresh config ===== */
var AUTO_REFRESH_MS = 12 * 60 * 60 * 1000; // 12 hours
var HEARTBEAT_MS = 5 * 60 * 1000;          // check every 5 minutes

/* ===== Manifest polling config ===== */
var POLL_INTERVAL_MS = 20 * 60 * 1000;     // poll every 20 minutes
var POLL_TIMEOUT_MS  = 8000;               // 8s timeout for fetch

async function init() {
  try {
    var res = await fetch(window.MANIFEST_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error('Failed to load manifest: ' + res.status);
    var data = await res.json();

    // Expected: { version, sections: [{ title, tags?:[], items: [{ label, href|url, tags?[] }] }] }
    STATE.manifestVersion = normalizeVersion(data.version);
    STATE.remoteManifestVersion = STATE.manifestVersion; // baseline
    STATE.sections = normalizeSections(data.sections || []);
    STATE.tags = Array.from(new Set(['ALL'].concat(collectTags(STATE.sections))));

    STATE.lastDownloadedAt = +(localStorage.getItem(STORAGE_KEY) || 0);

    renderMeta();            // header text (includes staleness check)
    renderTagChips();
    renderSections();
    wireButtons();
    reflectCacheFreshness(); // button label (includes staleness check)

    // Mark this page-load and schedule refresh + start polling
    markPageLoadAndSchedule();
    scheduleManifestPolling();
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

/* ------- Update status logic ------- */
function getUpdateFlags() {
  var lastVersionRaw = localStorage.getItem(STORAGE_VERSION_KEY);
  var lastVersion = normalizeVersion(lastVersionRaw);
  var lastTs = +(localStorage.getItem(STORAGE_KEY) || 0);
  var hasPreviousDownload = lastTs > 0;

  // Compare "cached last downloaded" vs "server/remote" version if we have it; else vs current UI version.
  var serverVersion = normalizeVersion(STATE.remoteManifestVersion || STATE.manifestVersion || '');
  var versionMismatch = hasPreviousDownload ? (lastVersion !== serverVersion) : false;
  var timeStale = isStale(lastTs);

  return {
    versionMismatch: versionMismatch,
    timeStale: timeStale,
    stale: (versionMismatch || timeStale),
    lastVersion: lastVersion,
    serverVersion: serverVersion
  };
}

function renderMeta() {
  var flags = getUpdateFlags();
  els.meta().innerHTML =
    'App ' + sanitize(window.APP_VERSION) +
    ' · Docs ' + sanitize(STATE.manifestVersion || '—') +
    (flags.stale ? ' · <span class="badge badge--warn">Update recommended</span>' : '');
}

/* ------- UI render ------- */
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
    spacer.style.minHeight = '1px';

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

/* ------- Actions ------- */
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
      // ignore; keep progressing
    } finally {
      done++;
      updateProgress(Math.round((done / urls.length) * 100));
    }
  }

  STATE.lastDownloadedAt = Date.now();
  localStorage.setItem(STORAGE_KEY, String(STATE.lastDownloadedAt));
  localStorage.setItem(STORAGE_VERSION_KEY, normalizeVersion(STATE.remoteManifestVersion || STATE.manifestVersion));

  // After download, re-fetch manifest to refresh version/sections shown in UI (optional but nice)
  try {
    var res2 = await fetch(window.MANIFEST_URL, { cache: 'no-cache' });
    if (res2.ok) {
      var data2 = await res2.json();
      var newVer = normalizeVersion(data2.version);
      STATE.manifestVersion = newVer;
      STATE.remoteManifestVersion = newVer;

      var newSections = normalizeSections(data2.sections || []);
      // Keep current activeTag if it still exists; otherwise fall back to ALL
      var newTags = Array.from(new Set(['ALL'].concat(collectTags(newSections))));
      var keepTag = newTags.indexOf(STATE.activeTag) !== -1 ? STATE.activeTag : 'ALL';

      STATE.sections = newSections;
      STATE.tags = newTags;
      STATE.activeTag = keepTag;

      renderMeta();
      renderTagChips();
      renderSections();
    }
  } catch (e) {
    // stay quiet if offline/in-flight or network hiccup
  }

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
    localStorage.removeItem(STORAGE_LAST_LOAD);
    location.reload();
  });
}

function reflectCacheFreshness() {
  var flags = getUpdateFlags();
  var btn = els.btnDownload();
  if (flags.stale) {
    btn.classList.add('badge', 'badge--warn');
    btn.textContent = 'Download Docs (Update recommended)';
    btn.title = 'Cached: ' + (flags.lastVersion || '—') + ' • Server: ' + (flags.serverVersion || '—');
  } else {
    btn.classList.remove('badge', 'badge--warn');
    btn.textContent = 'Download Docs';
    btn.title = '';
  }
}

function isStale(ts) {
  if (!ts) return true;
  var ageDays = (Date.now() - ts) / (1000 * 60 * 60 * 24);
  return ageDays > STALE_DAYS;
}

function normalizeVersion(v) {
  if (v == null) return '';
  return String(v).trim();
}

function sanitize(s) {
  return String(s).replace(/[<>&]/g, function (c) {
    return c === '<' ? '&lt;' : (c === '>' ? '&gt;' : '&amp;');
  });
}

/* ===== Auto-refresh implementation ===== */

function markPageLoadAndSchedule() {
  localStorage.setItem(STORAGE_LAST_LOAD, String(Date.now()));
  scheduleAutoRefresh();
}

function scheduleAutoRefresh() {
  var last = +(localStorage.getItem(STORAGE_LAST_LOAD) || 0);
  if (!last) {
    last = Date.now();
    localStorage.setItem(STORAGE_LAST_LOAD, String(last));
  }

  var now = Date.now();
  var dueAt = last + AUTO_REFRESH_MS;
  var delay = Math.max(0, dueAt - now);

  setTimeout(checkAndReloadIfDue, delay + 2000);
  setInterval(checkAndReloadIfDue, HEARTBEAT_MS);

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) checkAndReloadIfDue();
  });
  window.addEventListener('online', checkAndReloadIfDue);
}

function checkAndReloadIfDue() {
  var last = +(localStorage.getItem(STORAGE_LAST_LOAD) || 0);
  var now = Date.now();

  if (now - last >= AUTO_REFRESH_MS) {
    if (document.hidden) return;
    if (!navigator.onLine) return;

    var downloading = els.progressWrap().style.display !== 'none';
    if (downloading) return;

    localStorage.setItem(STORAGE_LAST_LOAD, String(now));
    location.reload();
  }
}

/* ===== Manifest polling (offline-safe) ===== */
function scheduleManifestPolling() {
  // quick check when tab becomes visible again or network returns
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) pollManifestOnce();
  });
  window.addEventListener('online', pollManifestOnce);

  // regular cadence
  setInterval(pollManifestOnce, POLL_INTERVAL_MS);
  // initial delayed ping (don’t hammer on page load)
  setTimeout(pollManifestOnce, 2 * 60 * 1000);
}

async function pollManifestOnce() {
  // Skip if hidden, offline, or a download is in progress
  if (document.hidden) return;
  if (!navigator.onLine) return;
  if (els.progressWrap().style.display !== 'none') return;

  var controller;
  var timer;

  try {
    controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    if (controller) {
      timer = setTimeout(function () { try { controller.abort(); } catch (e) {} }, POLL_TIMEOUT_MS);
    }

    var res = await fetch(window.MANIFEST_URL, {
      cache: 'no-cache',
      signal: controller ? controller.signal : undefined
    });
    if (!res.ok) return; // quietly ignore

    var data = await res.json();
    var remoteVer = normalizeVersion(data && data.version);
    if (!remoteVer) return;

    // Update our notion of "server version"
    var prevRemote = STATE.remoteManifestVersion;
    STATE.remoteManifestVersion = remoteVer;

    // If server version differs from cached last download, surface the warning immediately
    reflectCacheFreshness();

    // (Optional) If you want the header "Docs X" to reflect server version as soon as detected,
    // uncomment the next 3 lines. Currently we keep header as the UI's loaded version.
    // STATE.manifestVersion = remoteVer;
    // renderMeta();
    // (We do not hot-swap sections here to avoid surprising changes mid-session.)

  } catch (e) {
    // swallow network/poll errors (e.g., in flight)
  } finally {
    if (timer) clearTimeout(timer);
  }
}

init();
