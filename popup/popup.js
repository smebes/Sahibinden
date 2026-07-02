const $ = (id) => document.getElementById(id);

const els = {
  statusBadge: $("statusBadge"),
  statusDetail: $("statusDetail"),
  statFound: $("statFound"),
  statViews: $("statViews"),
  statFailed: $("statFailed"),
  statQueue: $("statQueue"),
  listingUrls: $("listingUrls"),
  lineCount: $("lineCount"),
  processLimit: $("processLimit"),
  storeUrl: $("storeUrl"),
  scanAllPages: $("scanAllPages"),
  delayMin: $("delayMin"),
  delayMax: $("delayMax"),
  dwell: $("dwell"),
  headlessTabs: $("headlessTabs"),
  enableFavorite: $("enableFavorite"),
  apiUrl: $("apiUrl"),
  fleetMachineId: $("fleetMachineId"),
  fleetMachineLabel: $("fleetMachineLabel"),
  btnFleetStart: $("btnFleetStart"),
  btnFleetStop: $("btnFleetStop"),
  btnFleetDash: $("btnFleetDash"),
  btnStart: $("btnStart"),
  btnPause: $("btnPause"),
  btnStop: $("btnStop"),
  btnFetchStore: $("btnFetchStore"),
};

function readSettingsFromForm() {
  return {
    listingUrlsText: els.listingUrls.value,
    processLimit: Number(els.processLimit.value) || 100,
    storeUrl: els.storeUrl.value.trim(),
    scanAllPages: els.scanAllPages.checked,
    delayMinMs: Number(els.delayMin.value) * 1000,
    delayMaxMs: Number(els.delayMax.value) * 1000,
    dwellMs: Number(els.dwell.value) * 1000,
    headlessTabs: els.headlessTabs.checked,
    enableFavorite: els.enableFavorite.checked,
    apiUrl: els.apiUrl?.value?.trim() || '',
    fleetMachineId: els.fleetMachineId?.value?.trim() || '',
    fleetMachineLabel: els.fleetMachineLabel?.value?.trim() || '',
  };
}

function applySettingsToForm(settings) {
  if (settings.listingUrlsText != null) els.listingUrls.value = settings.listingUrlsText;
  if (settings.processLimit != null) els.processLimit.value = settings.processLimit;
  if (settings.storeUrl) els.storeUrl.value = settings.storeUrl;
  if (settings.scanAllPages != null) els.scanAllPages.checked = settings.scanAllPages;
  if (settings.delayMinMs != null) els.delayMin.value = settings.delayMinMs / 1000;
  if (settings.delayMaxMs != null) els.delayMax.value = settings.delayMaxMs / 1000;
  if (settings.dwellMs != null) els.dwell.value = settings.dwellMs / 1000;
  if (settings.headlessTabs != null) els.headlessTabs.checked = settings.headlessTabs;
  if (settings.enableFavorite != null) els.enableFavorite.checked = settings.enableFavorite;
  if (settings.apiUrl && els.apiUrl) els.apiUrl.value = settings.apiUrl;
  if (settings.fleetMachineId && els.fleetMachineId) els.fleetMachineId.value = settings.fleetMachineId;
  if (settings.fleetMachineLabel && els.fleetMachineLabel) els.fleetMachineLabel.value = settings.fleetMachineLabel;
  updateLineCount();
}

function updateLineCount() {
  const lines = els.listingUrls.value
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  els.lineCount.textContent = `${lines.length} satır`;
}

function setUiRunning(running, paused = false) {
  els.btnStart.disabled = running;
  els.btnPause.disabled = !running;
  els.btnStop.disabled = !running;
  els.btnFetchStore.disabled = running;
  els.btnPause.textContent = paused ? "Devam" : "Duraklat";

  els.statusBadge.className = "badge";
  if (!running) {
    els.statusBadge.textContent = "Hazır";
  } else if (paused) {
    els.statusBadge.textContent = "Duraklatıldı";
    els.statusBadge.classList.add("paused");
  } else {
    els.statusBadge.textContent = "Çalışıyor";
    els.statusBadge.classList.add("running");
  }
}

