/**
 * MarineGlobe 3D — 100% Live Browser-Native AIS Controller (GitHub Pages).
 * Zero simulation data. Connects directly to:
 *  - Open Waters AIS (/v1/vessels global multi-zone bootstrap + wss://ais.openwaters.io/v1/stream + /v1/vessels/{mmsi} & /track)
 *  - Fintraffic Digitraffic Marine Open API (automatic fallback or direct selection)
 *  - Optional user-deployed MarineGlobe Node.js SSE backend (for AISStream.io)
 */

import { GlobeEngine } from './globe-engine.js';
import { VESSEL_TYPES } from './world-data.js';
import { LIVE_ZONES, buildBboxAround } from './live-zones.js';
import {
  parseOpenWatersEvent,
  parseOpenWatersFeature,
  parseOpenWatersTrack,
  parseDigitrafficData,
} from './ais-parser.js';
import {
  formatCoordShort,
  sortVessels,
  renderHoverTooltipHtml,
  renderFleetSummaryHtml,
  renderAllVesselListHtml,
  renderInspectorBodyHtml,
  renderFleetTableRowsHtml,
  exportVesselsCsv,
} from './telemetry-ui.js';

const MAX_VESSELS = 5000;

const state = {
  provider: 'openwaters', // 'openwaters' | 'digitraffic' | 'remote-sse'
  openWatersToken: '',
  backendUrl: '',
  activeZoneId: 'north-sea',
  activeBbox: LIVE_ZONES.find((z) => z.id === 'north-sea').bbox,
  connectionState: 'connecting',
  lastError: null,
  ws: null,
  eventSource: null,
  pollTimer: null,
  reconnectTimer: null,
  msgCounter: 0,
  msgPerSec: 0,
  vesselsMap: new Map(),
  allVessels: [],
  filteredVessels: [],
  selectedMmsi: null,
  loadingDetailsMmsi: null,
  followSelected: false,
  activeType: 'all',
  searchQuery: '',
  sortBy: 'recent-desc',
  theme: 'dark',
  fleetModalOpen: false,
  dirtyUi: false,
};

