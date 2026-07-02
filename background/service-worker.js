importScripts('../config.js');

const DEFAULT_STORE_URL = "https://fixpartsyedekparca.sahibinden.com/";
const FLEET_HEARTBEAT_ALARM = 'viewFleetHeartbeat';
const BOT_TYPE = 'sahibinden_view';
const DEFAULT_API_URL = typeof VIEW_BOT_API !== 'undefined'
  ? `${VIEW_BOT_API.base}`
  : 'http://51.102.128.78:3009';

const state = {
  running: false,
  paused: false,
  queue: [],
  stats: { listingsFound: 0, viewsDone: 0, viewsFailed: 0, favoritesDone: 0 },
  settings: null,
  fleetMode: false,
  fleetMachineId: '',
  fleetMachineLabel: '',
  apiUrl: DEFAULT_API_URL,
};

function normalizeListingUrl(href) {
  if (!href) return null;
  try {
    const raw = href.trim();
    const url = new URL(raw.startsWith("http") ? raw : `https://www.sahibinden.com${raw.startsWith("/") ? raw : `/${raw}`}`);
    if (!url.hostname.includes("sahibinden.com")) return null;
    const match = url.pathname.match(/\/ilan\/([^/]+)/i);
    if (!match) return null;
    const slug = match[1];
    if (slug.length < 8) return null;
    url.hash = "";
    url.search = "";
    if (!url.pathname.endsWith("/detay")) {
      url.pathname = `/ilan/${slug}/detay`;
    }
    return url.toString();
  } catch {
    return null;
  }
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
    "listingUrlsText",
    "processLimit",
    "storeUrl",
    "scanAllPages",
    "delayMinMs",
    "delayMaxMs",
    "dwellMs",
    "headlessTabs",
    "enableFavorite",
    "fleetMode",
    "fleetMachineId",
    "fleetMachineLabel",
    "apiUrl",
  ]);
  return {
    listingUrlsText: stored.listingUrlsText || "",
    processLimit: stored.processLimit ?? 100,
    storeUrl: stored.storeUrl || DEFAULT_STORE_URL,
    scanAllPages: stored.scanAllPages === true,
    delayMinMs: stored.delayMinMs ?? 8000,
    delayMaxMs: stored.delayMaxMs ?? 15000,
    dwellMs: stored.dwellMs ?? 8000,
    headlessTabs: stored.headlessTabs !== false,
    enableFavorite: stored.enableFavorite === true,
    fleetMode: stored.fleetMode === true,
    fleetMachineId: String(stored.fleetMachineId || "").trim(),
    fleetMachineLabel: String(stored.fleetMachineLabel || "").trim(),
    apiUrl: stored.apiUrl || DEFAULT_API_URL,
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
    type: "progress",
    running: state.running,
    paused: state.paused,
    queueLength: state.queue.length,
    stats: { ...state.stats },
    ...extra,
  };
  await chrome.storage.local.set({ lastProgress: payload });
  try {
    await chrome.runtime.sendMessage({ type: "progress", ...payload });
  } catch {
    /* popup kapalı */
  }
}

async function waitForTabLoad(tabId, timeoutMs = 45000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Sayfa yükleme zaman aşımı"));
    }, timeoutMs);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

function scrapePageInTab() {
  function normalize(href) {
    if (!href) return null;
    try {
      const url = new URL(href, window.location.origin);
      if (!url.hostname.includes("sahibinden.com")) return null;
      const match = url.pathname.match(/\/ilan\/([^/]+)/i);
      if (!match) return null;
      url.hash = "";
      url.search = "";
      if (!url.pathname.endsWith("/detay")) {
        url.pathname = `/ilan/${match[1]}/detay`;
      }
      return url.toString();
    } catch {
      return null;
    }
  }

  const seen = new Set();
  const listings = [];
  document.querySelectorAll('a[href*="/ilan/"]').forEach((a) => {
    const n = normalize(a.getAttribute("href"));
    if (n && !seen.has(n)) {
      seen.add(n);
      listings.push(n);
    }
  });

  let nextPageUrl = null;
  const nextSelectors = [
    'a[rel="next"]',
    '.prevNextBlock a.next',
    'a.nextPage',
    'a[title="Sonraki"]',
    'a[aria-label="Sonraki"]',
    '.pagingNext a',
    'a[class*="next"]',
  ];
  for (const sel of nextSelectors) {
    const el = document.querySelector(sel);
    if (el?.href && !el.classList.contains("disabled") && !el.getAttribute("aria-disabled")) {
      nextPageUrl = el.href;
      break;
    }
  }
  if (!nextPageUrl) {
    const nextLink = [...document.querySelectorAll("a")].find((a) => {
      const t = (a.textContent || "").trim().toLowerCase();
      return (t === "sonraki" || t === "ileri" || t === "›" || t === ">") && a.href;
    });
    nextPageUrl = nextLink?.href || null;
  }

  return { listings, nextPageUrl };
}

