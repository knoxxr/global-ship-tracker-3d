/**
 * MarineGlobe 3D — 100% Live Browser-Native AIS Controller (GitHub Pages).
 * Streams 20,000+ real vessels across 16 global maritime zones with zero simulation:
 *  - Open Waters AIS (REST multi-zone bootstrap + live WebSocket + on-demand 24h tracks)
 *  - Fintraffic Digitraffic Marine Open API (automatic fallback or direct selection)
 *  - Optional custom MarineGlobe Node.js SSE backend (AISStream.io)
 * Uses virtualized list/table rendering so 20,000+ live vessels run smoothly at 60 FPS.
 */

import { GlobeEngine } from './globe-engine.js?v=8';
import { VESSEL_TYPES } from './world-data.js';
import { LIVE_ZONES, buildBboxAround } from './live-zones.js';
import { decodeMvtPoints } from './mvt-decoder.js';
import {
  parseOpenWatersEvent,
  parseOpenWatersFeature,
  parseOpenWatersTilePoint,
  parseOpenWatersTrack,
  parseDigitrafficData,
} from './ais-parser.js?v=2';
import {
  formatCoordShort,
  sortVessels,
  sortVesselsByColumn,
  renderHoverTooltipHtml,
  renderClusterTooltipHtml,
  renderFleetSummaryHtml,
  renderVirtualVesselList,
  renderInspectorBodyHtml,
  renderVirtualFleetTable,
  exportVesselsCsv,
} from './telemetry-ui.js?v=3';

const MAX_VESSELS = 60000;
const TRACK_CACHE_MS = 10 * 60 * 1000;
const STALE_VESSEL_MS = 6 * 60 * 60 * 1000; // Evict vessels unseen for >6h (keeps tab fresh)
const PREFS_KEY = 'marineglobe_prefs_v1';

function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function parseHashDeepLink() {
  try {
    const raw = (window.location.hash || '').replace(/^#/, '');
    if (!raw) return {};
    const p = new URLSearchParams(raw);
    const lat = Number(p.get('lat'));
    const lon = Number(p.get('lon'));
    const z = Number(p.get('z'));
    const mmsi = (p.get('mmsi') || '').trim();
    return {
      lat: Number.isFinite(lat) && lat >= -85 && lat <= 85 ? lat : null,
      lon: Number.isFinite(lon) && lon >= -180 && lon <= 180 ? lon : null,
      zoom: Number.isFinite(z) && z >= 0.85 && z <= 1500 ? z : null,
      mmsi: /^\d{5,12}$/.test(mmsi) ? mmsi : null,
    };
  } catch {
    return {};
  }
}

const savedPrefs = loadPrefs();
const deepLink = parseHashDeepLink();

async function runPool(items, concurrency, fn) {
  let idx = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (idx < items.length) {
        const cur = items[idx++];
        try {
          await fn(cur);
        } catch {
          // isolate single tile/hub error
        }
      }
    })
  );
}

const state = {
  provider: 'openwaters',
  openWatersToken: typeof savedPrefs.openWatersToken === 'string' ? savedPrefs.openWatersToken : '',
  backendUrl: typeof savedPrefs.backendUrl === 'string' ? savedPrefs.backendUrl : '',
  activeZoneId: 'korea-strait',
  activeBbox: LIVE_ZONES[0].bbox,
  wsSubCenter: { lat: 35.1, lon: 129.0 },
  lastAutoWsAt: 0,
  connectionState: 'connecting',
  lastError: null,
  loadedSteps: 0,
  totalSteps: 64 + LIVE_ZONES.length,
  ws: null,
  eventSource: null,
  pollTimer: null,
  reconnectTimer: null,
  msgCounter: 0,
  msgPerSec: 0,
  vesselsMap: new Map(),
  trackFetchedAt: new Map(),
  loadingTracks: false,
  allVessels: [],
  filteredVessels: [],
  tableVessels: [],
  selectedMmsi: null,
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
  fleetModalOpen: false,
  dirtyUi: false,
};

