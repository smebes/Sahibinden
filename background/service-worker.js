importScripts('../config.js', '../lib/photo-urls.js', '../lib/parse-list.js', '../lib/parse-detail.js');

const DEFAULT_STORE_URL = 'https://fixpartsyedekparca.sahibinden.com/';
const FLEET_HEARTBEAT_ALARM = 'viewFleetHeartbeat';
const AUTO_RUN_ALARM = 'fixpartsAutoRun';
const BOT_TYPE = 'sahibinden_view';
const DEFAULT_API_URL = typeof VIEW_BOT_API !== 'undefined'
  ? `${VIEW_BOT_API.base}`
  : 'http://51.102.128.78:3009';

const state = {
  running: false,
  paused: false,
  queue: [],
  phase: 'idle',
  stats: {
    listingsFound: 0,
    viewsDone: 0,
    viewsFailed: 0,
    favoritesDone: 0,
    syncPagesDone: 0,
    detailsDone: 0,
    detailsFailed: 0,
  },
  dbStats: null,
  syncTabId: null,
  settings: null,
  fleetMode: false,
  fleetMachineId: '',
  fleetMachineLabel: '',
  apiUrl: DEFAULT_API_URL,
  pipelineMode: true,
  rhythmPhase: 'work',
  rhythmEndsAt: 0,
};

function storeConfig(settings) {
  const cfg = typeof VIEW_BOT_API !== 'undefined' ? VIEW_BOT_API.store : {};
  return {
    key: settings?.storeKey || cfg.key || 'fixpartsyedekparca',
    referer: settings?.storeUrl || cfg.referer || DEFAULT_STORE_URL,
    listBaseUrl: settings?.listBaseUrl || cfg.listBaseUrl || DEFAULT_STORE_URL,
    pageSize: cfg.pageSize || 20,
  };
}

function normalizeListingUrl(href) {
  return SahibindenParseList.normalizeListingUrl(href);
}

function parseListingUrls(text) {
  const seen = new Set();
  const urls = [];
  const parts = text.split(/[\r\n,;]+/);
  for (const part of parts) {
    const normalized = normalizeListingUrl(part);
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      urls.push(normalized);
    }
  }
  return urls;
}

async function getSettings() {
  const stored = await chrome.storage.local.get([
    'listingUrlsText',
    'processLimit',
    'storeUrl',
    'listBaseUrl',
    'storeKey',
    'scanAllPages',
    'delayMinMs',
    'delayMaxMs',
    'dwellMs',
    'headlessTabs',
    'enableFavorite',
    'fleetMode',
    'fleetMachineId',
    'fleetMachineLabel',
    'apiUrl',
    'pipelineMode',
    'syncPageLimit',
    'rhythmEnabled',
    'rhythmWorkMinMin',
    'rhythmWorkMaxMin',
    'rhythmRestMinMin',
    'rhythmRestMaxMin',
    'autoRunHourly',
    'manuallyStopped',
  ]);
  return {
    listingUrlsText: stored.listingUrlsText || '',
    processLimit: stored.processLimit ?? 100,
    storeUrl: stored.storeUrl || DEFAULT_STORE_URL,
    listBaseUrl: stored.listBaseUrl || VIEW_BOT_API?.store?.listBaseUrl || DEFAULT_STORE_URL,
    storeKey: stored.storeKey || VIEW_BOT_API?.store?.key || 'fixpartsyedekparca',
    scanAllPages: stored.scanAllPages === true,
    delayMinMs: stored.delayMinMs ?? 8000,
    delayMaxMs: stored.delayMaxMs ?? 15000,
    dwellMs: stored.dwellMs ?? 8000,
    headlessTabs: stored.headlessTabs !== false,
    enableFavorite: stored.enableFavorite !== false,
    fleetMode: stored.fleetMode === true,
    fleetMachineId: String(stored.fleetMachineId || '').trim(),
    fleetMachineLabel: String(stored.fleetMachineLabel || '').trim(),
    apiUrl: stored.apiUrl || DEFAULT_API_URL,
    pipelineMode: stored.pipelineMode !== false,
    syncPageLimit: stored.syncPageLimit ?? null,
    rhythmEnabled: stored.rhythmEnabled !== false,
    rhythmWorkMinMin: stored.rhythmWorkMinMin ?? 10,
    rhythmWorkMaxMin: stored.rhythmWorkMaxMin ?? 15,
    rhythmRestMinMin: stored.rhythmRestMinMin ?? 20,
    rhythmRestMaxMin: stored.rhythmRestMaxMin ?? 40,
    autoRunHourly: stored.autoRunHourly !== false,
  };
}