async function scrapeStoreToList(settings) {
  const tab = await chrome.tabs.create({ url: settings.storeUrl, active: false });
  const found = new Set(parseListingUrls(settings.listingUrlsText));
  const initialSize = found.size;
  let added = 0;
  const processLimit = Math.max(1, settings.processLimit || 100);
  /** scanAllPages: sınırsız tara; değilse processLimit'e ulaşana kadar sayfa sayfa git */
  const fetchTarget = settings.scanAllPages ? Infinity : processLimit;
  let pagesScanned = 0;

  try {
    await waitForTabLoad(tab.id);
    await sleep(1500);

    const pages = [settings.storeUrl];
    const scanned = new Set();

    while (pages.length > 0) {
      const pageUrl = pages.shift();
      if (scanned.has(pageUrl)) continue;
      scanned.add(pageUrl);
      pagesScanned += 1;

      await chrome.tabs.update(tab.id, { url: pageUrl });
      await waitForTabLoad(tab.id);
      await sleep(1200);

      const [injection] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: scrapePageInTab,
      });
      const data = injection?.result;
      if (!data) continue;

      for (const url of data.listings || []) {
        if (!found.has(url)) {
          found.add(url);
          added += 1;
        }
      }

      const needMore = found.size < fetchTarget;
      const hasNext =
        data.nextPageUrl && !scanned.has(data.nextPageUrl);

      if (needMore && hasNext) {
        pages.push(data.nextPageUrl);
      } else {
        break;
      }
    }

    await chrome.storage.local.set({
      lastStoreFetch: {
        pagesScanned,
        total: found.size,
        target: settings.scanAllPages ? "all" : processLimit,
        reachedTarget: found.size >= fetchTarget,
      },
    });
  } finally {
    try {
      await chrome.tabs.remove(tab.id);
    } catch {
      /* */
    }
  }

  const allUrls = [...found];
  const listingUrlsText = (
    settings.scanAllPages ? allUrls : allUrls.slice(0, processLimit)
  ).join("\n");
  await chrome.storage.local.set({ listingUrlsText });
  return {
    listingUrlsText,
    added,
    total: settings.scanAllPages ? found.size : Math.min(found.size, processLimit),
    pagesScanned,
    hadExisting: initialSize,
  };
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

async function viewListing(url) {
  const { dwellMs, headlessTabs, delayMinMs, delayMaxMs, enableFavorite } = state.settings;
  let tab = null;
  try {
    tab = await chrome.tabs.create({ url, active: !headlessTabs });
    await waitForTabLoad(tab.id, 60000);
    await sleep(dwellMs);
    if (enableFavorite) {
      const ok = await tryFavoriteListing(tab.id);
      if (ok) state.stats.favoritesDone = (state.stats.favoritesDone || 0) + 1;
    }
    state.stats.viewsDone += 1;
    await broadcastProgress({ phase: "view", currentListing: url });
    fleetHeartbeat('viewing', { progress: true }).catch(() => {});
  } catch (e) {
    state.stats.viewsFailed += 1;
    console.error("Görüntüleme hatası:", url, e);
    fleetLog('error', 'view_failed', e.message, { url }).catch(() => {});
  } finally {
    if (tab?.id) {
      try {
        await chrome.tabs.remove(tab.id);
      } catch {
        /* */
      }
    }
    if (state.running && !state.paused) {
      await sleep(randomDelay(delayMinMs, delayMaxMs));
    }
  }
}

async function runBot() {
  if (state.running) return;

  state.running = true;
  state.paused = false;

  try {
    await broadcastProgress({ phase: "start" });

    while (state.queue.length > 0 && state.running) {
      while (state.paused && state.running) {
        await sleep(500);
      }
      if (!state.running) break;
      const url = state.queue.shift();
      await viewListing(url);
    }

    await broadcastProgress({ phase: "done" });
  } catch (e) {
    console.error("Bot hatası:", e);
    await broadcastProgress({ phase: "error", error: e.message });
  } finally {
    state.running = false;
    state.paused = false;
    await broadcastProgress({ phase: "idle" });
    fleetHeartbeat(state.fleetMode ? 'idle' : 'offline').catch(() => {});
  }
}

