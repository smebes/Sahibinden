importScripts('../config.js', '../lib/photo-urls.js', '../lib/parse-list.js', '../lib/parse-detail.js');

const DEFAULT_STORE_URL = 'https://fixpartsyedekparca.sahibinden.com/';
const FLEET_HEARTBEAT_ALARM = 'viewFleetHeartbeat';
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
  syncOffset: 0,
  syncTotalPages: null,
  listScanComplete: false,
  settings: null,
  fleetMode: false,
  fleetMachineId: '',
  fleetMachineLabel: '',
  apiUrl: DEFAULT_API_URL,
  pipelineMode: true,
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
  };
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

async function broadcastProgress(extra = {}) {
  const payload = {
    type: 'progress',
    running: state.running,
    paused: state.paused,
    phase: state.phase,
    queueLength: state.queue.length,
    stats: { ...state.stats },
    dbStats: state.dbStats,
    syncOffset: state.syncOffset,
    syncTotalPages: state.syncTotalPages,
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

async function fleetPost(path, body) {
  const base = apiBaseFromUrl(state.apiUrl);
  const res = await fetch(`${base}${apiPrefix()}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function fleetGet(path, params = {}) {
  const base = apiBaseFromUrl(state.apiUrl);
  const qs = new URLSearchParams(params).toString();
  const url = `${base}${apiPrefix()}${path}${qs ? `?${qs}` : ''}`;
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function fetchWithRetry(url, { referer, retries = 3 } = {}) {
  let delay = 5000;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, {
        credentials: 'include',
        headers: {
          Accept: 'text/html',
          Referer: referer || DEFAULT_STORE_URL,
        },
      });
      if (res.status === 429) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res;
    } catch (err) {
      if (attempt === retries) throw err;
      await sleep(delay);
      delay *= 2;
    }
  }
  throw new Error('fetch başarısız');
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
  const pageSize = store.pageSize;
  const offset = state.syncOffset;
  const listPage = Math.floor(offset / pageSize) + 1;
  const url = `${store.listBaseUrl}?pagingOffset=${offset}&sorting=storeShowcase`;

  state.phase = 'sync';
  await broadcastProgress({ message: `Liste sayfası ${listPage} taranıyor…` });

  const res = await fetchWithRetry(url, { referer: store.referer });
  const html = await res.text();
  const parsed = SahibindenParseList.parseListPageHtml(html);

  if (parsed.totalPages && !state.syncTotalPages) {
    state.syncTotalPages = parsed.totalPages;
  }

  if (parsed.items.length) {
    await fleetPost('/listings/sync-batch', {
      storeKey: store.key,
      listPage,
      items: parsed.items,
    });
    state.stats.listingsFound += parsed.items.length;
  }

  state.stats.syncPagesDone += 1;
  state.syncOffset += pageSize;

  const limit = state.settings.syncPageLimit;
  const reachedEnd = parsed.items.length === 0
    || (state.syncTotalPages && listPage >= state.syncTotalPages)
    || (limit && state.stats.syncPagesDone >= limit);

  if (reachedEnd) {
    state.syncOffset = 0;
    state.stats.syncPagesDone = 0;
  }

  await refreshDbStats();
  await broadcastProgress();
  await sleep(randomDelay(800, 1500));
  return !reachedEnd;
}

async function scrapeAndSaveDetail(job) {
  const { ilanId, url, title } = job;
  const { headlessTabs } = state.settings;
  state.phase = 'detail';
  await broadcastProgress({ message: `Detay: ${title || ilanId}` });

  let tab = null;
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
    await fleetPost(`/listings/${ilanId}/detail`, { detail });
    state.stats.detailsDone += 1;
    fleetLog('info', 'detail_saved', title || ilanId, { ilanId }).catch(() => {});
  } catch (err) {
    state.stats.detailsFailed += 1;
    fleetLog('error', 'detail_failed', err.message, { ilanId, url }).catch(() => {});
    console.error('Detay hatası:', url, err);
  } finally {
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

    const stats = state.dbStats || {};
    const needDetail = stats.need_detail || 0;
    const readyView = stats.ready_view || 0;

    if (!state.listScanComplete) {
      const hasMore = await syncOneListPage();
      if (hasMore) continue;
      state.listScanComplete = true;
    }

    if (needDetail > 0) {
      const { items } = await fleetGet('/listings/need-detail', {
        storeKey: store.key,
        limit: 3,
      });
      if (items?.length) {
        for (const job of items) {
          if (!state.running || state.paused) break;
          await scrapeAndSaveDetail(job);
        }
        await refreshDbStats();
        continue;
      }
    }

    if (readyView > 0) {
      const { job } = await fleetGet('/listings/claim-view', {
        storeKey: store.key,
        machineId: state.fleetMachineId || 'local',
      });
      if (job) {
        await viewListingFromJob(job);
        await refreshDbStats();
        continue;
      }
    }

    state.phase = 'wait';
    await broadcastProgress({ message: 'Yeni iş yok, bekleniyor…' });
    state.syncOffset = 0;
    state.syncTotalPages = null;
    state.listScanComplete = false;
    await sleep(30000);
    await refreshDbStats();
  }
}

async function runBot() {
  if (state.running) return;

  state.running = true;
  state.paused = false;

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
    const phaseLabel = { sync: 'Liste', detail: 'Detay', view: 'Görüntüleme', wait: 'Bekleme' }[state.phase] || state.phase;
    if (d) {
      return `${phaseLabel} · ${d.links_total} link · ${d.detail_total} detay · ${d.views_total} görüntüleme`;
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

function scheduleFleetHeartbeat() {
  const min = VIEW_BOT_API?.fleet?.heartbeatMin || 2;
  chrome.alarms.create(FLEET_HEARTBEAT_ALARM, { periodInMinutes: min });
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
  scheduleFleetHeartbeat();
  await fleetLog('info', 'fleet_start', 'Sahibinden pipeline başladı');
  await fleetHeartbeat('idle');
  if (!state.running) {
    state.stats = {
      listingsFound: 0,
      viewsDone: 0,
      viewsFailed: 0,
      favoritesDone: 0,
      syncPagesDone: 0,
      detailsDone: 0,
      detailsFailed: 0,
    };
    state.syncOffset = 0;
    state.syncTotalPages = null;
    state.listScanComplete = false;
    runBot();
  }
}

async function tryResumeFleet() {
  const settings = await getSettings();
  if (!settings.fleetMode || !settings.fleetMachineId) return;
  state.fleetMode = true;
  state.pipelineMode = settings.pipelineMode !== false;
  state.fleetMachineId = settings.fleetMachineId;
  state.fleetMachineLabel = settings.fleetMachineLabel || settings.fleetMachineId;
  state.apiUrl = settings.apiUrl;
  state.settings = settings;
  scheduleFleetHeartbeat();
  await fleetHeartbeat(state.running ? 'viewing' : 'idle');
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === FLEET_HEARTBEAT_ALARM) {
    tryResumeFleet().catch(() => {});
  }
});

tryResumeFleet().catch(() => {});

function stopBot() {
  state.running = false;
  state.paused = false;
  state.queue = [];
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

        if (state.pipelineMode) {
          state.stats = {
            listingsFound: 0,
            viewsDone: 0,
            viewsFailed: 0,
            favoritesDone: 0,
            syncPagesDone: 0,
            detailsDone: 0,
            detailsFailed: 0,
          };
          state.syncOffset = 0;
          state.syncTotalPages = null;
          state.listScanComplete = false;
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
        await chrome.storage.local.set({ fleetMode: false });
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