function rhythmConfig(settings) {
  const s = settings || state.settings || {};
  return {
    enabled: s.rhythmEnabled !== false,
    workMinMs: (s.rhythmWorkMinMin ?? 10) * 60 * 1000,
    workMaxMs: (s.rhythmWorkMaxMin ?? 15) * 60 * 1000,
    restMinMs: (s.rhythmRestMinMin ?? 20) * 60 * 1000,
    restMaxMs: (s.rhythmRestMaxMin ?? 40) * 60 * 1000,
  };
}

function startRhythmWorkPhase() {
  const r = rhythmConfig();
  const ms = randomDelay(r.workMinMs, r.workMaxMs);
  state.rhythmPhase = 'work';
  state.rhythmEndsAt = Date.now() + ms;
  const min = Math.round(ms / 60000);
  broadcastProgress({
    message: `Çalışma dilimi (~${min} dk)`,
    rhythmPhase: 'work',
    rhythmEndsAt: state.rhythmEndsAt,
  }).catch(() => {});
}

function startRhythmRestPhase() {
  const r = rhythmConfig();
  closeSyncTab().catch(() => {});
  const ms = randomDelay(r.restMinMs, r.restMaxMs);
  state.rhythmPhase = 'rest';
  state.rhythmEndsAt = Date.now() + ms;
  state.phase = 'rest';
  const min = Math.round(ms / 60000);
  fleetHeartbeat('paused', { message: `Mola ~${min} dk` }).catch(() => {});
  broadcastProgress({
    message: `Mola (~${min} dk)`,
    rhythmPhase: 'rest',
    rhythmEndsAt: state.rhythmEndsAt,
  }).catch(() => {});
}

async function enforceRhythm() {
  const r = rhythmConfig();
  if (!r.enabled) return;

  if (!state.rhythmEndsAt) startRhythmWorkPhase();

  while (state.running && !state.paused) {
    const now = Date.now();
    if (now >= state.rhythmEndsAt) {
      if (state.rhythmPhase === 'work') startRhythmRestPhase();
      else startRhythmWorkPhase();
      await sleep(300);
      continue;
    }
    if (state.rhythmPhase === 'rest') {
      const leftMs = state.rhythmEndsAt - now;
      const leftMin = Math.max(1, Math.ceil(leftMs / 60000));
      state.phase = 'rest';
      await broadcastProgress({
        message: `Mola · ${leftMin} dk kaldı`,
        rhythmPhase: 'rest',
        rhythmEndsAt: state.rhythmEndsAt,
      });
      fleetHeartbeat('paused', { message: `Mola ${leftMin} dk` }).catch(() => {});
      await sleep(Math.min(30000, leftMs));
      continue;
    }
    return;
  }
}

function buildQueueFromSettings(settings) {
  const all = parseListingUrls(settings.listingUrlsText);
  const limit = Math.max(1, settings.processLimit || 100);
  return all.slice(0, limit);
}

function randomDelay(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** MV3 service worker uzun sekme beklerken uyuyabilir — periyodik ping ile canlı tut. */
function keepServiceWorkerAlive() {
  const id = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => {});
  }, 20000);
  return () => clearInterval(id);
}

async function postDetailWithRetry(ilanId, payload) {
  let lastErr;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await fleetPost(`/listings/${ilanId}/detail`, payload, {
        timeoutMs: 60000,
        retries: 1,
      });
    } catch (err) {
      lastErr = err;
      if (attempt < 5) {
        await sleep(3000 * attempt);
      }
    }
  }
  throw lastErr;
}

