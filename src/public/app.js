/**
 * MarineGlobe 3D — 100% Live AIS Client Controller (Node.js Backend SSE Mode).
 * Delegates shared UI state/controls to ./ui-controller.js.
 */

import { GlobeEngine } from './globe-engine.js';
import {
  formatCoordShort,
  sortVessels,
  renderHoverTooltipHtml,
  renderClusterTooltipHtml,
  renderFleetSummaryHtml,
  renderVirtualVesselList,
  renderInspectorBodyHtml,
  renderVosHoverTooltipHtml,
  renderVosInspectorHtml,
  renderVirtualFleetTable,
} from './telemetry-ui.js';
import {
  isMobileViewport,
  loadPrefs,
  persistPrefs,
  parseHashDeepLink,
  createToast,
  queryCommonDom,
  fetchMarineWeather,
  createFavoriteMonitor,
  renderPortFilterBanner,
  buildFilterChipsHtml,
  filterVesselsList,
  filterAndSortTableVessels,
  updateTableSortIndicators,
  bindSharedUi,
  registerAppServiceWorker,
} from './ui-controller.js';
import {
  resolveInitialLang,
  setLang,
  t,
  getZoneLabel,
} from './i18n.js';

const TRACK_CACHE_MS = 10 * 60 * 1000;
const savedPrefs = loadPrefs();
const initialLang = resolveInitialLang(savedPrefs.lang);
setLang(initialLang);
const deepLink = parseHashDeepLink();

const LIVE_PRESETS = [
  { id: 'korea-strait', label: 'Korea Strait', lat: 35.1, lon: 129.0, zoom: 3.4 },
  { id: 'shanghai-taiwan', label: 'Shanghai–Taiwan', lat: 27.5, lon: 119.5, zoom: 3.0 },
  { id: 'singapore-malacca', label: 'Malacca–Singapore', lat: 2.2, lon: 103.5, zoom: 3.5 },
  { id: 'north-sea', label: 'North Sea', lat: 51.6, lon: 2.5, zoom: 3.2 },
  { id: 'mediterranean', label: 'Mediterranean', lat: 37.8, lon: 19.5, zoom: 3.0 },
  { id: 'us-east', label: 'US East', lat: 40.8, lon: -72.5, zoom: 3.2 },
  { id: 'us-west', label: 'US West', lat: 34.8, lon: -120.2, zoom: 3.2 },
  { id: 'sydney-au', label: 'Sydney', lat: -33.5, lon: 151.5, zoom: 3.3 },
];

const state = {
  vesselsMap: new Map(),
  allVessels: [],
  filteredVessels: [],
  tableVessels: [],
  vosShips: [],
  selectedMmsi: null,
  selectedVos: null,
  selectedWeather: null,
  portFilter: null,
  pendingDeepLinkMmsi: deepLink.mmsi || null,
  loadingDetailsMmsi: null,
  followSelected: false,
  activeType: 'all',
  movingOnly: Boolean(savedPrefs.movingOnly),
  searchQuery: '',
  sortBy: typeof savedPrefs.sortBy === 'string' ? savedPrefs.sortBy : 'recent-desc',
  tableSortCol: 'updatedAt',
  tableSortDir: 'desc',
  tableSearchQuery: '',
  favorites: new Set(Array.isArray(savedPrefs.favorites) ? savedPrefs.favorites.map(String) : []),
  theme: savedPrefs.theme === 'light' ? 'light' : 'dark',
  lang: initialLang,
  fleetModalOpen: false,
  dirtyUi: false,
  trackFetchedAt: new Map(),
  loadingTracks: false,
  status: {
    provider: 'openwaters',
    connectionState: 'connecting',
    vesselCount: 0,
    msgPerSec: 0,
    lastError: null,
  },
};

const dom = {
  ...queryCommonDom(),
  aisApiKey: document.getElementById('ais-api-key'),
};

const showToast = createToast(dom.toastNotice);
const checkFavoriteAlerts = createFavoriteMonitor((ev) => {
  showToast(
    ev.type === 'departed'
      ? t('toastFavDeparted', { name: ev.name, sog: ev.sog.toFixed(1) })
      : t('toastFavMoored', { name: ev.name, sog: ev.sog.toFixed(1) })
  );
});
let autoTrackTimer = null;
let autoViewportTimer = null;
let lastAutoTrackKey = '';
let lastAutoViewportCenter = { lat: 35.1, lon: 129.0 };
let lastAutoViewportAt = 0;