const dom = {
  canvas: document.getElementById('globe-canvas'),
  presetBar: document.getElementById('preset-bar'),
  sidebar: document.getElementById('sidebar'),
  btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
  searchInput: document.getElementById('search-input'),
  filterGrid: document.getElementById('filter-grid'),
  fleetSummary: document.getElementById('fleet-summary'),
  filteredCount: document.getElementById('filtered-count'),
  sortSelect: document.getElementById('sort-select'),
  utcClock: document.getElementById('utc-clock'),
  vesselList: document.getElementById('vessel-list'),
  statusDot: document.getElementById('status-dot'),
  statusMode: document.getElementById('status-mode'),
  statVessels: document.getElementById('stat-vessels'),
  statRate: document.getElementById('stat-rate'),
  inspector: document.getElementById('inspector'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnScanView: document.getElementById('btn-scan-view'),
  btnRefreshLive: document.getElementById('btn-refresh-live'),
  btnAutoRotate: document.getElementById('btn-autorotate'),
  btnDayNight: document.getElementById('btn-daynight'),
  btnLanes: document.getElementById('btn-lanes'),
  btnWakes: document.getElementById('btn-wakes'),
  btnPorts: document.getElementById('btn-ports'),
  btnLabels: document.getElementById('btn-labels'),
  coordReadout: document.getElementById('coord-readout'),
  hoverTooltip: document.getElementById('hover-tooltip'),
  btnTheme: document.getElementById('btn-theme'),
  btnFleetTable: document.getElementById('btn-fleet-table'),
  fleetModal: document.getElementById('fleet-modal'),
  fleetModalSub: document.getElementById('fleet-modal-sub'),
  fleetTableBody: document.getElementById('fleet-table-body'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnCloseFleetModal: document.getElementById('btn-close-fleet-modal'),
  btnApiConfig: document.getElementById('btn-api-config'),
  apiModal: document.getElementById('api-modal'),
  providerSelect: document.getElementById('provider-select'),
  openWatersTokenInput: document.getElementById('openwaters-token'),
  backendUrlInput: document.getElementById('backend-url'),
  modalError: document.getElementById('modal-error'),
  btnCancelModal: document.getElementById('btn-cancel-modal'),
  btnSaveApi: document.getElementById('btn-save-api'),
};

const globe = new GlobeEngine(dom.canvas, {
  initialLat: 51.6,
  initialLon: 10.0,
  initialZoom: 1.5,
  theme: state.theme,
  onSelectVessel: (vessel) => selectVessel(vessel.mmsi, true),
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
  onCameraChange: ({ lat, lon, zoom }) => {
    dom.coordReadout.textContent = `LAT ${formatCoordShort(lat, true)} · LON ${formatCoordShort(lon, false)} · ${zoom.toFixed(1)}x`;
  },
});
globe.setOption('showLanes', false);

function updateStatusBadge() {
  dom.statVessels.textContent = state.vesselsMap.size;
  dom.statRate.textContent = state.msgPerSec;

  const label =
    state.provider === 'digitraffic'
      ? 'LIVE DIGITRAFFIC'
      : state.provider === 'remote-sse'
        ? 'LIVE BACKEND'
        : 'LIVE OPENWATERS';

  dom.statusDot.classList.remove('sim', 'error');
  if (state.connectionState === 'connected') {
    dom.statusMode.textContent = label;
  } else if (state.connectionState === 'error') {
    dom.statusDot.classList.add('error');
    dom.statusMode.textContent = '피드 오류';
  } else {
    dom.statusDot.classList.add('sim');
    dom.statusMode.textContent = '수신 연결 중...';
  }
}

function upsertVessel(v) {
  if (!v || v.lat === null || v.lon === null) return;
  state.vesselsMap.set(v.mmsi, v);
  state.msgCounter++;
  state.dirtyUi = true;
  if (state.vesselsMap.size > MAX_VESSELS) {
    const oldest = state.vesselsMap.keys().next().value;
    if (oldest) state.vesselsMap.delete(oldest);
  }
}

function disconnectAll() {
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  if (state.pollTimer) {
    clearInterval(state.pollTimer);
    state.pollTimer = null;
  }
  if (state.ws) {
    const old = state.ws;
    state.ws = null;
    try {
      old.close();
    } catch {
      // ignore
    }
  }
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

// --- Open Waters Live REST & WebSocket ---
async function fetchOpenWatersBbox(bbox) {
  const [minLat, minLon, maxLat, maxLon] = bbox;
  const params = new URLSearchParams({
    bbox: `${minLat},${minLon},${maxLat},${maxLon}`,
    max_age: '30m',
    kind: 'vessel',
  });
  if (state.openWatersToken) params.set('key', state.openWatersToken);

  const res = await fetch(`https://ais.openwaters.io/v1/vessels?${params}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Open Waters HTTP ${res.status}`);
  const geo = await res.json();
  const features = Array.isArray(geo.features) ? geo.features : [];
  let loaded = 0;
  for (const f of features) {
    const existing = state.vesselsMap.get(String(f.properties?.mmsi || f.id || ''));
    const parsed = parseOpenWatersFeature(f, existing);
    if (parsed) {
      upsertVessel(parsed);
      loaded++;
    }
  }
  return loaded;
}

function connectOpenWatersWs(bbox) {
  if (state.ws) {
    const old = state.ws;
    state.ws = null;
    try { old.close(); } catch { /* ignore */ }
  }
  const url = state.openWatersToken
    ? `wss://ais.openwaters.io/v1/stream?key=${encodeURIComponent(state.openWatersToken)}`
    : 'wss://ais.openwaters.io/v1/stream';

  try {
    const ws = new WebSocket(url);
    state.ws = ws;

    ws.addEventListener('open', () => {
      if (state.ws !== ws) return;
      state.connectionState = 'connected';
      state.lastError = null;
      ws.send(JSON.stringify({ type: 'subscribe', bbox: [bbox], snapshot: true }));
      updateStatusBadge();
    });

    ws.addEventListener('message', (evt) => {
      if (state.ws !== ws) return;
      try {
        const data = JSON.parse(evt.data);
        if (data.type === 'error') {
          state.lastError = String(data.error || '구독 오류');
          updateStatusBadge();
          return;
        }
        if (data.type === 'event') {
          const existing = state.vesselsMap.get(String(data.mmsi || ''));
          const parsed = parseOpenWatersEvent(data, existing);
          if (parsed) upsertVessel(parsed);
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.addEventListener('error', () => {
      if (state.ws !== ws) return;
      state.lastError = 'Open Waters WebSocket 연결 오류';
      if (state.vesselsMap.size === 0) state.connectionState = 'error';
      updateStatusBadge();
    });

    ws.addEventListener('close', () => {
      if (state.ws !== ws) return;
      state.ws = null;
      if (state.provider === 'openwaters') {
        state.reconnectTimer = setTimeout(() => {
          if (state.provider === 'openwaters') connectOpenWatersWs(state.activeBbox);
        }, 5000);
      }
    });
  } catch (err) {
    state.lastError = err.message;
    state.connectionState = 'error';
    updateStatusBadge();
  }
}

async function startOpenWaters() {
  disconnectAll();
  state.provider = 'openwaters';
  state.connectionState = 'connecting';
  state.lastError = null;
  updateStatusBadge();

  let totalLoaded = 0;
  try {
    const results = await Promise.allSettled(
      LIVE_ZONES.map((z) => fetchOpenWatersBbox(z.bbox))
    );
    for (const r of results) {
      if (r.status === 'fulfilled') totalLoaded += r.value;
    }
    if (totalLoaded > 0) {
      state.connectionState = 'connected';
      syncFromMap();
      connectOpenWatersWs(state.activeBbox);
    } else {
      // Automatic fallback to live official Fintraffic Digitraffic REST API
      await startDigitraffic();
    }
  } catch (err) {
    state.lastError = err.message;
    await startDigitraffic();
  }
}

// --- Fintraffic Digitraffic Official Live REST Feed ---
async function pollDigitraffic() {
  const [locRes, metaRes] = await Promise.all([
    fetch('https://meri.digitraffic.fi/api/ais/v1/locations', { headers: { Accept: 'application/json' } }),
    fetch('https://meri.digitraffic.fi/api/ais/v1/vessels', { headers: { Accept: 'application/json' } }),
  ]);
  if (!locRes.ok) throw new Error(`Digitraffic HTTP ${locRes.status}`);
  const locJson = await locRes.json();
  const metaJson = metaRes.ok ? await metaRes.json() : [];
  const vessels = parseDigitrafficData(locJson, metaJson);
  for (const v of vessels) {
    const prev = state.vesselsMap.get(v.mmsi);
    if (prev && prev.trail.length > 0) {
      const last = prev.trail[prev.trail.length - 1];
      v.trail =
        Math.abs(last[0] - v.lat) + Math.abs(last[1] - v.lon) > 0.002
          ? [...prev.trail.slice(-39), [v.lat, v.lon]]
          : prev.trail;
    }
    upsertVessel(v);
  }
  state.connectionState = 'connected';
  state.lastError = null;
  syncFromMap();
}

async function startDigitraffic() {
  disconnectAll();
  state.provider = 'digitraffic';
  state.connectionState = 'connecting';
  state.lastError = null;
  updateStatusBadge();

  try {
    await pollDigitraffic();
    state.pollTimer = setInterval(() => {
      pollDigitraffic().catch((err) => {
        state.lastError = err.message;
        state.connectionState = 'error';
        updateStatusBadge();
      });
    }, 30000);
  } catch (err) {
    state.lastError = `실시간 AIS 수신 실패: ${err.message}`;
    state.connectionState = 'error';
    updateStatusBadge();
    syncFromMap();
  }
}

// --- Optional Custom MarineGlobe Node.js SSE Backend ---
function startRemoteBackend(baseUrl) {
  disconnectAll();
  state.provider = 'remote-sse';
  state.backendUrl = baseUrl;
  state.connectionState = 'connecting';
  state.lastError = null;
  state.vesselsMap.clear();
  updateStatusBadge();

  const es = new EventSource(`${baseUrl}/api/stream`);
  state.eventSource = es;

  es.addEventListener('snapshot', (e) => {
    const data = JSON.parse(e.data);
    state.vesselsMap.clear();
    for (const v of data.vessels || []) upsertVessel(v);
    state.connectionState = 'connected';
    syncFromMap();
  });
  es.addEventListener('delta', (e) => {
    const data = JSON.parse(e.data);
    for (const v of data.vessels || []) upsertVessel(v);
  });
  es.addEventListener('status', (e) => {
    const st = JSON.parse(e.data);
    state.connectionState = st.connectionState || 'connected';
    state.msgPerSec = st.msgPerSec ?? state.msgPerSec;
    updateStatusBadge();
  });
  es.onerror = () => {
    state.connectionState = 'error';
    state.lastError = '커스텀 백엔드 SSE 연결 끊김 (재연결 시도 중)';
    updateStatusBadge();
  };
}

// --- UI Rendering & Interactions ---
function renderPresets() {
  dom.presetBar.innerHTML = LIVE_ZONES.slice(0, 7)
    .map((z) => `<button class="btn" data-zone="${z.id}">${z.label}</button>`)
    .join('');

  dom.presetBar.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-zone]');
    if (!btn) return;
    const zone = LIVE_ZONES.find((z) => z.id === btn.dataset.zone);
    if (!zone) return;
    state.activeZoneId = zone.id;
    state.activeBbox = zone.bbox;
    state.followSelected = false;
    globe.setSelectedVessel(state.selectedMmsi, false);
    globe.flyTo(zone.center.lat, zone.center.lon, zone.center.zoom, 800);

    if (state.provider === 'openwaters') {
      try {
        await fetchOpenWatersBbox(zone.bbox);
        syncFromMap();
      } catch {
        // ignore single zone fetch error
      }
      connectOpenWatersWs(zone.bbox);
    }
  });
}

function renderFilterChips() {
  const counts = { all: state.allVessels.length };
  for (const key of Object.keys(VESSEL_TYPES)) counts[key] = 0;
  for (const v of state.allVessels) {
    if (counts[v.type] !== undefined) counts[v.type]++;
  }

  let html = `<button class="filter-chip ${state.activeType === 'all' ? 'active' : ''}" data-type="all">전체 <span class="mono">${counts.all}</span></button>`;
  for (const [key, meta] of Object.entries(VESSEL_TYPES)) {
    html += `
      <button class="filter-chip ${state.activeType === key ? 'active' : ''}" data-type="${key}">
        <span class="type-dot" style="background:${meta.color}"></span>
        ${meta.short} <span class="mono">${counts[key]}</span>
      </button>
    `;
  }
  dom.filterGrid.innerHTML = html;
}

function syncFromMap() {
  state.allVessels = Array.from(state.vesselsMap.values());
  applyFiltersAndRender();
}

function applyFiltersAndRender() {
  const q = state.searchQuery;
  const matched = state.allVessels.filter((v) => {
    if (state.activeType !== 'all' && v.type !== state.activeType) return false;
    if (!q) return true;
    return (
      v.name.toLowerCase().includes(q) ||
      v.mmsi.includes(q) ||
      (v.imo && v.imo.includes(q)) ||
      (v.callsign && v.callsign.toLowerCase().includes(q)) ||
      (v.destination && v.destination.toLowerCase().includes(q)) ||
      (v.flagName && v.flagName.toLowerCase().includes(q)) ||
      (v.source && v.source.toLowerCase().includes(q))
    );
  });

  state.filteredVessels = sortVessels(matched, state.sortBy);
  globe.setVessels(state.filteredVessels);

  updateStatusBadge();
  dom.btnFleetTable.textContent = `전체 선박 표 (${state.filteredVessels.length})`;
  dom.fleetSummary.innerHTML = renderFleetSummaryHtml(state.filteredVessels);
  dom.filteredCount.textContent = `실시간 수신: ${state.filteredVessels.length}척`;

  const emptyMsg = state.lastError
    ? `실시간 수신 오류: ${state.lastError}`
    : state.allVessels.length === 0
      ? '전 세계 실시간 AIS 선박 데이터를 수신하고 있습니다...'
      : '검색 조건과 일치하는 실시간 선박이 없습니다.';

  renderFilterChips();
  dom.vesselList.innerHTML = renderAllVesselListHtml(
    state.filteredVessels,
    state.selectedMmsi,
    emptyMsg
  );
  renderInspector();
  if (state.fleetModalOpen) renderFleetTable();
}

dom.filterGrid.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-type]');
  if (chip) {
    state.activeType = chip.dataset.type;
    applyFiltersAndRender();
  }
});
dom.searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value.trim().toLowerCase();
  applyFiltersAndRender();
});
dom.sortSelect.addEventListener('change', (e) => {
  state.sortBy = e.target.value;
  applyFiltersAndRender();
});
dom.vesselList.addEventListener('click', (e) => {
  const item = e.target.closest('[data-mmsi]');
  if (item) selectVessel(item.dataset.mmsi, true);
});