const dom = {
  canvas: document.getElementById('globe-canvas'),
  presetBar: document.getElementById('preset-bar'),
  sidebar: document.getElementById('sidebar'),
  btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
  btnCloseSidebar: document.getElementById('btn-close-sidebar'),
  mobileBackdrop: document.getElementById('mobile-backdrop'),
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
  btnLoadTracks: document.getElementById('btn-load-tracks'),
  btnRefreshLive: document.getElementById('btn-refresh-live'),
  btnClusters: document.getElementById('btn-clusters'),
  btnMovingOnly: document.getElementById('btn-moving-only'),
  btnBorders: document.getElementById('btn-borders'),
  btnAutoRotate: document.getElementById('btn-autorotate'),
  btnDayNight: document.getElementById('btn-daynight'),
  btnWakes: document.getElementById('btn-wakes'),
  btnPorts: document.getElementById('btn-ports'),
  btnLabels: document.getElementById('btn-labels'),
  coordReadout: document.getElementById('coord-readout'),
  hoverTooltip: document.getElementById('hover-tooltip'),
  toastNotice: document.getElementById('toast-notice'),
  btnTheme: document.getElementById('btn-theme'),
  btnFleetTable: document.getElementById('btn-fleet-table'),
  fleetModal: document.getElementById('fleet-modal'),
  fleetModalSub: document.getElementById('fleet-modal-sub'),
  fleetModalSearch: document.getElementById('fleet-modal-search'),
  fleetTableHead: document.getElementById('fleet-table-head'),
  fleetTableWrap: document.getElementById('fleet-table-wrap'),
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

let toastTimer = null;
function showToast(msg) {
  if (!dom.toastNotice) return;
  dom.toastNotice.textContent = msg;
  dom.toastNotice.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => dom.toastNotice.classList.add('hidden'), 2200);
}

let autoTrackTimer = null;
let autoWsTimer = null;
let lastAutoTrackKey = '';

const globe = new GlobeEngine(dom.canvas, {
  initialLat: deepLink.lat ?? 28,
  initialLon: deepLink.lon ?? 124,
  initialZoom: deepLink.zoom ?? (window.innerWidth <= 768 ? 1.02 : 1.4),
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
    if (zoom >= 2.8 && globe.options.showWakes) {
      const g = 2 / Math.max(1, zoom / 3);
      const key = `${Math.round(lat / g)}:${Math.round(lon / g)}:${Math.round(Math.log2(zoom) * 2)}`;
      if (key !== lastAutoTrackKey) {
        lastAutoTrackKey = key;
        clearTimeout(autoTrackTimer);
        autoTrackTimer = setTimeout(() => {
          loadVisibleTracks(18).catch(() => {});
        }, 900);
      }
    }
    // Debounced auto-resubscribe Open Waters live WebSocket when user explores a new area
    if (state.provider === 'openwaters' && zoom >= 2.6) {
      const distDeg = Math.hypot(lat - state.wsSubCenter.lat, lon - state.wsSubCenter.lon);
      if (distDeg >= 2.0) {
        clearTimeout(autoWsTimer);
        autoWsTimer = setTimeout(() => {
          const now = Date.now();
          if (state.provider !== 'openwaters' || now - state.lastAutoWsAt < 6000) return;
          const curDist = Math.hypot(globe.centerLat - state.wsSubCenter.lat, globe.centerLon - state.wsSubCenter.lon);
          if (curDist < 2.0) return;
          state.lastAutoWsAt = now;
          state.wsSubCenter = { lat: globe.centerLat, lon: globe.centerLon };
          const maxArea = state.openWatersToken ? 360 : 90;
          state.activeBbox = buildBboxAround(globe.centerLat, globe.centerLon, maxArea);
          connectOpenWatersWs(state.activeBbox);
        }, 2500);
      }
    }
  },
});
globe.setOption('showLanes', false);

function savePrefs() {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        theme: state.theme,
        movingOnly: state.movingOnly,
        sortBy: state.sortBy,
        favorites: Array.from(state.favorites),
        openWatersToken: state.openWatersToken,
        backendUrl: state.backendUrl,
        layers: {
          showClusters: globe.options.showClusters,
          showBorders: globe.options.showBorders,
          autoRotate: globe.options.autoRotate,
          showDayNight: globe.options.showDayNight,
          showWakes: globe.options.showWakes,
          showPorts: globe.options.showPorts,
          showLabels: globe.options.showLabels,
        },
      })
    );
  } catch {
    // ignore private browsing quota errors
  }
}