function updateStats(data) {
  const s = data.stats || {};
  els.statFound.textContent = s.listingsFound ?? 0;
  els.statViews.textContent = s.viewsDone ?? 0;
  els.statFailed.textContent = s.viewsFailed ?? 0;
  els.statQueue.textContent = data.queueLength ?? 0;

  if (data.phase === "view" && data.currentListing) {
    els.statusDetail.textContent = `Görüntüleniyor: ${data.currentListing}`;
  } else if (data.phase === "done") {
    els.statusBadge.textContent = "Tamamlandı";
    els.statusBadge.classList.add("done");
    els.statusDetail.textContent = `${s.viewsDone ?? 0} ilan görüntülendi.`;
    setUiRunning(false);
  } else if (data.phase === "error") {
    els.statusBadge.textContent = "Hata";
    els.statusBadge.classList.add("error");
    els.statusDetail.textContent = data.error || "Bilinmeyen hata";
    setUiRunning(false);
  } else if (data.phase === "fetch") {
    els.statusDetail.textContent = data.message || "Mağaza taranıyor…";
  }
}

async function refreshStatus() {
  const res = await chrome.runtime.sendMessage({ type: "status" });
  setUiRunning(res.running, res.paused);
  updateStats({
    stats: res.stats,
    queueLength: res.queueLength,
    ...(res.lastProgress || {}),
  });
}

els.listingUrls.addEventListener("input", updateLineCount);

els.btnStart.addEventListener("click", async () => {
  const settings = readSettingsFromForm();
  if (!settings.listingUrlsText.trim()) {
    els.statusDetail.textContent = "En az bir ilan linki ekleyin.";
    return;
  }
  await chrome.runtime.sendMessage({ type: "saveSettings", settings });
  setUiRunning(true);
  const res = await chrome.runtime.sendMessage({ type: "start" });
  if (res?.error) {
    setUiRunning(false);
    els.statusDetail.textContent = res.error;
  }
});

els.btnFetchStore.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({
    type: "saveSettings",
    settings: readSettingsFromForm(),
  });
  els.btnFetchStore.disabled = true;
  els.statusDetail.textContent = "Mağaza taranıyor…";
  const res = await chrome.runtime.sendMessage({ type: "fetchFromStore" });
  els.btnFetchStore.disabled = false;
  if (res?.error) {
    els.statusDetail.textContent = res.error;
    return;
  }
  if (res?.listingUrlsText != null) {
    els.listingUrls.value = res.listingUrlsText;
    updateLineCount();
  }
  const pages = res?.pagesScanned ?? 1;
  const total = res?.total ?? 0;
  els.statusDetail.textContent =
    `${res?.added ?? 0} yeni ilan eklendi (${pages} sayfa tarandı, listede ${total} ilan).`;
});

els.btnPause.addEventListener("click", async () => {
  const res = await chrome.runtime.sendMessage({ type: "status" });
  if (res.paused) {
    await chrome.runtime.sendMessage({ type: "resume" });
    setUiRunning(true, false);
  } else {
    await chrome.runtime.sendMessage({ type: "pause" });
    setUiRunning(true, true);
  }
});

els.btnStop.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "stop" });
  setUiRunning(false);
  els.statusDetail.textContent = "Durduruldu.";
});

function fleetDashboardUrl(apiUrl) {
  try {
    const u = new URL(apiUrl || els.apiUrl?.value || 'http://51.102.128.78:3009');
    return `${u.origin}/fleet?bot=sahibinden`;
  } catch {
    return 'http://51.102.128.78:3009/fleet?bot=sahibinden';
  }
}

els.btnFleetStart?.addEventListener('click', async () => {
  const settings = readSettingsFromForm();
  if (!settings.fleetMachineId) {
    els.statusDetail.textContent = 'Fleet için Makine ID girin (örn. sahibinden-GPU-1)';
    return;
  }
  await chrome.runtime.sendMessage({ type: 'saveSettings', settings });
  const res = await chrome.runtime.sendMessage({
    type: 'START_FLEET',
    fleetMachineId: settings.fleetMachineId,
    fleetMachineLabel: settings.fleetMachineLabel,
    apiUrl: settings.apiUrl,
  });
  if (res?.error) els.statusDetail.textContent = res.error;
  else els.statusDetail.textContent = `Fleet ${settings.fleetMachineId} başlatıldı`;
});

els.btnFleetStop?.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'STOP_FLEET' });
  els.statusDetail.textContent = 'Fleet durduruldu';
});

els.btnFleetDash?.addEventListener('click', () => {
  chrome.tabs.create({ url: fleetDashboardUrl(els.apiUrl?.value) });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "progress") {
    setUiRunning(msg.running, msg.paused);
    updateStats(msg);
  }
});

(async () => {
  const res = await chrome.runtime.sendMessage({ type: "getSettings" });
  if (res?.settings) applySettingsToForm(res.settings);
  await refreshStatus();
  setInterval(refreshStatus, 2000);
})();
