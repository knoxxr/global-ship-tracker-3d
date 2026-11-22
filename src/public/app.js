/**
 * MarineGlobe 3D — 100% Live AIS Client Controller (Node.js Backend SSE Mode).
 * Uses virtualized list/table rendering to handle 20,000+ live vessels smoothly at 60 FPS.
 */

import { GlobeEngine } from './globe-engine.js';
import { VESSEL_TYPES } from './world-data.js';
import {
  formatCoordShort,
  sortVessels,
  renderHoverTooltipHtml,
  renderClusterTooltipHtml,
  renderFleetSummaryHtml,
  renderVirtualVesselList,
  renderInspectorBodyHtml,
  renderVirtualFleetTable,
  exportVesselsCsv,
} from './telemetry-ui.js';

const TRACK_CACHE_MS = 10 * 60 * 1000;

const LIVE_PRESETS = [
  { id: 'korea-strait', label: '한반도·대한해협', lat: 35.1, lon: 129.0, zoom: 3.4 },
  { id: 'shanghai-taiwan', label: '상하이·대만', lat: 27.5, lon: 119.5, zoom: 3.0 },
  { id: 'singapore-malacca', label: '말라카·싱가포르', lat: 2.2, lon: 103.5, zoom: 3.5 },
  { id: 'north-sea', label: '유럽·북해', lat: 51.6, lon: 2.5, zoom: 3.2 },
  { id: 'mediterranean', label: '지중해', lat: 37.8, lon: 19.5, zoom: 3.0 },
  { id: 'us-east', label: '미동부', lat: 40.8, lon: -72.5, zoom: 3.2 },
  { id: 'us-west', label: '미서부', lat: 34.8, lon: -120.2, zoom: 3.2 },
  { id: 'sydney-au', label: '호주·시드니', lat: -33.5, lon: 151.5, zoom: 3.3 },
];

const state = {
  vesselsMap: new Map(),
  allVessels: [],
  filteredVessels: [],
  selectedMmsi: null,
  loadingDetailsMmsi: null,
  followSelected: false,
  activeType: 'all',
  movingOnly: false,
  searchQuery: '',
  sortBy: 'recent-desc',
  theme: 'dark',
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
  btnTheme: document.getElementById('btn-theme'),
  btnFleetTable: document.getElementById('btn-fleet-table'),
  fleetModal: document.getElementById('fleet-modal'),
  fleetModalSub: document.getElementById('fleet-modal-sub'),
  fleetTableWrap: document.getElementById('fleet-table-wrap'),
  fleetTableBody: document.getElementById('fleet-table-body'),
  btnExportCsv: document.getElementById('btn-export-csv'),
  btnCloseFleetModal: document.getElementById('btn-close-fleet-modal'),
  btnApiConfig: document.getElementById('btn-api-config'),
  apiModal: document.getElementById('api-modal'),
  providerSelect: document.getElementById('provider-select'),
  openWatersToken: document.getElementById('openwaters-token'),
  aisApiKey: document.getElementById('ais-api-key'),
  modalError: document.getElementById('modal-error'),
  btnCancelModal: document.getElementById('btn-cancel-modal'),
  btnSaveApi: document.getElementById('btn-save-api'),
};

let autoTrackTimer = null;
let lastAutoTrackKey = '';

const globe = new GlobeEngine(dom.canvas, {
  initialLat: 28,
  initialLon: 124,
  initialZoom: 1.45,
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
  },
});
globe.setOption('showLanes', false);

function renderPresets() {
  dom.presetBar.innerHTML = LIVE_PRESETS.map(
    (p) => `<button class="btn" data-zone="${p.id}">${p.label}</button>`
  ).join('');
  dom.presetBar.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-zone]');
    if (!btn) return;
    const preset = LIVE_PRESETS.find((p) => p.id === btn.dataset.zone);
    if (!preset) return;
    state.followSelected = false;
    globe.setSelectedVessel(state.selectedMmsi, false);
    globe.flyTo(preset.lat, preset.lon, preset.zoom, 800);
    await postConfig({ zoneId: preset.id, bboxOnly: true });
  });
}

function renderFilterChips() {
  const counts = { all: state.allVessels.length };
  for (const key of Object.keys(VESSEL_TYPES)) counts[key] = 0;
  for (const v of state.allVessels) {
    if (counts[v.type] !== undefined) counts[v.type]++;
  }

  let html = `<button class="filter-chip ${state.activeType === 'all' ? 'active' : ''}" data-type="all">전체 <span class="mono">${counts.all.toLocaleString()}</span></button>`;
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

function getEmptyMsg() {
  return state.status.lastError
    ? `실시간 피드 오류: ${state.status.lastError}`
    : state.allVessels.length === 0
      ? '실시간 AIS 선박 데이터를 수신하고 있습니다...'
      : '검색 조건과 일치하는 실시간 선박이 없습니다.';
}

function renderVisibleList() {
  renderVirtualVesselList(dom.vesselList, state.filteredVessels, state.selectedMmsi, getEmptyMsg());
}

function renderFleetTable() {
  dom.fleetModalSub.textContent = `실시간 수신 선박 총 ${state.filteredVessels.length.toLocaleString()}척 전체 표시 중 · 행 클릭 시 3D 지구본 이동 및 24시간 실제 항적 조회`;
  renderVirtualFleetTable(dom.fleetTableWrap, dom.fleetTableBody, state.filteredVessels, state.selectedMmsi);
}

function applyFiltersAndRender() {
  const q = state.searchQuery;
  const matched = state.allVessels.filter((v) => {
    if (state.movingOnly && (v.sog || 0) < 0.5) return false;
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

  dom.btnFleetTable.textContent = `전체 선박 표 (${state.filteredVessels.length.toLocaleString()})`;
  dom.fleetSummary.innerHTML = renderFleetSummaryHtml(state.filteredVessels);
  dom.filteredCount.textContent = `실시간 수신: ${state.filteredVessels.length.toLocaleString()}척`;

  renderFilterChips();
  renderVisibleList();
  renderInspector();
  if (state.fleetModalOpen) renderFleetTable();
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
  if (dom.btnLoadTracks) dom.btnLoadTracks.textContent = `항적 수신 중 (0/${targets.length})`;
  let done = 0;

  try {
    await runPool(targets, 3, async (v) => {
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
      if (dom.btnLoadTracks) dom.btnLoadTracks.textContent = `항적 수신 중 (${done}/${targets.length})`;
    });
  } finally {
    state.loadingTracks = false;
    if (dom.btnLoadTracks) dom.btnLoadTracks.textContent = '화면 항적 로드';
  }
}

dom.vesselList.addEventListener('scroll', () => renderVisibleList(), { passive: true });
dom.fleetTableWrap.addEventListener('scroll', () => {
  if (state.fleetModalOpen) renderFleetTable();
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
  dom.vesselList.scrollTop = 0;
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
  if (fly) globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 4.8), 700);
  state.loadingDetailsMmsi = mmsi;
  renderVisibleList();
  renderInspector();

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
    renderVisibleList();
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
    if (v) globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 6.0), 600);
  }
});