const globe = new GlobeEngine(dom.canvas, {
  initialLat: deepLink.lat ?? 28,
  initialLon: deepLink.lon ?? 124,
  initialZoom: deepLink.zoom ?? (window.innerWidth <= 768 ? 1.02 : 1.45),
  theme: state.theme,
  lang: state.lang,
  onSelectVessel: (vessel) => selectVessel(vessel.mmsi, true),
  onSelectVos: (vos) => selectVosShip(vos, true),
  onHoverVessel: (vessel, mx, my) => {
    if (!vessel) {
      dom.hoverTooltip.classList.add('hidden');
      return;
    }
    dom.hoverTooltip.innerHTML = renderHoverTooltipHtml(vessel);
    dom.hoverTooltip.style.left = `${Math.min(window.innerWidth - 290, mx + 14)}px`;
    dom.hoverTooltip.style.top = `${Math.max(70, my - 12)}px`;
    dom.hoverTooltip.classList.remove('hidden');
  },
  onHoverVos: (vos, mx, my) => {
    if (!vos) {
      dom.hoverTooltip.classList.add('hidden');
      return;
    }
    dom.hoverTooltip.innerHTML = renderVosHoverTooltipHtml(vos);
    dom.hoverTooltip.style.left = `${Math.min(window.innerWidth - 290, mx + 14)}px`;
    dom.hoverTooltip.style.top = `${Math.max(70, my - 12)}px`;
    dom.hoverTooltip.classList.remove('hidden');
  },
  onHoverCluster: (cluster, mx, my) => {
    if (!cluster) {
      dom.hoverTooltip.classList.add('hidden');
      return;
    }
    dom.hoverTooltip.innerHTML = renderClusterTooltipHtml(cluster);
    dom.hoverTooltip.style.left = `${Math.min(window.innerWidth - 290, mx + 14)}px`;
    dom.hoverTooltip.style.top = `${Math.max(70, my - 12)}px`;
    dom.hoverTooltip.classList.remove('hidden');
  },
  onCameraChange: ({ lat, lon, zoom }) => {
    dom.coordReadout.textContent = `LAT ${formatCoordShort(lat, true)} · LON ${formatCoordShort(lon, false)} · ${zoom >= 100 ? Math.round(zoom) : zoom.toFixed(1)}x`;
    if (zoom >= 2.0) {
      const distDeg = Math.hypot(lat - lastAutoViewportCenter.lat, lon - lastAutoViewportCenter.lon);
      if (distDeg >= 1.8 || zoom >= 6.0) {
        clearTimeout(autoViewportTimer);
        autoViewportTimer = setTimeout(() => {
          const now = Date.now();
          if (now - lastAutoViewportAt < 4000) return;
          lastAutoViewportAt = now;
          lastAutoViewportCenter = { lat: globe.centerLat, lon: globe.centerLon };
          const span = globe.getViewportSpanDeg();
          postViewport({
            lat: globe.centerLat,
            lon: globe.centerLon,
            zoom: globe.zoom,
            halfLat: span.halfLat,
            halfLon: span.halfLon,
          }).catch(() => {});
        }, 900);
      }
    }
    if (zoom >= 2.8 && globe.options.showWakes) {
      const g = 2 / Math.max(1, zoom / 3);
      const key = `${Math.round(lat / g)}:${Math.round(lon / g)}:${Math.round(Math.log2(zoom) * 2)}`;
      if (key !== lastAutoTrackKey) {
        lastAutoTrackKey = key;
        clearTimeout(autoTrackTimer);
        autoTrackTimer = setTimeout(() => {
          loadVisibleTracks(12).catch(() => {});
        }, 1200);
      }
    }
  },
});

const savePrefs = () => persistPrefs(state, globe);

function updatePresetLabels() {
  dom.presetBar.querySelectorAll('[data-zone]').forEach((btn) => {
    const id = btn.dataset.zone;
    const preset = LIVE_PRESETS.find((p) => p.id === id);
    btn.textContent = getZoneLabel(id, preset?.label || id);
  });
}

function renderPresets() {
  dom.presetBar.innerHTML = LIVE_PRESETS.map(
    (p) => `<button class="btn" data-zone="${p.id}">${getZoneLabel(p.id, p.label)}</button>`
  ).join('');
  dom.presetBar.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-zone]');
    if (!btn) return;
    const preset = LIVE_PRESETS.find((p) => p.id === btn.dataset.zone);
    if (!preset) return;
    state.followSelected = false;
    dom.presetBar.querySelectorAll('[data-zone]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    globe.setSelectedVessel(state.selectedMmsi, false);
    globe.flyTo(preset.lat, preset.lon, preset.zoom, 800);
    await postViewport({ lat: preset.lat, lon: preset.lon, zoom: preset.zoom, halfLat: 5, halfLon: 7 });
  });
}

