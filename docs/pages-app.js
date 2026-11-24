/**
 * MarineGlobe 3D — 100% Live Browser-Native AIS Controller (GitHub Pages).
 * Streams 35,000+ real vessels globally with zero simulation:
 *  - Open Waters AIS (64 global MVT tiles + 16 dense REST hubs + live WebSocket + 24h tracks)
 *  - Fintraffic Digitraffic Marine Open API (automatic fallback or direct selection)
 *  - Optional custom MarineGlobe Node.js SSE backend
 * Delegates shared UI state/controls to ./ui-controller.js.
 */

import { GlobeEngine } from './globe-engine.js?v=cbf5d623';
import { LIVE_ZONES, buildBboxAround } from './live-zones.js';
import { decodeMvtPoints } from './mvt-decoder.js';
import {
  parseOpenWatersEvent,
  parseOpenWatersFeature,
  parseOpenWatersTilePoint,
  parseOpenWatersTrack,
  parseDigitrafficData,
} from './ais-parser.js?v=cbf5d623';
import {
  formatCoordShort,
  sortVessels,
  renderHoverTooltipHtml,
  renderClusterTooltipHtml,
  renderFleetSummaryHtml,
  renderVirtualVesselList,
  renderInspectorBodyHtml,
  renderVirtualFleetTable,
} from './telemetry-ui.js?v=cbf5d623';
import {
  isMobileViewport,
  loadPrefs,
  persistPrefs,
  parseHashDeepLink,
  createToast,
  queryCommonDom,
  buildFilterChipsHtml,
  filterVesselsList,
  filterAndSortTableVessels,
  updateTableSortIndicators,
  bindSharedUi,
  registerAppServiceWorker,
} from './ui-controller.js?v=cbf5d623';

const MAX_VESSELS = 80000;
const TRACK_CACHE_MS = 10 * 60 * 1000;
const TILE_CACHE_MS = 3 * 60 * 1000;
const BBOX_CACHE_MS = 3 * 60 * 1000;
const STALE_VESSEL_MS = 6 * 60 * 60 * 1000;

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
  tileFetchedAt: new Map(),
  bboxFetchedAt: new Map(),
  loadingTracks: false,
  loadingViewport: false,
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
  ...queryCommonDom(),
  backendUrlInput: document.getElementById('backend-url'),
};

const showToast = createToast(dom.toastNotice);
let autoTrackTimer = null;
let autoWsTimer = null;
let autoViewportTimer = null;
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
    // Auto-load un-thinned z=5/6 MVT tiles & REST metadata for any region the user explores
    if (state.provider === 'openwaters' && zoom >= 2.0) {
      clearTimeout(autoViewportTimer);
      autoViewportTimer = setTimeout(() => {
        loadViewportVessels().catch(() => {});
      }, 650);
    }
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

const savePrefs = () =>
  persistPrefs(state, globe, {
    openWatersToken: state.openWatersToken,
    backendUrl: state.backendUrl,
  });

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