async function broadcastProgress(extra = {}) {
  const payload = {
    type: 'progress',
    running: state.running,
    paused: state.paused,
    phase: state.phase,
    queueLength: state.queue.length,
    stats: { ...state.stats },
    dbStats: state.dbStats,
    rhythmPhase: state.rhythmPhase,
    rhythmEndsAt: state.rhythmEndsAt,
    ...extra,
  };
  await chrome.storage.local.set({ lastProgress: payload });
  try {
    await chrome.runtime.sendMessage({ type: 'progress', ...payload });
  } catch {
    /* popup kapalı */
  }
}

async function waitForTabLoad(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('Sayfa yükleme zaman aşımı'));
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function apiBaseFromUrl(apiUrl) {
  try {
    return new URL(apiUrl || DEFAULT_API_URL).origin;
  } catch {
    return DEFAULT_API_URL;
  }
}

function apiPrefix() {
  return typeof VIEW_BOT_API !== 'undefined' && VIEW_BOT_API.apiPrefix
    ? VIEW_BOT_API.apiPrefix
    : '/sahibinden';
}

async function fleetFetch(url, opts = {}, retries = 3) {
  const timeoutMs = opts.timeoutMs || 30000;
  const fetchOpts = { ...opts };
  delete fetchOpts.timeoutMs;
  delete fetchOpts.retries;

  let lastErr;
  const attempts = opts.retries ?? retries;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...fetchOpts, signal: controller.signal });
      clearTimeout(timer);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      return data;
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const msg = err.name === 'AbortError' ? `API zaman aşımı (${Math.round(timeoutMs / 1000)} sn)` : err.message;
      lastErr = new Error(msg);
      if (attempt < attempts) {
        await sleep(2000 * attempt);
        continue;
      }
      throw lastErr;
    }
  }
  throw lastErr;
}

async function fleetPost(path, body, opts = {}) {
  const base = apiBaseFromUrl(state.apiUrl);
  const url = `${base}${apiPrefix()}${path}`;
  try {
    return await fleetFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}),
      timeoutMs: opts.timeoutMs || 30000,
      retries: opts.retries,
    });
  } catch (err) {
    if (err.message === 'Failed to fetch') {
      throw new Error(
        `API erişilemiyor: ${url} — sunucu (${base}) ayakta mı? Popup API: http://51.102.128.78:3009`
      );
    }
    throw err;
  }
}

async function fleetGet(path, params = {}) {
  const base = apiBaseFromUrl(state.apiUrl);
  const qs = new URLSearchParams(params).toString();
  const url = `${base}${apiPrefix()}${path}${qs ? `?${qs}` : ''}`;
  return fleetFetch(url);
}

async function closeSyncTab() {
  if (!state.syncTabId) return;
  try {
    await chrome.tabs.remove(state.syncTabId);
  } catch {
    /* tab zaten kapalı */
  }
  state.syncTabId = null;
}

async function fetchListPageViaTab(url, retry = true) {
  const { headlessTabs } = state.settings;
  let tabId = state.syncTabId;

  try {
    if (tabId) {
      try {
        await chrome.tabs.get(tabId);
        await chrome.tabs.update(tabId, { url, active: !headlessTabs });
      } catch {
        tabId = null;
        state.syncTabId = null;
      }
    }

    if (!tabId) {
      const tab = await chrome.tabs.create({ url, active: !headlessTabs });
      tabId = tab.id;
      state.syncTabId = tabId;
    }

    await waitForTabLoad(tabId, 60000);
    await sleep(randomDelay(1500, 2500));

    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/photo-urls.js', 'lib/parse-list.js'],
    });

    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        if (typeof SahibindenParseList !== 'undefined') {
          return SahibindenParseList.parseListPageFromDocument(document);
        }
        return { items: [], totalPages: null, blocked: true };
      },
    });

    const parsed = injection?.result;
    if (!parsed) throw new Error('Liste sayfası okunamadı');
    if (parsed.blocked) {
      throw new Error('Sahibinden erişim engeli (403/captcha) — giriş yapılı profilde tekrar deneyin');
    }
    return parsed;
  } catch (err) {
    await closeSyncTab();
    if (retry && /tab|No tab/i.test(err.message)) {
      return fetchListPageViaTab(url, false);
    }
    throw err;
  }
}