async function selectVessel(mmsi, fly = false) {
  state.selectedMmsi = mmsi;
  const v = state.vesselsMap.get(mmsi);
  if (!v) return;

  globe.setSelectedVessel(mmsi, state.followSelected);
  if (fly) globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 3.2), 700);
  state.loadingDetailsMmsi = mmsi;
  dom.vesselList.innerHTML = renderAllVesselListHtml(state.filteredVessels, state.selectedMmsi);
  renderInspector();

  // Live vessel enrichment & real 24h AIS track from Open Waters API
  try {
    const q = state.openWatersToken ? `?key=${encodeURIComponent(state.openWatersToken)}` : '';
    const [detailRes, trackRes] = await Promise.allSettled([
      fetch(`https://ais.openwaters.io/v1/vessels/${encodeURIComponent(mmsi)}${q}`),
      fetch(`https://ais.openwaters.io/v1/vessels/${encodeURIComponent(mmsi)}/track${q}`),
    ]);

    let updated = state.vesselsMap.get(mmsi) || v;
    if (detailRes.status === 'fulfilled' && detailRes.value.ok) {
      const feature = await detailRes.value.json();
      const parsed = parseOpenWatersFeature(feature, updated);
      if (parsed) updated = parsed;
    }
    if (trackRes.status === 'fulfilled' && trackRes.value.ok) {
      const trackGeo = await trackRes.value.json();
      const pts = parseOpenWatersTrack(trackGeo);
      if (pts.length > 0) updated = { ...updated, trail: pts.slice(-120) };
    }
    state.vesselsMap.set(updated.mmsi, updated);
  } catch {
    // preserve live vessel data
  } finally {
    if (state.loadingDetailsMmsi === mmsi) state.loadingDetailsMmsi = null;
    syncFromMap();
  }
}