function getEmptyMsg() {
  if (state.status.lastError) return t('emptyError', { err: state.status.lastError });
  if (state.allVessels.length === 0) return t('emptyLoadingServer');
  if (state.activeType === 'favorites') return t('emptyFavorites');
  return t('emptySearch');
}

function renderVisibleList() {
  renderVirtualVesselList(dom.vesselList, state.filteredVessels, state.selectedMmsi, getEmptyMsg(), state.favorites);
}

function renderFleetTable(recompute = true) {
  if (recompute) {
    state.tableVessels = filterAndSortTableVessels(state.filteredVessels, state);
    updateTableSortIndicators(dom.fleetTableHead, state.tableSortCol, state.tableSortDir);
  }
  dom.fleetModalSub.textContent = t('fleetModalSub', { count: state.tableVessels.length.toLocaleString() });
  renderVirtualFleetTable(dom.fleetTableWrap, dom.fleetTableBody, state.tableVessels, state.selectedMmsi, state.favorites);
}

function renderInspector() {
  if (state.selectedVos && !state.selectedMmsi) {
    const prevScroll = dom.inspector.scrollTop;
    dom.inspector.classList.remove('hidden');
    document.body.classList.add('inspector-open');
    const nextHtml = renderVosInspectorHtml(state.selectedVos);
    if (dom.inspector._lastHtml !== nextHtml) {
      dom.inspector._lastHtml = nextHtml;
      dom.inspector.innerHTML = nextHtml;
      dom.inspector.scrollTop = prevScroll;
    }
    return;
  }
  if (!state.selectedMmsi) {
    dom.inspector.classList.add('hidden');
    document.body.classList.remove('inspector-open');
    return;
  }
  const v = state.vesselsMap.get(state.selectedMmsi);
  if (!v) {
    dom.inspector.classList.add('hidden');
    document.body.classList.remove('inspector-open');
    return;
  }
  const prevScroll = dom.inspector.scrollTop;
  dom.inspector.classList.remove('hidden');
  document.body.classList.add('inspector-open');
  const nextHtml = renderInspectorBodyHtml(
    v,
    state.followSelected,
    state.loadingDetailsMmsi === v.mmsi,
    state.favorites.has(v.mmsi),
    state.selectedWeather
  );
  if (dom.inspector._lastHtml !== nextHtml) {
    dom.inspector._lastHtml = nextHtml;
    dom.inspector.innerHTML = nextHtml;
    dom.inspector.scrollTop = prevScroll;
  }
}

function applyFiltersAndRender() {
  const matched = filterVesselsList(state.allVessels, state);
  state.filteredVessels = sortVessels(matched, state.sortBy);
  globe.setVessels(state.filteredVessels);

  const countStr = state.filteredVessels.length.toLocaleString();
  dom.btnFleetTable.innerHTML = `<span class="label-desktop">${t('fleetTableDesktop', { count: countStr })}</span><span class="label-mobile">${t('fleetTableMobile')}</span>`;
  dom.fleetSummary.innerHTML = renderFleetSummaryHtml(state.filteredVessels);
  dom.filteredCount.textContent = t('filteredCount', { count: countStr });

  renderPortFilterBanner(dom.portFilterBanner, state.portFilter, state.filteredVessels);
  dom.filterGrid.innerHTML = buildFilterChipsHtml(state.allVessels, state.activeType, state.favorites);
  renderVisibleList();
  renderInspector();
  if (state.fleetModalOpen) renderFleetTable(true);
  if (state.pendingDeepLinkMmsi && state.vesselsMap.has(state.pendingDeepLinkMmsi)) {
    const mmsi = state.pendingDeepLinkMmsi;
    state.pendingDeepLinkMmsi = null;
    selectVessel(mmsi, true);
  }
}

async function runPool(items, concurrency, worker) {
  let idx = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (idx < items.length) {
      const current = idx++;
      try {
        await worker(items[current]);
      } catch {
        // ignore single track fetch error
      }
    }
  });
  await Promise.all(runners);
}