function updateStatusBadge() {
  dom.statVessels.textContent = state.vesselsMap.size.toLocaleString();
  dom.statRate.textContent = state.msgPerSec;

  const label =
    state.provider === 'digitraffic'
      ? 'LIVE DIGITRAFFIC'
      : state.provider === 'remote-sse'
        ? 'LIVE BACKEND'
        : 'LIVE GLOBAL AIS';

  dom.statusDot.classList.remove('sim', 'error');
  if (state.connectionState === 'connected') {
    dom.statusMode.textContent =
      state.provider === 'openwaters' && state.loadedSteps < state.totalSteps
        ? `전역 수신 ${Math.round((state.loadedSteps / state.totalSteps) * 100)}%`
        : label;
  } else if (state.connectionState === 'error') {
    dom.statusDot.classList.add('error');
    dom.statusMode.textContent = '피드 오류';
  } else {
    dom.statusDot.classList.add('sim');
    dom.statusMode.textContent = '전역 연결 중...';
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
  if (state.reconnectTimer) { clearTimeout(state.reconnectTimer); state.reconnectTimer = null; }
  if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  if (state.ws) {
    const old = state.ws;
    state.ws = null;
    try { old.close(); } catch { /* ignore */ }
  }
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
}

// --- Open Waters Global MVT Vector Tiles + Un-thinned REST Hubs + Live WebSocket ---
async function fetchOpenWatersBbox(bbox) {
  const [minLat, minLon, maxLat, maxLon] = bbox;
  const params = new URLSearchParams({
    bbox: `${minLat},${minLon},${maxLat},${maxLon}`,
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

async function fetchOpenWatersTile(z, x, y) {
  const params = new URLSearchParams({ kind: 'vessel' });
  if (state.openWatersToken) params.set('key', state.openWatersToken);
  const res = await fetch(`https://ais.openwaters.io/v1/vessels/tiles/${z}/${x}/${y}?${params}`);
  if (res.status !== 200) return 0;
  const pts = decodeMvtPoints(await res.arrayBuffer(), z, x, y);
  let loaded = 0;
  for (const pt of pts) {
    const existing = state.vesselsMap.get(String(pt.properties?.mmsi || pt.id || ''));
    const parsed = parseOpenWatersTilePoint(pt, existing);
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
  state.loadedSteps = 0;
  state.totalSteps = 64 + LIVE_ZONES.length;
  updateStatusBadge();

  // Start live WebSocket stream immediately
  connectOpenWatersWs(state.activeBbox);

  let totalLoaded = 0;

  // Phase 1: Instant East Asia + Singapore un-thinned hubs (< 0.8s)
  const priorityZones = LIVE_ZONES.slice(0, 4);
  const restZones = LIVE_ZONES.slice(4);
  await runPool(priorityZones, 4, async (z) => {
    totalLoaded += await fetchOpenWatersBbox(z.bbox);
    state.loadedSteps++;
    if (totalLoaded > 0) state.connectionState = 'connected';
  });
  syncFromMap();

  // Phase 2: Full-planet z=3 MVT vector tiles (64 tiles covering EVERY ocean & coastline!)
  const z3Tiles = [];
  for (let x = 0; x < 8; x++) {
    for (let y = 0; y < 8; y++) z3Tiles.push([3, x, y]);
  }
  await runPool(z3Tiles, 6, async ([z, x, y]) => {
    totalLoaded += await fetchOpenWatersTile(z, x, y);
    state.loadedSteps++;
    if (state.loadedSteps % 12 === 0) syncFromMap();
  });
  syncFromMap();

  // Phase 3: Remaining 12 dense global hubs un-thinned (Europe, Americas, Middle East, Africa, Oceania)
  await runPool(restZones, 4, async (z) => {
    totalLoaded += await fetchOpenWatersBbox(z.bbox);
    state.loadedSteps++;
    if (state.loadedSteps % 3 === 0) syncFromMap();
  });

  if (totalLoaded === 0 && state.vesselsMap.size === 0) {
    await startDigitraffic();
  } else {
    state.connectionState = 'connected';
    state.loadedSteps = state.totalSteps;
    syncFromMap();
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
  const topZoneIds = [
    'korea-strait',
    'shanghai-taiwan',
    'singapore-malacca',
    'north-sea',
    'mediterranean',
    'us-east',
    'us-west',
    'sydney-au',
  ];
  const presets = topZoneIds
    .map((id) => LIVE_ZONES.find((z) => z.id === id))
    .filter(Boolean);

  dom.presetBar.innerHTML = presets
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
    state.wsSubCenter = { lat: zone.center.lat, lon: zone.center.lon };
    state.lastAutoWsAt = Date.now();
    dom.presetBar.querySelectorAll('[data-zone]').forEach((b) => {
      b.classList.toggle('active', b === btn);
    });
    btn.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
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
  const counts = { all: state.allVessels.length, favorites: 0 };
  for (const key of Object.keys(VESSEL_TYPES)) counts[key] = 0;
  for (const v of state.allVessels) {
    if (counts[v.type] !== undefined) counts[v.type]++;
    if (state.favorites.has(v.mmsi)) counts.favorites++;
  }

  let html = `<button class="filter-chip ${state.activeType === 'all' ? 'active' : ''}" data-type="all">전체 <span class="mono">${counts.all.toLocaleString()}</span></button>`;
  if (state.favorites.size > 0 || state.activeType === 'favorites') {
    html += `<button class="filter-chip ${state.activeType === 'favorites' ? 'active' : ''}" data-type="favorites"><span class="fav-star">★</span> 관심 <span class="mono">${counts.favorites.toLocaleString()}</span></button>`;
  }
  for (const [key, meta] of Object.entries(VESSEL_TYPES)) {
    html += `
      <button class="filter-chip ${state.activeType === key ? 'active' : ''}" data-type="${key}">
        <span class="type-dot" style="background:${meta.color}"></span>
        ${meta.short} <span class="mono">${counts[key].toLocaleString()}</span>
      </button>
    `;
  }
  dom.filterGrid.innerHTML = html;
}

function getEmptyMessage() {
  if (state.lastError && state.allVessels.length === 0) {
    return `실시간 수신 오류: ${state.lastError}`;
  }
  if (state.allVessels.length === 0) {
    return '전 세계 16개 주요 해역에서 실제 AIS 선박 데이터를 수신하고 있습니다...';
  }
  if (state.activeType === 'favorites') {
    return '현재 수신 중인 관심 선박이 없습니다. 선박 상세 패널에서 ☆를 눌러 등록하세요.';
  }
  return '검색 조건과 일치하는 실시간 선박이 없습니다.';
}

function renderVisibleList() {
  renderVirtualVesselList(
    dom.vesselList,
    state.filteredVessels,
    state.selectedMmsi,
    getEmptyMessage(),
    state.favorites
  );
}

function updateTableSortIndicators() {
  if (!dom.fleetTableHead) return;
  dom.fleetTableHead.querySelectorAll('th[data-sort-col]').forEach((th) => {
    const active = th.dataset.sortCol === state.tableSortCol;
    th.classList.toggle('sort-active', active);
    th.classList.toggle('sort-asc', active && state.tableSortDir === 'asc');
    th.classList.toggle('sort-desc', active && state.tableSortDir === 'desc');
  });
}

function getTableVessels() {
  const tq = state.tableSearchQuery;
  const base = tq
    ? state.filteredVessels.filter(
        (v) =>
          v.name.toLowerCase().includes(tq) ||
          v.mmsi.includes(tq) ||
          (v.imo && v.imo.includes(tq)) ||
          (v.callsign && v.callsign.toLowerCase().includes(tq)) ||
          (v.destination && v.destination.toLowerCase().includes(tq)) ||
          (v.flagName && v.flagName.toLowerCase().includes(tq))
      )
    : state.filteredVessels;
  return sortVesselsByColumn(base, state.tableSortCol, state.tableSortDir);
}

function renderFleetTable(recompute = true) {
  if (recompute) {
    state.tableVessels = getTableVessels();
    updateTableSortIndicators();
  }
  dom.fleetModalSub.textContent = `실시간 수신 선박 총 ${state.tableVessels.length.toLocaleString()}척 표시 중 · 헤더 클릭 정렬 · 행 클릭 시 3D 지구본 즉시 추적`;
  renderVirtualFleetTable(
    dom.fleetTableWrap,
    dom.fleetTableBody,
    state.tableVessels,
    state.selectedMmsi,
    state.favorites
  );
}

function syncFromMap() {
  state.allVessels = Array.from(state.vesselsMap.values());
  applyFiltersAndRender();
  if (state.pendingDeepLinkMmsi && state.vesselsMap.has(state.pendingDeepLinkMmsi)) {
    const mmsi = state.pendingDeepLinkMmsi;
    state.pendingDeepLinkMmsi = null;
    selectVessel(mmsi, true);
  }
}

function applyFiltersAndRender() {
  const q = state.searchQuery;
  const matched = state.allVessels.filter((v) => {
    if (state.movingOnly && (v.sog || 0) < 0.5) return false;
    if (state.activeType === 'favorites') {
      if (!state.favorites.has(v.mmsi)) return false;
    } else if (state.activeType !== 'all' && v.type !== state.activeType) {
      return false;
    }
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
  const countStr = state.filteredVessels.length.toLocaleString();
  dom.btnFleetTable.innerHTML = `<span class="label-desktop">전체 선박 표 (${countStr})</span><span class="label-mobile">선박표</span>`;
  dom.fleetSummary.innerHTML = renderFleetSummaryHtml(state.filteredVessels);
  dom.filteredCount.textContent = `실시간 수신: ${state.filteredVessels.length.toLocaleString()}척`;

  renderFilterChips();
  renderVisibleList();
  renderInspector();
  if (state.fleetModalOpen) renderFleetTable(true);
}

/**
 * Batch-load REAL historical 24h AIS tracks for moving vessels currently inside the 3D viewport.
 */
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
  if (dom.btnLoadTracks) dom.btnLoadTracks.textContent = `항적 수신 중 (0/${targets.length})`;
  let done = 0;
  const q = state.openWatersToken
    ? `?limit=60&key=${encodeURIComponent(state.openWatersToken)}`
    : '?limit=60';

  try {
    await runPool(targets, 3, async (v) => {
      state.trackFetchedAt.set(v.mmsi, Date.now());
      const res = await fetch(`https://ais.openwaters.io/v1/vessels/${encodeURIComponent(v.mmsi)}/track${q}`);
      if (res.ok) {
        const geo = await res.json();
        const pts = parseOpenWatersTrack(geo);
        if (pts.length > 1) {
          const cur = state.vesselsMap.get(v.mmsi);
          if (cur) {
            cur.trail = pts.slice(-80);
            state.dirtyUi = true;
          }
        }
      }
      done++;
      if (dom.btnLoadTracks) dom.btnLoadTracks.textContent = `항적 수신 중 (${done}/${targets.length})`;
    });
  } finally {
    state.loadingTracks = false;
    if (dom.btnLoadTracks) dom.btnLoadTracks.textContent = '화면 항적 로드';
  }
}

// Virtual scroll listeners (instant 60 FPS scrolling over 35,000+ rows)
dom.vesselList.addEventListener('scroll', () => renderVisibleList(), { passive: true });
dom.fleetTableWrap.addEventListener('scroll', () => {
  if (state.fleetModalOpen) renderFleetTable(false);
}, { passive: true });

dom.filterGrid.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-type]');
  if (chip) {
    state.activeType = chip.dataset.type;
    dom.vesselList.scrollTop = 0;
    applyFiltersAndRender();
  }
});
dom.searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value.trim().toLowerCase();
  dom.vesselList.scrollTop = 0;
  applyFiltersAndRender();
});
dom.sortSelect.addEventListener('change', (e) => {
  state.sortBy = e.target.value;
  savePrefs();
  dom.vesselList.scrollTop = 0;
  applyFiltersAndRender();
});
const isMobileViewport = () => window.matchMedia('(max-width: 768px)').matches;

function setSidebarOpen(open) {
  dom.sidebar.classList.toggle('collapsed', !open);
  dom.btnToggleSidebar.setAttribute('aria-expanded', String(open));
  if (dom.mobileBackdrop) {
    dom.mobileBackdrop.classList.toggle('hidden', !(open && isMobileViewport()));
  }
}

function closeInspector() {
  state.selectedMmsi = null;
  state.followSelected = false;
  globe.setSelectedVessel(null, false);
  dom.inspector.classList.add('hidden');
  dom.inspector.classList.remove('expanded');
  document.body.classList.remove('inspector-open');
  renderVisibleList();
}

dom.vesselList.addEventListener('click', (e) => {
  const item = e.target.closest('[data-mmsi]');
  if (item) {
    if (isMobileViewport()) setSidebarOpen(false);
    selectVessel(item.dataset.mmsi, true);
  }
});

async function selectVessel(mmsi, fly = false) {
  state.selectedMmsi = mmsi;
  const v = state.vesselsMap.get(mmsi);
  if (!v) return;

  if (isMobileViewport()) {
    setSidebarOpen(false);
    dom.inspector.classList.remove('expanded');
  }
  globe.setSelectedVessel(mmsi, state.followSelected);
  if (fly) globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 4.8), 700);
  state.loadingDetailsMmsi = mmsi;
  renderVisibleList();
  renderInspector();

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
      state.trackFetchedAt.set(mmsi, Date.now());
    }
    state.vesselsMap.set(updated.mmsi, updated);
  } catch {
    // keep live record
  } finally {
    if (state.loadingDetailsMmsi === mmsi) state.loadingDetailsMmsi = null;
    syncFromMap();
  }
}