async function refreshDbStats() {
  try {
    const store = storeConfig(state.settings);
    state.dbStats = await fleetGet('/listings/stats', { storeKey: store.key });
    return state.dbStats;
  } catch (err) {
    console.warn('refreshDbStats:', err.message);
    return null;
  }
}

async function syncOneListPage() {
  const store = storeConfig(state.settings);
  const machineId = state.fleetMachineId || 'local';

  const claim = await fleetGet('/listings/claim-list-page', {
    storeKey: store.key,
    machineId,
    pageSize: store.pageSize,
  });

  if (!claim?.job) {
    return false;
  }

  const { pagingOffset, listPage } = claim.job;
  const url = `${store.listBaseUrl}?pagingOffset=${pagingOffset}&sorting=storeShowcase`;

  state.phase = 'sync';
  await broadcastProgress({ message: `Liste sayfa ${listPage} · makine ${machineId}` });

  const parsed = await fetchListPageViaTab(url);

  if (parsed.items.length) {
    await fleetPost('/listings/sync-batch', {
      storeKey: store.key,
      listPage,
      items: parsed.items,
    });
    state.stats.listingsFound += parsed.items.length;
  }

  const totalPages = parsed.totalPages || state.dbStats?.total_pages || null;
  const listScanComplete = totalPages != null && listPage >= totalPages;

  await fleetPost('/listings/complete-list-page', {
    storeKey: store.key,
    pagingOffset,
    itemsCount: parsed.items.length,
    totalPages: parsed.totalPages || null,
    listScanComplete,
  });

  state.stats.syncPagesDone += 1;
  await refreshDbStats();
  await broadcastProgress();
  await sleep(randomDelay(800, 1500));
  return !listScanComplete;
}

async function scrapeAndSaveDetail(job) {
  const ilanId = job.ilanId || job.ilan_id;
  const { url, title } = job;
  if (!ilanId) throw new Error('Job ilan_id eksik');
  const { headlessTabs } = state.settings;
  state.phase = 'detail';
  await broadcastProgress({ message: `Detay: ${title || ilanId}` });

  let tab = null;
  const stopKeepalive = keepServiceWorkerAlive();
  try {
    tab = await chrome.tabs.create({ url, active: !headlessTabs });
    await waitForTabLoad(tab.id, 60000);
    await sleep(1200);
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['lib/photo-urls.js', 'lib/parse-detail.js'],
    });
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        if (typeof SahibindenParseDetail !== 'undefined') {
          return SahibindenParseDetail.parseDetailPage();
        }
        return null;
      },
    });
    const detail = injection?.result;
    if (!detail) throw new Error('Detay parse edilemedi');
    detail.ilanNo = detail.ilanNo || ilanId;
    if (!detail.title && title) detail.title = title;

    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch { /* */ }
      tab = null;
    }

    await postDetailWithRetry(ilanId, {
      detail,
      url,
      storeKey: storeConfig(state.settings).key,
    });
    state.stats.detailsDone += 1;
    fleetLog('info', 'detail_saved', title || ilanId, { ilanId }).catch(() => {});
  } catch (err) {
    state.stats.detailsFailed += 1;
    fleetPost(`/listings/${ilanId}/release-detail`, {}, { timeoutMs: 15000, retries: 2 }).catch(() => {});
    fleetLog('error', 'detail_failed', err.message, { ilanId, url }).catch(() => {});
    console.error('Detay hatası:', url, err);
  } finally {
    stopKeepalive();
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch { /* */ }
    }
    await sleep(randomDelay(500, 1000));
  }
}