async function loadVisibleTracks(maxCount = 24) {
  if (state.loadingTracks) return;
  const now = Date.now();
  const visible = globe.getVisibleMovingVessels(maxCount * 2).filter((v) => {
    const last = state.trackFetchedAt.get(v.mmsi) || 0;
    return now - last > TRACK_CACHE_MS;
  });
  const targets = visible.slice(0, maxCount);
  if (targets.length === 0) return;

  state.loadingTracks = true;
  if (dom.btnLoadTracks) dom.btnLoadTracks.textContent = t('btnLoadingTracks', { done: 0, total: targets.length });
  let done = 0;

  try {
    await runPool(targets, 2, async (v) => {
      state.trackFetchedAt.set(v.mmsi, Date.now());
      const res = await fetch(`/api/vessel/${encodeURIComponent(v.mmsi)}`);
      if (res.ok) {
        const data = await res.json();
        if (data.vessel) {
          state.vesselsMap.set(data.vessel.mmsi, data.vessel);
          state.dirtyUi = true;
        }
      }
      done++;
      if (dom.btnLoadTracks) dom.btnLoadTracks.textContent = t('btnLoadingTracks', { done, total: targets.length });
    });
  } finally {
    state.loadingTracks = false;
    if (dom.btnLoadTracks) dom.btnLoadTracks.textContent = t('btnLoadTracks');
  }
}

const ui = bindSharedUi({
  dom,
  state,
  globe,
  savedPrefs,
  savePrefs,
  applyFiltersAndRender,
  renderVisibleList,
  renderInspector,
  renderFleetTable,
  selectVessel,
  showToast,
  onLangChange: () => {
    updatePresetLabels();
    updateStatusUI(state.status);
    updateVosButtonLabel();
  },
});

function updateVosButtonLabel() {
  if (!dom.btnVos) return;
  dom.btnVos.textContent =
    state.vosShips.length > 0
      ? t('vosBtnCount', { count: state.vosShips.length.toLocaleString() })
      : t('btnVos');
}

function selectVosShip(vos, fly = false) {
  if (!vos) return;
  state.selectedMmsi = null;
  state.selectedWeather = null;
  state.followSelected = false;
  state.selectedVos = vos;
  if (isMobileViewport()) {
    ui.setSidebarOpen(false);
    dom.inspector.classList.remove('expanded');
  }
  globe.setSelectedVos(vos.id);
  if (fly) globe.flyTo(vos.lat, vos.lon, Math.max(globe.zoom, 3.6), 650);
  renderVisibleList();
  renderInspector();
}

