const $ = (id) => document.getElementById(id);

const els = {
  statusBadge: $('statusBadge'),
  phaseLabel: $('phaseLabel'),
  statusDetail: $('statusDetail'),
  dbLinks: $('dbLinks'),
  dbPages: $('dbPages'),
  dbDetail: $('dbDetail'),
  dbViews: $('dbViews'),
  statSync: $('statSync'),
  statDetails: $('statDetails'),
  statViews: $('statViews'),
  statFav: $('statFav'),
  apiUrl: $('apiUrl'),
  fleetMachineId: $('fleetMachineId'),
  storeUrl: $('storeUrl'),
  listBaseUrl: $('listBaseUrl'),
  delayMin: $('delayMin'),
  delayMax: $('delayMax'),
  dwell: $('dwell'),
  headlessTabs: $('headlessTabs'),
  rhythmEnabled: $('rhythmEnabled'),
  autoRunHourly: $('autoRunHourly'),
  btnStart: $('btnStart'),
  btnPause: $('btnPause'),
  btnStop: $('btnStop'),
  btnFleetDash: $('btnFleetDash'),
};

const PHASE_LABELS = {
  idle: 'Beklemede',
  start: 'Başlıyor',
  sync: '1 · Liste tarama',
  detail: '2 · Detay çekme',
  view: '3 · Görüntüleme',
  wait: 'Bekleme',
  rest: 'Mola',
  done: 'Tamamlandı',
  error: 'Hata',
};

function formatRhythmLabel(data) {
  if (data.rhythmPhase === 'rest' && data.rhythmEndsAt) {
    const left = Math.max(0, Math.ceil((data.rhythmEndsAt - Date.now()) / 60000));
    return `Mola · ${left} dk kaldı`;
  }
  if (data.rhythmPhase === 'work' && data.rhythmEndsAt) {
    const left = Math.max(0, Math.ceil((data.rhythmEndsAt - Date.now()) / 60000));
    return `Çalışıyor · ${left} dk kaldı`;
  }
  return null;
}

function readSettingsFromForm() {
  return {
    apiUrl: els.apiUrl?.value?.trim() || '',
    fleetMachineId: els.fleetMachineId?.value?.trim() || '',
    fleetMachineLabel: els.fleetMachineId?.value?.trim() || '',
    storeUrl: els.storeUrl.value.trim(),
    listBaseUrl: els.listBaseUrl?.value?.trim() || '',
    storeKey: 'fixpartsyedekparca',
    delayMinMs: Number(els.delayMin.value) * 1000,
    delayMaxMs: Number(els.delayMax.value) * 1000,
    dwellMs: Number(els.dwell.value) * 1000,
    headlessTabs: els.headlessTabs.checked,
    rhythmEnabled: els.rhythmEnabled?.checked !== false,
    autoRunHourly: els.autoRunHourly?.checked !== false,
    pipelineMode: true,
    enableFavorite: true,
  };
}

function applySettingsToForm(settings) {
  if (settings.apiUrl && els.apiUrl) els.apiUrl.value = settings.apiUrl;
  if (settings.fleetMachineId && els.fleetMachineId) els.fleetMachineId.value = settings.fleetMachineId;
  if (settings.storeUrl) els.storeUrl.value = settings.storeUrl;
  if (settings.listBaseUrl && els.listBaseUrl) els.listBaseUrl.value = settings.listBaseUrl;
  if (settings.delayMinMs != null) els.delayMin.value = settings.delayMinMs / 1000;
  if (settings.delayMaxMs != null) els.delayMax.value = settings.delayMaxMs / 1000;
  if (settings.dwellMs != null) els.dwell.value = settings.dwellMs / 1000;
  if (settings.headlessTabs != null) els.headlessTabs.checked = settings.headlessTabs;
  if (settings.rhythmEnabled != null && els.rhythmEnabled) {
    els.rhythmEnabled.checked = settings.rhythmEnabled;
  }
  if (settings.autoRunHourly != null && els.autoRunHourly) {
    els.autoRunHourly.checked = settings.autoRunHourly;
  }
}

function setUiRunning(running, paused = false) {
  els.btnStart.disabled = running;
  els.btnPause.disabled = !running;
  els.btnStop.disabled = !running;
  els.btnPause.textContent = paused ? 'Devam' : 'Duraklat';

  els.statusBadge.className = 'badge';
  if (!running) {
    els.statusBadge.textContent = 'Hazır';
  } else if (paused) {
    els.statusBadge.textContent = 'Duraklatıldı';
    els.statusBadge.classList.add('paused');
  } else {
    els.statusBadge.textContent = 'Çalışıyor';
    els.statusBadge.classList.add('running');
  }
}