async function tryFavoriteListing(tabId) {
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const selectors = [
          '#favoriteClassified',
          '.classifiedFavorite',
          'a.classifiedFavorite',
          '[class*="favorite"]',
          '[data-favorite]',
        ];
        for (const sel of selectors) {
          const el = document.querySelector(sel);
          if (el && !el.classList.contains('active') && !el.classList.contains('favorited')) {
            el.click();
            return true;
          }
        }
        return false;
      },
    });
    return injection?.result === true;
  } catch {
    return false;
  }
}

async function viewListingFromJob(job) {
  const { url, title, shouldFavorite } = job;
  const { dwellMs, headlessTabs, delayMinMs, delayMaxMs } = state.settings;
  state.phase = 'view';
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: !headlessTabs });
    await waitForTabLoad(tab.id, 60000);
    await sleep(dwellMs);
    if (shouldFavorite) {
      const ok = await tryFavoriteListing(tab.id);
      if (ok) state.stats.favoritesDone += 1;
    }
    state.stats.viewsDone += 1;
    await broadcastProgress({ phase: 'view', currentListing: title || url });
    fleetHeartbeat('viewing', { progress: true }).catch(() => {});
  } catch (e) {
    state.stats.viewsFailed += 1;
    fleetLog('error', 'view_failed', e.message, { url }).catch(() => {});
  } finally {
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch { /* */ }
    }
    if (state.running && !state.paused) {
      await sleep(randomDelay(delayMinMs, delayMaxMs));
    }
  }
}

async function viewListing(url) {
  await viewListingFromJob({ url, shouldFavorite: state.settings.enableFavorite });
}

async function runPipeline() {
  const store = storeConfig(state.settings);
  await refreshDbStats();

  while (state.running) {
    while (state.paused && state.running) {
      await sleep(500);
    }
    if (!state.running) break;

    await enforceRhythm();
    if (!state.running || state.paused) continue;
    if (state.rhythmPhase === 'rest') continue;

    await refreshDbStats();
    const stats = state.dbStats || {};
    const machineId = state.fleetMachineId || 'local';

    if (!stats.list_scan_complete) {
      try {
        const hasMore = await syncOneListPage();
        if (hasMore) continue;
        await closeSyncTab();
      } catch (err) {
        await closeSyncTab();
        fleetLog('error', 'sync_failed', err.message, { machineId }).catch(() => {});
        await broadcastProgress({ message: `Liste hatası: ${err.message} — 60 sn sonra tekrar` });
        await sleep(60000);
        continue;
      }
    }

    if ((stats.need_detail || 0) > 0) {
      try {
        const { items } = await fleetGet('/listings/need-detail', {
          storeKey: store.key,
          machineId,
          limit: 1,
        });
        if (items?.length) {
          for (const job of items) {
            if (!state.running || state.paused) break;
            await scrapeAndSaveDetail(job);
          }
          continue;
        }
      } catch (err) {
        fleetLog('error', 'need_detail_failed', err.message, { machineId }).catch(() => {});
        await broadcastProgress({ message: `Detay kuyruğu hatası: ${err.message} — 30 sn sonra tekrar` });
        await sleep(30000);
        continue;
      }
    }

    if ((stats.ready_view || 0) > 0) {
      try {
        const { job } = await fleetGet('/listings/claim-view', {
          storeKey: store.key,
          machineId,
        });
        if (job) {
          await viewListingFromJob(job);
          continue;
        }
      } catch (err) {
        fleetLog('error', 'claim_view_failed', err.message, { machineId }).catch(() => {});
        await broadcastProgress({ message: `Görüntüleme hatası: ${err.message} — 30 sn sonra tekrar` });
        await sleep(30000);
        continue;
      }
    }

    state.phase = 'wait';
    await broadcastProgress({
      message: stats.list_scan_complete
        ? 'Tüm işler güncel, bekleniyor…'
        : 'Başka makine liste tarıyor veya iş kuyruğu boş…',
    });
    await sleep(30000);
  }
}