function apiBaseFromUrl(apiUrl) {
  try {
    return new URL(apiUrl || DEFAULT_API_URL).origin;
  } catch {
    return DEFAULT_API_URL;
  }
}

async function fleetPost(path, body) {
  const base = apiBaseFromUrl(state.apiUrl);
  const prefix = typeof VIEW_BOT_API !== 'undefined' && VIEW_BOT_API.apiPrefix
    ? VIEW_BOT_API.apiPrefix
    : '/sahibinden';
  const res = await fetch(`${base}${prefix}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
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
      jobsTotal: state.stats.listingsFound || state.queue.length || 0,
      extensionVersion: manifest?.version,
      popupMessage: opts.message || buildPopupMessage(),
      progressAt: opts.progress ? new Date().toISOString() : undefined,
      meta: {
        botType: BOT_TYPE,
        viewsFailed: state.stats.viewsFailed || 0,
        favoritesDone: state.stats.favoritesDone || 0,
        queueLength: state.queue.length,
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
  if (state.running) {
    return `Görüntüleme ${s.viewsDone}/${s.listingsFound || '?'} · kuyruk ${state.queue.length}`;
  }
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
  state.fleetMachineId = settings.fleetMachineId;
  state.fleetMachineLabel = settings.fleetMachineLabel || settings.fleetMachineId;
  state.apiUrl = settings.apiUrl;
  await chrome.storage.local.set({
    fleetMode: true,
    fleetMachineId: state.fleetMachineId,
    fleetMachineLabel: state.fleetMachineLabel,
  });
  scheduleFleetHeartbeat();
  await fleetLog('info', 'fleet_start', 'Sahibinden görüntüleme fleet başladı');
  await fleetHeartbeat('idle');
  if (!state.running) {
    state.settings = settings;
    state.queue = buildQueueFromSettings(settings);
    if (state.queue.length) {
      state.stats = {
        listingsFound: state.queue.length,
        viewsDone: 0,
        viewsFailed: 0,
        favoritesDone: 0,
      };
      runBot();
    }
  }
}

async function tryResumeFleet() {
  const settings = await getSettings();
  if (!settings.fleetMode || !settings.fleetMachineId) return;
  state.fleetMode = true;
  state.fleetMachineId = settings.fleetMachineId;
  state.fleetMachineLabel = settings.fleetMachineLabel || settings.fleetMachineId;
  state.apiUrl = settings.apiUrl;
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
      case "start": {
        if (state.running) {
          sendResponse({ error: "Zaten çalışıyor" });
          break;
        }
        state.settings = await getSettings();
        state.queue = buildQueueFromSettings(state.settings);
        if (state.queue.length === 0) {
          sendResponse({ error: "Geçerli ilan linki bulunamadı. Liste kontrol edin." });
          break;
        }
        state.stats = {
          listingsFound: state.queue.length,
          viewsDone: 0,
          viewsFailed: 0,
        };
        runBot();
        sendResponse({ ok: true, count: state.queue.length });
        break;
      }
      case "fetchFromStore": {
        try {
          const settings = await getSettings();
          if (msg.settings) {
            await chrome.storage.local.set(msg.settings);
            Object.assign(settings, msg.settings);
          }
          const result = await scrapeStoreToList(settings);
          sendResponse(result);
        } catch (e) {
          sendResponse({ error: e.message });
        }
        break;
      }
      case "stop":
        stopBot();
        sendResponse({ ok: true });
        break;
      case "pause":
        pauseBot();
        sendResponse({ ok: true });
        break;
      case "resume":
        resumeBot();
        sendResponse({ ok: true });
        break;
      case "status": {
        const last = await chrome.storage.local.get("lastProgress");
        sendResponse({
          running: state.running,
          paused: state.paused,
          queueLength: state.queue.length,
          stats: state.stats,
          lastProgress: last.lastProgress,
        });
        break;
      }
      case "getSettings":
        sendResponse({ settings: await getSettings() });
        break;
      case "saveSettings":
        await chrome.storage.local.set(msg.settings);
        sendResponse({ ok: true });
        break;
      case "START_FLEET": {
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
      case "STOP_FLEET": {
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