function renderInspector() {
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
  dom.inspector.innerHTML = renderInspectorBodyHtml(
    v,
    state.followSelected,
    state.loadingDetailsMmsi === v.mmsi,
    state.favorites.has(v.mmsi)
  );
  dom.inspector.scrollTop = prevScroll;
}

dom.inspector.addEventListener('click', (e) => {
  if (e.target.closest('#inspector-handle')) {
    dom.inspector.classList.toggle('expanded');
    return;
  }
  if (e.target.closest('#btn-favorite-vessel')) {
    if (!state.selectedMmsi) return;
    if (state.favorites.has(state.selectedMmsi)) {
      state.favorites.delete(state.selectedMmsi);
      showToast('관심 선박에서 해제했습니다.');
    } else {
      state.favorites.add(state.selectedMmsi);
      showToast('★ 관심 선박에 등록했습니다.');
    }
    savePrefs();
    applyFiltersAndRender();
    return;
  }
  if (e.target.closest('#btn-close-inspector')) {
    closeInspector();
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
    if (v) {
      if (isMobileViewport()) dom.inspector.classList.remove('expanded');
      globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 6.0), 600);
    }
    return;
  }
  if (e.target.closest('#btn-share-vessel')) {
    const v = state.vesselsMap.get(state.selectedMmsi);
    if (!v) return;
    const z = Math.max(6, Math.round(globe.zoom * 10) / 10);
    const hash = `#mmsi=${encodeURIComponent(v.mmsi)}&lat=${v.lat.toFixed(4)}&lon=${v.lon.toFixed(4)}&z=${z}`;
    const shareUrl = `${window.location.origin}${window.location.pathname}${hash}`;
    try {
      window.history.replaceState(null, '', hash);
    } catch { /* ignore */ }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(shareUrl)
        .then(() => showToast('선박 공유 링크를 복사했습니다.'))
        .catch(() => showToast('주소창 링크가 업데이트되었습니다.'));
    } else {
      showToast('주소창 링크가 업데이트되었습니다.');
    }
  }
});