async function runBot() {
  if (state.running) return;

  state.running = true;
  state.paused = false;
  state.settings = state.settings || await getSettings();
  if (rhythmConfig(state.settings).enabled) {
    startRhythmWorkPhase();
  }

  try {
    await broadcastProgress({ phase: 'start' });

    if (state.pipelineMode && state.apiUrl) {
      await runPipeline();
    } else {
      while (state.queue.length > 0 && state.running) {
        while (state.paused && state.running) {
          await sleep(500);
        }
        if (!state.running) break;
        const url = state.queue.shift();
        await viewListing(url);
      }
    }

    await broadcastProgress({ phase: 'done' });
  } catch (e) {
    console.error('Bot hatası:', e);
    await broadcastProgress({ phase: 'error', error: e.message });
  } finally {
    state.running = false;
    state.paused = false;
    state.phase = 'idle';
    state.rhythmEndsAt = 0;
    await closeSyncTab();
    await broadcastProgress({ phase: 'idle' });
    fleetHeartbeat(state.fleetMode ? 'idle' : 'offline').catch(() => {});
  }
}

async function fleetLog(level, event, message, meta) {
  if (!state.fleetMachineId) return;
  try {
    await fleetPost('/log', {
      machineId: state.fleetMachineId,
      level,
      event,
      message,
      meta: { botType: BOT_TYPE, ...(meta || {}) },
    });
  } catch (_) {}
}

async function fleetHeartbeat(status, opts = {}) {
  if (!state.fleetMachineId) return null;
  const manifest = chrome.runtime.getManifest();
  try {
    const data = await fleetPost('/heartbeat', {
      machineId: state.fleetMachineId,
      label: state.fleetMachineLabel || state.fleetMachineId,
      status: state.paused ? 'paused' : status,
      jobsDone: state.stats.viewsDone || 0,
      jobsTotal: state.dbStats?.ready_view || state.stats.listingsFound || 0,
      extensionVersion: manifest?.version,
      popupMessage: opts.message || buildPopupMessage(),
      progressAt: opts.progress ? new Date().toISOString() : undefined,
      meta: {
        botType: BOT_TYPE,
        phase: state.phase,
        viewsFailed: state.stats.viewsFailed || 0,
        favoritesDone: state.stats.favoritesDone || 0,
        detailsDone: state.stats.detailsDone || 0,
        dbStats: state.dbStats,
        fleetMode: state.fleetMode,
        running: state.running,
      },
    });
    if (data.commands?.length) await executeFleetCommands(data.commands);
    return data;
  } catch (err) {
    console.warn('fleetHeartbeat:', err.message);
    return null;
  }
}

function buildPopupMessage() {
  const s = state.stats;
  const d = state.dbStats;
  if (state.running) {
    const phaseLabel = {
      sync: 'Liste', detail: 'Detay', view: 'Görüntüleme', wait: 'Bekleme', rest: 'Mola',
    }[state.phase] || state.phase;
    if (state.rhythmPhase === 'rest') {
      const left = state.rhythmEndsAt ? Math.ceil((state.rhythmEndsAt - Date.now()) / 60000) : 0;
      return `Mola · ${Math.max(0, left)} dk kaldı`;
    }
    if (d) {
      const listInfo = d.list_scan_complete
        ? 'liste tamam'
        : `${d.list_pages_done || 0}/${d.total_pages || '?'} sayfa`;
      return `${phaseLabel} · ${listInfo} · ${d.detail_total} detay · ${d.views_total} görüntüleme`;
    }
    return `${phaseLabel} · görüntüleme ${s.viewsDone}`;
  }
  if (d) return `${d.links_total} link · ${d.need_detail} detay bekliyor`;
  return state.fleetMode ? 'Fleet beklemede' : 'Hazır';
}

async function fleetAckCommand(commandId, success, result) {
  try {
    await fleetPost(`/commands/${commandId}/ack`, {
      machineId: state.fleetMachineId,
      success,
      result,
    });
  } catch (_) {}
}