async function selectVessel(mmsi, fly = false) {
  state.selectedVos = null;
  state.selectedMmsi = mmsi;
  state.selectedWeather = null;
  const v = state.vesselsMap.get(mmsi);
  if (!v) return;

  if (isMobileViewport()) {
    ui.setSidebarOpen(false);
    dom.inspector.classList.remove('expanded');
  }
  globe.setSelectedVessel(mmsi, state.followSelected);
  if (fly) globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 4.8), 700);
  state.loadingDetailsMmsi = mmsi;
  renderVisibleList();
  renderInspector();

  fetchMarineWeather(v.lat, v.lon)
    .then((w) => {
      if (state.selectedMmsi === mmsi && w) {
        state.selectedWeather = w;
        renderInspector();
      }
    })
    .catch(() => {});

  try {
    const res = await fetch(`/api/vessel/${encodeURIComponent(mmsi)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.vessel) {
        state.vesselsMap.set(data.vessel.mmsi, data.vessel);
        state.trackFetchedAt.set(mmsi, Date.now());
        state.allVessels = Array.from(state.vesselsMap.values());
      }
    }
  } catch {
    // keep live record
  } finally {
    if (state.loadingDetailsMmsi === mmsi) state.loadingDetailsMmsi = null;
    applyFiltersAndRender();
  }
}

dom.btnScanView.addEventListener('click', async () => {
  const half = 4.5;
  const lat = globe.centerLat;
  const lon = globe.centerLon;
  const span = globe.getViewportSpanDeg();
  const bbox = [
    Math.max(-85, Number((lat - half).toFixed(2))),
    Math.max(-180, Number((lon - half).toFixed(2))),
    Math.min(85, Number((lat + half).toFixed(2))),
    Math.min(180, Number((lon + half).toFixed(2))),
  ];
  await postViewport({
    lat,
    lon,
    zoom: Math.max(globe.zoom, 7.0),
    halfLat: span.halfLat,
    halfLon: span.halfLon,
    bbox,
  });
  await loadVisibleTracks(12);
});

if (dom.btnLoadTracks) {
  dom.btnLoadTracks.addEventListener('click', () => {
    globe.setOption('showWakes', true);
    if (dom.btnWakes) dom.btnWakes.classList.add('active');
    savePrefs();
    loadVisibleTracks(18).catch(() => {});
  });
}

dom.btnRefreshLive.addEventListener('click', async () => {
  await postConfig({ provider: state.status.provider });
});

// Feed Settings Modal (Server mode)
dom.btnApiConfig.addEventListener('click', () => {
  if (isMobileViewport()) ui.setSidebarOpen(false);
  dom.modalError.style.display = 'none';
  dom.providerSelect.value = state.status.provider || 'openwaters';
  dom.apiModal.classList.remove('hidden');
});
dom.btnCancelModal.addEventListener('click', () => dom.apiModal.classList.add('hidden'));
dom.apiModal.addEventListener('click', (e) => {
  if (e.target === dom.apiModal) dom.apiModal.classList.add('hidden');
});
dom.btnSaveApi.addEventListener('click', async () => {
  const provider = dom.providerSelect.value;
  const aisStreamKey = dom.aisApiKey.value.trim();
  const openWatersToken = dom.openWatersTokenInput.value.trim();
  if (provider === 'aisstream' && !aisStreamKey && !state.status.hasAisStreamKey) {
    dom.modalError.textContent = t('errNeedAisStreamKey');
    dom.modalError.style.display = 'block';
    return;
  }
  await postConfig({ provider, aisStreamKey, openWatersToken });
  dom.apiModal.classList.add('hidden');
});

async function postViewport(payload) {
  try {
    await fetch('/api/viewport', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('Viewport load failed:', err);
  }
}

async function postConfig(payload) {
  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (data.status) updateStatusUI(data.status);
  } catch (err) {
    console.error('Config update failed:', err);
  }
}

function updateStatusUI(status) {
  state.status = status;
  dom.statVessels.textContent = (status.vesselCount || 0).toLocaleString();
  dom.statRate.textContent = status.msgPerSec || 0;

  const providerLabel =
    status.provider === 'aisstream'
      ? 'LIVE AISSTREAM'
      : status.provider === 'digitraffic'
        ? 'LIVE DIGITRAFFIC'
        : 'LIVE OPENWATERS';

  dom.statusDot.classList.remove('sim', 'error');
  const cooldownMs = status.rateLimit?.cooldownRemainingMs || 0;
  if (cooldownMs > 0) {
    dom.statusDot.classList.add('sim');
    dom.statusMode.textContent = t('statusRateWait', { secs: Math.ceil(cooldownMs / 1000) });
  } else if (status.connectionState === 'connected') {
    dom.statusMode.textContent = providerLabel;
  } else if (status.connectionState === 'error') {
    dom.statusDot.classList.add('error');
    dom.statusMode.textContent = t('statusFeedError');
  } else {
    dom.statusDot.classList.add('sim');
    dom.statusMode.textContent = t('statusConnectingServer');
  }
}

function ingestVessels(vessels, replaceAll = false) {
  if (replaceAll) state.vesselsMap.clear();
  for (const v of vessels) state.vesselsMap.set(v.mmsi, v);
  state.dirtyUi = true;
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', (e) => {
    const data = JSON.parse(e.data);
    if (data.status) updateStatusUI(data.status);
    ingestVessels(data.vessels || [], true);
    state.allVessels = Array.from(state.vesselsMap.values());
    applyFiltersAndRender();
  });
  es.addEventListener('delta', (e) => {
    const data = JSON.parse(e.data);
    ingestVessels(data.vessels || [], false);
  });
  es.addEventListener('status', (e) => {
    updateStatusUI(JSON.parse(e.data));
  });
  es.onerror = () => {
    dom.statusDot.classList.add('error');
    dom.statusMode.textContent = t('statusReconnecting');
  };
}

setInterval(() => {
  dom.utcClock.textContent = new Date().toISOString().slice(11, 19);
  checkFavoriteAlerts(state.vesselsMap, state.favorites);
  if (state.dirtyUi) {
    state.dirtyUi = false;
    state.allVessels = Array.from(state.vesselsMap.values());
    applyFiltersAndRender();
  }
}, 2000);

async function loadVosShips() {
  try {
    const res = await fetch('/api/vos');
    if (!res.ok) return;
    const data = await res.json();
    if (Array.isArray(data?.ships) && data.ships.length > 0) {
      state.vosShips = data.ships;
      globe.setVosShips(data.ships);
      updateVosButtonLabel();
    }
  } catch {
    // non-fatal: AIS continues normally if NOAA NDBC is temporarily unreachable
  }
}

setInterval(() => {
  loadVosShips().catch(() => {});
}, 15 * 60 * 1000);

registerAppServiceWorker('/sw.js');
renderPresets();
connectStream();
loadVosShips();