function getViewportMvtTiles(centerLat, centerLon, span, z, maxTiles = 16) {
  const n = 1 << z;
  const DEG2RAD = Math.PI / 180;
  const latToY = (lat) => {
    const c = Math.max(-85, Math.min(85, lat)) * DEG2RAD;
    return Math.max(0, Math.min(n - 1, Math.floor(((1 - Math.log(Math.tan(c) + 1 / Math.cos(c)) / Math.PI) / 2) * n)));
  };
  const lonToX = (lon) => Math.floor(((lon + 180) / 360) * n);

  const minY = latToY(centerLat + span.halfLat * 1.1);
  const maxY = latToY(centerLat - span.halfLat * 1.1);
  const rawMinX = lonToX(centerLon - span.halfLon * 1.1);
  const rawMaxX = lonToX(centerLon + span.halfLon * 1.1);
  const cxTile = ((centerLon + 180) / 360) * n;
  const cyTile = ((1 - Math.log(Math.tan(Math.max(-85, Math.min(85, centerLat)) * DEG2RAD) + 1 / Math.cos(Math.max(-85, Math.min(85, centerLat)) * DEG2RAD)) / Math.PI) / 2) * n;

  const tiles = [];
  const seen = new Set();
  for (let y = minY; y <= maxY; y++) {
    for (let rawX = rawMinX; rawX <= rawMaxX; rawX++) {
      const x = ((rawX % n) + n) % n;
      const key = `${z}/${x}/${y}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const dist = Math.hypot(rawX + 0.5 - cxTile, y + 0.5 - cyTile);
      tiles.push({ z, x, y, key, dist });
    }
  }
  tiles.sort((a, b) => a.dist - b.dist);
  return tiles.slice(0, maxTiles);
}

let viewportNeedsRetry = false;

/**
 * Automatically loads un-thinned Open Waters vessels (z=5/6 MVT tiles + high-zoom REST metadata)
 * for whichever sea or coastline the user zooms into, eliminating z=3 global tile thinning gaps.
 */
async function loadViewportVessels() {
  if (state.provider !== 'openwaters' || globe.zoom < 2.0) return;
  if (state.loadingViewport) {
    viewportNeedsRetry = true;
    return;
  }

  const now = Date.now();
  const z = globe.zoom >= 6.0 ? 6 : 5;
  const span = globe.getViewportSpanDeg();
  const tiles = getViewportMvtTiles(globe.centerLat, globe.centerLon, span, z, 16);
  const missingTiles = tiles.filter((t) => now - (state.tileFetchedAt.get(t.key) || 0) > TILE_CACHE_MS);

  const bboxKey = `${Math.round(globe.centerLat / 2)}:${Math.round(globe.centerLon / 2)}`;
  const needRestBbox =
    globe.zoom >= 7.0 && now - (state.bboxFetchedAt.get(bboxKey) || 0) > BBOX_CACHE_MS;

  if (missingTiles.length === 0 && !needRestBbox) return;

  state.loadingViewport = true;
  let loaded = 0;
  try {
    if (missingTiles.length > 0) {
      await runPool(missingTiles, 4, async (t) => {
        state.tileFetchedAt.set(t.key, Date.now());
        loaded += await fetchOpenWatersTile(t.z, t.x, t.y);
      });
    }
    if (needRestBbox) {
      state.bboxFetchedAt.set(bboxKey, Date.now());
      const maxArea = state.openWatersToken ? 360 : 90;
      const bbox = buildBboxAround(globe.centerLat, globe.centerLon, maxArea);
      loaded += await fetchOpenWatersBbox(bbox);
    }
    if (loaded > 0) syncFromMap();
  } catch {
    // non-fatal viewport fill error
  } finally {
    state.loadingViewport = false;
    if (viewportNeedsRetry) {
      viewportNeedsRetry = false;
      setTimeout(() => loadViewportVessels().catch(() => {}), 150);
    }
  }
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

  // If opened directly at a zoomed-in deep-link, fill its un-thinned tiles right away
  if (globe.zoom >= 2.0) {
    loadViewportVessels().catch(() => {});
  }

  // Phase 2: Full-planet z=3 MVT vector tiles (64 tiles)
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

  // Phase 3: Remaining 12 dense global hubs un-thinned
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
    if (globe.zoom >= 2.0) {
      loadViewportVessels().catch(() => {});
    }
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

// --- Presets & Rendering ---
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

function renderFleetTable(recompute = true) {
  if (recompute) {
    state.tableVessels = filterAndSortTableVessels(state.filteredVessels, state);
    updateTableSortIndicators(dom.fleetTableHead, state.tableSortCol, state.tableSortDir);
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
  const matched = filterVesselsList(state.allVessels, state);
  state.filteredVessels = sortVessels(matched, state.sortBy);
  globe.setVessels(state.filteredVessels);

  updateStatusBadge();
  const countStr = state.filteredVessels.length.toLocaleString();
  dom.btnFleetTable.innerHTML = `<span class="label-desktop">전체 선박 표 (${countStr})</span><span class="label-mobile">선박표</span>`;
  dom.fleetSummary.innerHTML = renderFleetSummaryHtml(state.filteredVessels);
  dom.filteredCount.textContent = `실시간 수신: ${countStr}척`;

  dom.filterGrid.innerHTML = buildFilterChipsHtml(state.allVessels, state.activeType, state.favorites);
  renderVisibleList();
  renderInspector();
  if (state.fleetModalOpen) renderFleetTable(true);
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
});

async function selectVessel(mmsi, fly = false) {
  state.selectedMmsi = mmsi;
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

// Feed Settings Modal (Pages mode)
dom.btnApiConfig.addEventListener('click', () => {
  if (isMobileViewport()) ui.setSidebarOpen(false);
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

// Throttled 2s UI sync
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

// Evict stale vessels unseen for >6h (preserving selected & favorite ships)
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

// Direct lookup if deep-linked MMSI isn't in initial tiles
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

registerAppServiceWorker('./sw.js');
renderPresets();
startOpenWaters();