async function executeFleetCommands(commands) {
  for (const cmd of commands) {
    const id = cmd.id;
    const name = cmd.command;
    try {
      if (name === 'stop_fleet') {
        stopBot();
        state.fleetMode = false;
        chrome.alarms.clear(FLEET_HEARTBEAT_ALARM);
        await chrome.storage.local.set({ fleetMode: false });
        await fleetHeartbeat('offline');
        await fleetAckCommand(id, true, { action: 'stopped' });
        continue;
      }
      if (name === 'start_fleet') {
        await startFleetMode();
        await fleetAckCommand(id, true, { action: 'started' });
        continue;
      }
      if (name === 'pause' || name === 'pause_view') {
        pauseBot();
        await fleetAckCommand(id, true, { action: 'paused' });
        continue;
      }
      if (name === 'resume' || name === 'resume_view') {
        resumeBot();
        await fleetAckCommand(id, true, { action: 'resumed' });
        continue;
      }
      await fleetAckCommand(id, false, { error: 'unknown_command' });
    } catch (err) {
      await fleetAckCommand(id, false, { error: err.message });
    }
  }
}

function scheduleFleetAlarms() {
  const min = VIEW_BOT_API?.fleet?.heartbeatMin || 2;
  chrome.alarms.create(FLEET_HEARTBEAT_ALARM, { periodInMinutes: min });
  chrome.alarms.create(AUTO_RUN_ALARM, { periodInMinutes: 60 });
}

function defaultStats() {
  return {
    listingsFound: 0,
    viewsDone: 0,
    viewsFailed: 0,
    favoritesDone: 0,
    syncPagesDone: 0,
    detailsDone: 0,
    detailsFailed: 0,
  };
}

/** MV3 service worker uyuyunca pipeline durur — alarm ile otomatik yeniden başlat. */
async function ensureBotRunning(reason = 'watchdog') {
  const stored = await chrome.storage.local.get(['autoRunHourly', 'manuallyStopped']);
  if (stored.manuallyStopped || stored.autoRunHourly === false) return;
  if (state.running) return;

  const settings = await getSettings();
  if (!settings.apiUrl || !settings.fleetMachineId) return;

  state.settings = settings;
  state.apiUrl = settings.apiUrl;
  state.pipelineMode = true;
  state.fleetMachineId = settings.fleetMachineId;
  state.fleetMachineLabel = settings.fleetMachineLabel || settings.fleetMachineId;
  state.fleetMode = true;
  state.stats = defaultStats();

  fleetLog('info', 'auto_restart', `Otomatik başlat (${reason})`).catch(() => {});
  runBot();
}

async function startFleetMode() {
  const settings = await getSettings();
  if (!settings.fleetMachineId) throw new Error('Makine ID gerekli');
  state.fleetMode = true;
  state.pipelineMode = true;
  state.fleetMachineId = settings.fleetMachineId;
  state.fleetMachineLabel = settings.fleetMachineLabel || settings.fleetMachineId;
  state.apiUrl = settings.apiUrl;
  state.settings = settings;
  await chrome.storage.local.set({
    fleetMode: true,
    fleetMachineId: state.fleetMachineId,
    fleetMachineLabel: state.fleetMachineLabel,
    pipelineMode: true,
  });
  scheduleFleetAlarms();
  await fleetLog('info', 'fleet_start', 'Sahibinden pipeline başladı');
  await fleetHeartbeat('idle');
  await chrome.storage.local.set({ autoRunHourly: true, manuallyStopped: false });
  if (!state.running) {
    state.stats = defaultStats();
    runBot();
  }
}

async function tryResumeFleet() {
  const settings = await getSettings();
  const stored = await chrome.storage.local.get(['fleetMode', 'autoRunHourly', 'manuallyStopped']);
  if (!settings.fleetMachineId || !settings.apiUrl) return;
  if (!stored.fleetMode && stored.autoRunHourly === false) return;

  state.fleetMode = stored.fleetMode === true || stored.autoRunHourly !== false;
  state.pipelineMode = settings.pipelineMode !== false;
  state.fleetMachineId = settings.fleetMachineId;
  state.fleetMachineLabel = settings.fleetMachineLabel || settings.fleetMachineId;
  state.apiUrl = settings.apiUrl;
  state.settings = settings;
  scheduleFleetAlarms();
  await fleetHeartbeat(state.running ? 'viewing' : 'idle');
  if (!stored.manuallyStopped && stored.autoRunHourly !== false) {
    await ensureBotRunning('resume');
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLEET_HEARTBEAT_ALARM) {
    tryResumeFleet()
      .then(() => ensureBotRunning('heartbeat'))
      .catch(() => {});
    return;
  }
  if (alarm.name === AUTO_RUN_ALARM) {
    ensureBotRunning('hourly').catch(() => {});
  }
});