function updateDbStats(db) {
  if (!db) return;
  els.dbLinks.textContent = db.links_total ?? 0;
  const pages = db.list_scan_complete
    ? `${db.list_pages_done ?? 0} ✓`
    : `${db.list_pages_done ?? 0}/${db.total_pages ?? '?'}`;
  els.dbPages.textContent = pages;
  els.dbDetail.textContent = db.detail_total ?? 0;
  els.dbViews.textContent = db.views_total ?? 0;
  if (db.need_detail > 0 && !stateRunning) {
    els.statusDetail.textContent = `${db.need_detail} ilanın detayı bekliyor`;
  }
}

let stateRunning = false;

function updateStats(data) {
  const s = data.stats || {};
  const db = data.dbStats;
  els.statSync.textContent = s.syncPagesDone ?? 0;
  els.statDetails.textContent = s.detailsDone ?? 0;
  els.statViews.textContent = s.viewsDone ?? 0;
  els.statFav.textContent = s.favoritesDone ?? 0;
  if (db) updateDbStats(db);

  const phase = data.phase || 'idle';
  const rhythmLabel = formatRhythmLabel(data);
  els.phaseLabel.textContent = rhythmLabel || PHASE_LABELS[phase] || phase;

  if (data.message) {
    els.statusDetail.textContent = data.message;
  } else if (phase === 'view' && data.currentListing) {
    els.statusDetail.textContent = data.currentListing;
  } else if (phase === 'done') {
    els.statusBadge.textContent = 'Tamamlandı';
    els.statusBadge.classList.add('done');
    setUiRunning(false);
    stateRunning = false;
  } else if (phase === 'error') {
    els.statusBadge.textContent = 'Hata';
    els.statusBadge.classList.add('error');
    els.statusDetail.textContent = data.error || 'Bilinmeyen hata';
    setUiRunning(false);
    stateRunning = false;
  }
}

async function refreshStatus() {
  const res = await chrome.runtime.sendMessage({ type: 'status' });
  stateRunning = res.running;
  setUiRunning(res.running, res.paused);
  updateStats({
    stats: res.stats,
    phase: res.phase,
    rhythmPhase: res.rhythmPhase,
    rhythmEndsAt: res.rhythmEndsAt,
    dbStats: res.dbStats,
    ...(res.lastProgress || {}),
  });
}

async function refreshDbOnly() {
  const res = await chrome.runtime.sendMessage({ type: 'getDbStats' });
  if (res?.dbStats) updateDbStats(res.dbStats);
}

els.btnStart.addEventListener('click', async () => {
  const settings = readSettingsFromForm();
  if (!settings.apiUrl) {
    els.statusDetail.textContent = 'API sunucusu adresi gerekli.';
    return;
  }
  if (!settings.fleetMachineId) {
    els.statusDetail.textContent = 'Makine ID girin (örn. sahibinden-GPU-1).';
    return;
  }
  await chrome.runtime.sendMessage({ type: 'saveSettings', settings });
  setUiRunning(true);
  stateRunning = true;
  const res = await chrome.runtime.sendMessage({ type: 'start' });
  if (res?.error) {
    setUiRunning(false);
    stateRunning = false;
    els.statusDetail.textContent = res.error;
  }
});

els.btnPause.addEventListener('click', async () => {
  const res = await chrome.runtime.sendMessage({ type: 'status' });
  if (res.paused) {
    await chrome.runtime.sendMessage({ type: 'resume' });
    setUiRunning(true, false);
  } else {
    await chrome.runtime.sendMessage({ type: 'pause' });
    setUiRunning(true, true);
  }
});

els.btnStop.addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'stop' });
  setUiRunning(false);
  stateRunning = false;
  els.statusDetail.textContent = 'Durduruldu.';
});

function fleetDashboardUrl(apiUrl) {
  try {
    const u = new URL(apiUrl || els.apiUrl?.value || 'http://51.102.128.78:3009');
    return `${u.origin}/fleet?bot=sahibinden`;
  } catch {
    return 'http://51.102.128.78:3009/fleet?bot=sahibinden';
  }
}

els.btnFleetDash?.addEventListener('click', () => {
  chrome.tabs.create({ url: fleetDashboardUrl(els.apiUrl?.value) });
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'progress') {
    stateRunning = msg.running;
    setUiRunning(msg.running, msg.paused);
    updateStats(msg);
  }
});

(async () => {
  const res = await chrome.runtime.sendMessage({ type: 'getSettings' });
  if (res?.settings) {
    applySettingsToForm(res.settings);
    if (!els.listBaseUrl.value) {
      els.listBaseUrl.value = 'https://fixpartsyedekparca.sahibinden.com/yedek-parca-aksesuar-donanim-tuning';
    }
  }
  if (!els.apiUrl.value) {
    els.apiUrl.value = 'http://51.102.128.78:3009';
  }
  await refreshStatus();
  await refreshDbOnly();
  setInterval(refreshStatus, 2000);
  setInterval(refreshDbOnly, 8000);
})();