// Touch swipe gestures on mobile bottom-sheet handle (up: expand, down: collapse/dismiss)
let sheetTouchStartY = null;
dom.inspector.addEventListener(
  'touchstart',
  (e) => {
    if (!isMobileViewport() || e.touches.length !== 1) return;
    if (e.target.closest('#inspector-handle') || dom.inspector.scrollTop <= 0) {
      sheetTouchStartY = e.touches[0].clientY;
    } else {
      sheetTouchStartY = null;
    }
  },
  { passive: true }
);
dom.inspector.addEventListener(
  'touchend',
  (e) => {
    if (sheetTouchStartY === null || !e.changedTouches.length) return;
    const dy = e.changedTouches[0].clientY - sheetTouchStartY;
    sheetTouchStartY = null;
    if (dy < -42) {
      dom.inspector.classList.add('expanded');
    } else if (dy > 52) {
      if (dom.inspector.classList.contains('expanded')) {
        dom.inspector.classList.remove('expanded');
      } else {
        closeInspector();
      }
    }
  },
  { passive: true }
);

// Fleet Table Modal (with column sorting & live modal search)
dom.btnFleetTable.addEventListener('click', () => {
  if (isMobileViewport()) setSidebarOpen(false);
  state.fleetModalOpen = true;
  dom.fleetModal.classList.remove('hidden');
  dom.fleetTableWrap.scrollTop = 0;
  renderFleetTable(true);
});
dom.btnCloseFleetModal.addEventListener('click', () => {
  state.fleetModalOpen = false;
  dom.fleetModal.classList.add('hidden');
});
dom.fleetModal.addEventListener('click', (e) => {
  if (e.target === dom.fleetModal) {
    state.fleetModalOpen = false;
    dom.fleetModal.classList.add('hidden');
  }
});
if (dom.fleetModalSearch) {
  dom.fleetModalSearch.addEventListener('input', (e) => {
    state.tableSearchQuery = e.target.value.trim().toLowerCase();
    dom.fleetTableWrap.scrollTop = 0;
    renderFleetTable(true);
  });
}
if (dom.fleetTableHead) {
  dom.fleetTableHead.addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort-col]');
    if (!th) return;
    const col = th.dataset.sortCol;
    if (state.tableSortCol === col) {
      state.tableSortDir = state.tableSortDir === 'asc' ? 'desc' : 'asc';
    } else {
      state.tableSortCol = col;
      state.tableSortDir = ['name', 'type', 'aisClass', 'flag', 'mmsi', 'imo', 'callsign', 'destination', 'source'].includes(col)
        ? 'asc'
        : 'desc';
    }
    dom.fleetTableWrap.scrollTop = 0;
    renderFleetTable(true);
  });
}
dom.btnExportCsv.addEventListener('click', () => {
  exportVesselsCsv(state.tableVessels.length ? state.tableVessels : state.filteredVessels);
});
dom.fleetTableBody.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-mmsi]');
  if (!row) return;
  state.fleetModalOpen = false;
  dom.fleetModal.classList.add('hidden');
  selectVessel(row.dataset.mmsi, true);
});