function renderInspector() {
  if (!state.selectedMmsi) {
    dom.inspector.classList.add('hidden');
    return;
  }
  const v = state.vesselsMap.get(state.selectedMmsi);
  if (!v) {
    dom.inspector.classList.add('hidden');
    return;
  }
  const prevScroll = dom.inspector.scrollTop;
  dom.inspector.classList.remove('hidden');
  dom.inspector.innerHTML = renderInspectorBodyHtml(
    v,
    state.followSelected,
    state.loadingDetailsMmsi === v.mmsi
  );
  dom.inspector.scrollTop = prevScroll;
}

dom.inspector.addEventListener('click', (e) => {
  if (e.target.closest('#btn-close-inspector')) {
    state.selectedMmsi = null;
    state.followSelected = false;
    globe.setSelectedVessel(null, false);
    dom.inspector.classList.add('hidden');
    dom.vesselList.innerHTML = renderAllVesselListHtml(state.filteredVessels, null);
    return;
  }
  if (e.target.closest('#btn-follow-vessel')) {
    if (!state.selectedMmsi) return;
    state.followSelected = !state.followSelected;
    globe.setSelectedVessel(state.selectedMmsi, state.followSelected);
    renderInspector();
    return;
  }
  if (e.target.closest('#btn-center-vessel')) {
    const v = state.vesselsMap.get(state.selectedMmsi);
    if (v) globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 3.8), 600);
  }
});