dom.btnFleetTable.addEventListener('click', () => {
  state.fleetModalOpen = true;
  dom.fleetModal.classList.remove('hidden');
  dom.fleetTableWrap.scrollTop = 0;
  renderFleetTable();
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

dom.btnScanView.addEventListener('click', async () => {
  const half = 4.5;
  const lat = globe.centerLat;
  const lon = globe.centerLon;
  const bbox = [
    Math.max(-85, Number((lat - half).toFixed(2))),
    Math.max(-180, Number((lon - half).toFixed(2))),
    Math.min(85, Number((lat + half).toFixed(2))),
    Math.min(180, Number((lon + half).toFixed(2))),
  ];
  await postConfig({ bbox, bboxOnly: true });
  await loadVisibleTracks(18);
});

if (dom.btnLoadTracks) {
  dom.btnLoadTracks.addEventListener('click', () => {
    globe.setOption('showWakes', true);
    if (dom.btnWakes) dom.btnWakes.classList.add('active');
    loadVisibleTracks(24).catch(() => {});
  });
}

dom.btnRefreshLive.addEventListener('click', async () => {
  await postConfig({ provider: state.status.provider });
});

dom.btnToggleSidebar.addEventListener('click', () => dom.sidebar.classList.toggle('collapsed'));
dom.btnZoomIn.addEventListener('click', () => globe.zoomBy(1.4));
dom.btnZoomOut.addEventListener('click', () => globe.zoomBy(0.71));

function bindToggle(btn, optKey) {
  if (!btn) return;
  btn.addEventListener('click', () => {
    const next = !globe.options[optKey];
    globe.setOption(optKey, next);
    btn.classList.toggle('active', next);
  });
}
bindToggle(dom.btnClusters, 'showClusters');
bindToggle(dom.btnBorders, 'showBorders');
bindToggle(dom.btnAutoRotate, 'autoRotate');
bindToggle(dom.btnDayNight, 'showDayNight');
bindToggle(dom.btnWakes, 'showWakes');
bindToggle(dom.btnPorts, 'showPorts');
bindToggle(dom.btnLabels, 'showLabels');

if (dom.btnMovingOnly) {
  dom.btnMovingOnly.addEventListener('click', () => {
    state.movingOnly = !state.movingOnly;
    dom.btnMovingOnly.classList.toggle('active', state.movingOnly);
    dom.vesselList.scrollTop = 0;
    applyFiltersAndRender();
  });
}

dom.btnTheme.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('theme-light', state.theme === 'light');
  dom.btnTheme.textContent = state.theme === 'dark' ? '☀' : '☾';
  globe.setTheme(state.theme);
});

dom.btnApiConfig.addEventListener('click', () => {
  dom.modalError.style.display = 'none';
  dom.providerSelect.value = state.status.provider || 'openwaters';
  dom.apiModal.classList.remove('hidden');
});
dom.btnCancelModal.addEventListener('click', () => dom.apiModal.classList.add('hidden'));
dom.btnSaveApi.addEventListener('click', async () => {
  const provider = dom.providerSelect.value;
  const aisStreamKey = dom.aisApiKey.value.trim();
  const openWatersToken = dom.openWatersToken.value.trim();
  if (provider === 'aisstream' && !aisStreamKey && !state.status.hasAisStreamKey) {
    dom.modalError.textContent = 'AISStream.io 선택 시 API 키를 입력하세요.';
    dom.modalError.style.display = 'block';
    return;
  }
  await postConfig({ provider, aisStreamKey, openWatersToken });
  dom.apiModal.classList.add('hidden');
});

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
  if (status.connectionState === 'connected') {
    dom.statusMode.textContent = providerLabel;
  } else if (status.connectionState === 'error') {
    dom.statusDot.classList.add('error');
    dom.statusMode.textContent = '피드 오류';
  } else {
    dom.statusDot.classList.add('sim');
    dom.statusMode.textContent = '수신 연결 중...';
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
    dom.statusMode.textContent = '서버 재연결 중';
  };
}

setInterval(() => {
  dom.utcClock.textContent = new Date().toISOString().slice(11, 19);
  if (state.dirtyUi) {
    state.dirtyUi = false;
    state.allVessels = Array.from(state.vesselsMap.values());
    applyFiltersAndRender();
  }
}, 2000);

renderPresets();
connectStream();