tryResumeFleet().catch(() => {});

function stopBot() {
  state.running = false;
  state.paused = false;
  state.queue = [];
  chrome.storage.local.set({ manuallyStopped: true }).catch(() => {});
  closeSyncTab().catch(() => {});
}

function pauseBot() {
  if (state.running) state.paused = true;
}

function resumeBot() {
  if (state.running) state.paused = false;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg.type) {
      case 'start': {
        if (state.running) {
          sendResponse({ error: 'Zaten çalışıyor' });
          break;
        }
        state.settings = await getSettings();
        state.apiUrl = state.settings.apiUrl;
        state.pipelineMode = state.settings.pipelineMode !== false && !!state.apiUrl;
        state.fleetMachineId = state.settings.fleetMachineId || 'local';

        await chrome.storage.local.set({
          autoRunHourly: state.settings.autoRunHourly !== false,
          manuallyStopped: false,
          fleetMode: true,
        });
        scheduleFleetAlarms();

        if (state.pipelineMode) {
          state.stats = defaultStats();
          runBot();
          sendResponse({ ok: true, mode: 'pipeline' });
          break;
        }

        state.queue = buildQueueFromSettings(state.settings);
        if (state.queue.length === 0) {
          sendResponse({ error: 'API adresi veya ilan listesi gerekli.' });
          break;
        }
        state.stats = {
          listingsFound: state.queue.length,
          viewsDone: 0,
          viewsFailed: 0,
          favoritesDone: 0,
        };
        runBot();
        sendResponse({ ok: true, count: state.queue.length, mode: 'manual' });
        break;
      }
      case 'stop':
        stopBot();
        sendResponse({ ok: true });
        break;
      case 'pause':
        pauseBot();
        sendResponse({ ok: true });
        break;
      case 'resume':
        resumeBot();
        sendResponse({ ok: true });
        break;
      case 'status': {
        const last = await chrome.storage.local.get('lastProgress');
        let dbStats = state.dbStats;
        if (!dbStats && state.settings?.apiUrl) {
          dbStats = await refreshDbStats().catch(() => null);
        }
        sendResponse({
          running: state.running,
          paused: state.paused,
          phase: state.phase,
          rhythmPhase: state.rhythmPhase,
          rhythmEndsAt: state.rhythmEndsAt,
          queueLength: state.queue.length,
          stats: state.stats,
          dbStats,
          lastProgress: last.lastProgress,
        });
        break;
      }
      case 'getSettings':
        sendResponse({ settings: await getSettings() });
        break;
      case 'saveSettings':
        await chrome.storage.local.set(msg.settings);
        sendResponse({ ok: true });
        break;
      case 'getDbStats': {
        state.settings = await getSettings();
        state.apiUrl = state.settings.apiUrl;
        const dbStats = await refreshDbStats();
        sendResponse({ dbStats });
        break;
      }
      case 'START_FLEET': {
        try {
          if (msg.fleetMachineId) {
            await chrome.storage.local.set({
              fleetMachineId: msg.fleetMachineId,
              fleetMachineLabel: msg.fleetMachineLabel || msg.fleetMachineId,
              apiUrl: msg.apiUrl || state.apiUrl,
            });
          }
          await startFleetMode();
          sendResponse({ ok: true });
        } catch (e) {
          sendResponse({ error: e.message });
        }
        break;
      }
      case 'STOP_FLEET': {
        stopBot();
        state.fleetMode = false;
        chrome.alarms.clear(FLEET_HEARTBEAT_ALARM);
        chrome.alarms.clear(AUTO_RUN_ALARM);
        await chrome.storage.local.set({ fleetMode: false, manuallyStopped: true });
        await fleetHeartbeat('offline');
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false });
    }
  })();
  return true;
});