// Fleet Table Modal
function renderFleetTable() {
  dom.fleetModalSub.textContent = `실시간 수신 선박 총 ${state.filteredVessels.length}척 전체 표시 중 · 행 클릭 시 3D 지구본 이동 및 24시간 실제 항적 조회`;
  dom.fleetTableBody.innerHTML = renderFleetTableRowsHtml(state.filteredVessels, state.selectedMmsi);
}
dom.btnFleetTable.addEventListener('click', () => {
  state.fleetModalOpen = true;
  renderFleetTable();
  dom.fleetModal.classList.remove('hidden');
});
dom.btnCloseFleetModal.addEventListener('click', () => {
  state.fleetModalOpen = false;
  dom.fleetModal.classList.add('hidden');
});
dom.btnExportCsv.addEventListener('click', () => exportVesselsCsv(state.filteredVessels));
dom.fleetTableBody.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-mmsi]');
  if (!row) return;
  state.fleetModalOpen = false;
  dom.fleetModal.classList.add('hidden');
  selectVessel(row.dataset.mmsi, true);
});

// Live Viewport Scan & Refresh
dom.btnScanView.addEventListener('click', async () => {
  const maxArea = state.openWatersToken ? 360 : 90;
  const bbox = buildBboxAround(globe.centerLat, globe.centerLon, maxArea);
  state.activeZoneId = 'custom';
  state.activeBbox = bbox;
  if (state.provider === 'openwaters') {
    dom.btnScanView.textContent = '수신 중...';
    try {
      await fetchOpenWatersBbox(bbox);
      syncFromMap();
      connectOpenWatersWs(bbox);
    } catch (err) {
      state.lastError = err.message;
      updateStatusBadge();
    } finally {
      dom.btnScanView.textContent = '현재 화면 수신';
    }
  } else if (state.provider === 'digitraffic') {
    await pollDigitraffic().catch(() => {});
  }
});