// Live Viewport Scan, Visible Tracks & Refresh
dom.btnScanView.addEventListener('click', async () => {
  const maxArea = state.openWatersToken ? 360 : 90;
  const bbox = buildBboxAround(globe.centerLat, globe.centerLon, maxArea);
  state.activeZoneId = 'custom';
  state.activeBbox = bbox;
  state.wsSubCenter = { lat: globe.centerLat, lon: globe.centerLon };
  state.lastAutoWsAt = Date.now();
  if (state.provider === 'openwaters') {
    dom.btnScanView.textContent = '수신 중...';
    try {
      await fetchOpenWatersBbox(bbox);
      syncFromMap();
      connectOpenWatersWs(bbox);
      await loadVisibleTracks(18);
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

dom.btnLoadTracks.addEventListener('click', () => {
  globe.setOption('showWakes', true);
  dom.btnWakes.classList.add('active');
  savePrefs();
  loadVisibleTracks(24).catch(() => {});
});

dom.btnRefreshLive.addEventListener('click', () => {
  if (state.provider === 'digitraffic') startDigitraffic();
  else if (state.provider === 'remote-sse' && state.backendUrl) startRemoteBackend(state.backendUrl);
  else startOpenWaters();
});

// Layer Toggles & Mobile Drawer
dom.btnToggleSidebar.addEventListener('click', () => {
  setSidebarOpen(dom.sidebar.classList.contains('collapsed'));
});
if (dom.btnCloseSidebar) {
  dom.btnCloseSidebar.addEventListener('click', () => setSidebarOpen(false));
}
if (dom.mobileBackdrop) {
  dom.mobileBackdrop.addEventListener('click', () => setSidebarOpen(false));
}
window.addEventListener('resize', () => {
  if (!isMobileViewport() && dom.mobileBackdrop) {
    dom.mobileBackdrop.classList.add('hidden');
  }
});

dom.btnZoomIn.addEventListener('click', () => globe.zoomBy(1.4));
dom.btnZoomOut.addEventListener('click', () => globe.zoomBy(0.71));

const LAYER_BINDINGS = [
  [dom.btnClusters, 'showClusters'],
  [dom.btnBorders, 'showBorders'],
  [dom.btnAutoRotate, 'autoRotate'],
  [dom.btnDayNight, 'showDayNight'],
  [dom.btnWakes, 'showWakes'],
  [dom.btnPorts, 'showPorts'],
  [dom.btnLabels, 'showLabels'],
];

for (const [btn, optKey] of LAYER_BINDINGS) {
  if (!btn) continue;
  if (savedPrefs.layers && typeof savedPrefs.layers[optKey] === 'boolean') {
    globe.setOption(optKey, savedPrefs.layers[optKey]);
    btn.classList.toggle('active', savedPrefs.layers[optKey]);
  }
  btn.addEventListener('click', () => {
    const next = !globe.options[optKey];
    globe.setOption(optKey, next);
    btn.classList.toggle('active', next);
    savePrefs();
  });
}

dom.btnMovingOnly.addEventListener('click', () => {
  state.movingOnly = !state.movingOnly;
  dom.btnMovingOnly.classList.toggle('active', state.movingOnly);
  savePrefs();
  dom.vesselList.scrollTop = 0;
  applyFiltersAndRender();
});

dom.btnTheme.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('theme-light', state.theme === 'light');
  dom.btnTheme.textContent = state.theme === 'dark' ? '☀' : '☾';
  globe.setTheme(state.theme);
  savePrefs();
});

// Feed Settings Modal
dom.btnApiConfig.addEventListener('click', () => {
  if (isMobileViewport()) setSidebarOpen(false);
  dom.modalError.style.display = 'none';
  dom.providerSelect.value = state.provider;
  dom.openWatersTokenInput.value = state.openWatersToken;
  dom.backendUrlInput.value = state.backendUrl;
  dom.apiModal.classList.remove('hidden');
});
dom.btnCancelModal.addEventListener('click', () => dom.apiModal.classList.add('hidden'));
dom.apiModal.addEventListener('click', (e) => {
  if (e.target === dom.apiModal) dom.apiModal.classList.add('hidden');
});
dom.btnSaveApi.addEventListener('click', () => {
  const nextProvider = dom.providerSelect.value;
  state.openWatersToken = dom.openWatersTokenInput.value.trim();
  const url = dom.backendUrlInput.value.trim().replace(/\/+$/, '');
  state.backendUrl = url;
  savePrefs();

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

// Keyboard shortcuts: '/' search, 'Esc' close modals/drawer/inspector, '+'/'-' zoom
window.addEventListener('keydown', (e) => {
  const tag = e.target?.tagName;
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

  if (e.key === 'Escape') {
    if (state.fleetModalOpen) {
      state.fleetModalOpen = false;
      dom.fleetModal.classList.add('hidden');
    } else if (!dom.apiModal.classList.contains('hidden')) {
      dom.apiModal.classList.add('hidden');
    } else if (isMobileViewport() && !dom.sidebar.classList.contains('collapsed')) {
      setSidebarOpen(false);
    } else if (state.selectedMmsi) {
      closeInspector();
    }
    return;
  }

  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

  if (e.key === '/') {
    e.preventDefault();
    setSidebarOpen(true);
    dom.searchInput.focus();
    dom.searchInput.select();
  } else if (e.key === '+' || e.key === '=') {
    globe.zoomBy(1.4);
  } else if (e.key === '-') {
    globe.zoomBy(0.71);
  }
});

// Restore saved UI preferences (theme, sort, movingOnly) on boot
if (state.theme === 'light') {
  document.body.classList.add('theme-light');
  dom.btnTheme.textContent = '☾';
}
if (state.movingOnly) {
  dom.btnMovingOnly.classList.add('active');
}
if (dom.sortSelect) {
  dom.sortSelect.value = state.sortBy;
}

// Throttled 2s UI sync for incoming live WebSocket frames (keeps CPU/DOM ultra-light!)
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
}, 2000);

// Periodically evict stale vessels unseen for >6h (preserving selected & favorite ships)
setInterval(() => {
  const cutoff = Date.now() - STALE_VESSEL_MS;
  let removed = 0;
  for (const [mmsi, v] of state.vesselsMap.entries()) {
    if (mmsi === state.selectedMmsi || state.favorites.has(mmsi)) continue;
    if (v.updatedAt && v.updatedAt < cutoff) {
      state.vesselsMap.delete(mmsi);
      removed++;
    }
  }
  if (removed > 0) state.dirtyUi = true;
}, 60000);

// On mobile, start with the sidebar drawer closed so the 3D globe is immediately visible
if (isMobileViewport()) {
  setSidebarOpen(false);
}

// If a deep-linked MMSI isn't in initial tiles, fetch it directly from Open Waters
if (state.pendingDeepLinkMmsi) {
  const mmsi = state.pendingDeepLinkMmsi;
  const q = state.openWatersToken ? `?key=${encodeURIComponent(state.openWatersToken)}` : '';
  fetch(`https://ais.openwaters.io/v1/vessels/${encodeURIComponent(mmsi)}${q}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((feat) => {
      const parsed = feat ? parseOpenWatersFeature(feat) : null;
      if (parsed) {
        upsertVessel(parsed);
        syncFromMap();
      }
    })
    .catch(() => {});
}

// Register lightweight app-shell Service Worker for PWA installability & instant repeat loads
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

renderPresets();
startOpenWaters();