dom.btnRefreshLive.addEventListener('click', () => {
  if (state.provider === 'digitraffic') startDigitraffic();
  else if (state.provider === 'remote-sse' && state.backendUrl) startRemoteBackend(state.backendUrl);
  else startOpenWaters();
});

// Layer Toggles
dom.btnToggleSidebar.addEventListener('click', () => dom.sidebar.classList.toggle('collapsed'));
dom.btnZoomIn.addEventListener('click', () => globe.zoomBy(1.35));
dom.btnZoomOut.addEventListener('click', () => globe.zoomBy(0.74));

function bindToggle(btn, optKey) {
  btn.addEventListener('click', () => {
    const next = !globe.options[optKey];
    globe.setOption(optKey, next);
    btn.classList.toggle('active', next);
  });
}
bindToggle(dom.btnAutoRotate, 'autoRotate');
bindToggle(dom.btnDayNight, 'showDayNight');
bindToggle(dom.btnLanes, 'showLanes');
bindToggle(dom.btnWakes, 'showWakes');
bindToggle(dom.btnPorts, 'showPorts');
bindToggle(dom.btnLabels, 'showLabels');

dom.btnTheme.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('theme-light', state.theme === 'light');
  dom.btnTheme.textContent = state.theme === 'dark' ? '☀' : '☾';
  globe.setTheme(state.theme);
});

// Feed Settings Modal
dom.btnApiConfig.addEventListener('click', () => {
  dom.modalError.style.display = 'none';
  dom.providerSelect.value = state.provider;
  dom.openWatersTokenInput.value = state.openWatersToken;
  dom.backendUrlInput.value = state.backendUrl;
  dom.apiModal.classList.remove('hidden');
});
dom.btnCancelModal.addEventListener('click', () => dom.apiModal.classList.add('hidden'));
dom.btnSaveApi.addEventListener('click', () => {
  const nextProvider = dom.providerSelect.value;
  state.openWatersToken = dom.openWatersTokenInput.value.trim();
  const url = dom.backendUrlInput.value.trim().replace(/\/+$/, '');

  if (nextProvider === 'remote-sse') {
    if (!url || !/^https?:\/\//.test(url)) {
      dom.modalError.textContent = '올바른 http:// 또는 https:// 백엔드 URL을 입력하세요.';
      dom.modalError.style.display = 'block';
      return;
    }
    dom.apiModal.classList.add('hidden');
    startRemoteBackend(url);
    return;
  }

  dom.apiModal.classList.add('hidden');
  state.vesselsMap.clear();
  if (nextProvider === 'digitraffic') startDigitraffic();
  else startOpenWaters();
});

// Periodic throttled UI flush (1s) for high-frequency WebSocket updates + msg/s counter
setInterval(() => {
  state.msgPerSec = state.msgCounter;
  state.msgCounter = 0;
  dom.utcClock.textContent = new Date().toISOString().slice(11, 19);
  if (state.dirtyUi) {
    state.dirtyUi = false;
    syncFromMap();
  } else {
    updateStatusBadge();
  }
}, 1000);

renderPresets();
startOpenWaters();
