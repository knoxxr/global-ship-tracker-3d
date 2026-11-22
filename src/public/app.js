/**
 * MarineGlobe 3D — 100% Live AIS Client Controller (Node.js Backend SSE Mode).
 * Displays ONLY real received vessels with zero simulation data.
 */

import { GlobeEngine } from './globe-engine.js';
import { VESSEL_TYPES } from './world-data.js';
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

const LIVE_PRESETS = [
  { id: 'korea-strait', label: '한반도·대한해협', lat: 35.1, lon: 129.0, zoom: 3.4 },
  { id: 'singapore-malacca', label: '말라카·싱가포르', lat: 2.2, lon: 103.5, zoom: 3.5 },
  { id: 'north-sea', label: '유럽·북해', lat: 51.6, lon: 2.5, zoom: 3.2 },
  { id: 'nordic-norway', label: '노르웨이', lat: 60.0, lon: 8.5, zoom: 3.2 },
  { id: 'baltic-finland', label: '발트해', lat: 60.1, lon: 23.5, zoom: 3.3 },
  { id: 'mediterranean', label: '지중해', lat: 37.8, lon: 19.5, zoom: 3.0 },
  { id: 'us-east', label: '미동부', lat: 40.8, lon: -72.5, zoom: 3.2 },
  { id: 'us-west', label: '미서부', lat: 34.8, lon: -120.2, zoom: 3.2 },
];

const state = {
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
  openWatersToken: document.getElementById('openwaters-token'),
  aisApiKey: document.getElementById('ais-api-key'),
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

dom.filterGrid.addEventListener('click', (e) => {
  const chip = e.target.closest('[data-type]');
  if (!chip) return;
  state.activeType = chip.dataset.type;
  applyFiltersAndRender();
});

dom.searchInput.addEventListener('input', (e) => {
  state.searchQuery = e.target.value.trim().toLowerCase();
  applyFiltersAndRender();
});

dom.sortSelect.addEventListener('change', (e) => {
  state.sortBy = e.target.value;
  applyFiltersAndRender();
});

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

  dom.btnFleetTable.textContent = `전체 선박 표 (${state.filteredVessels.length})`;
  dom.fleetSummary.innerHTML = renderFleetSummaryHtml(state.filteredVessels);
  dom.filteredCount.textContent = `실시간 수신: ${state.filteredVessels.length}척`;

  const emptyMsg = state.status.lastError
    ? `실시간 피드 오류: ${state.status.lastError}`
    : state.allVessels.length === 0
      ? '실시간 AIS 선박 데이터를 수신하고 있습니다...'
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
  dom.vesselList.innerHTML = renderAllVesselListHtml(state.filteredVessels, state.selectedMmsi);
  state.loadingDetailsMmsi = mmsi;
  renderInspector();

  // Fetch real live particulars + 24h AIS track from backend proxy
  try {
    const res = await fetch(`/api/vessel/${encodeURIComponent(mmsi)}`);
    if (res.ok) {
      const data = await res.json();
      if (data.vessel) {
        state.vesselsMap.set(data.vessel.mmsi, data.vessel);
        state.allVessels = Array.from(state.vesselsMap.values());
      }
    }
  } catch {
    // keep live position record
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

// Full Fleet Table Modal
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
});

dom.btnRefreshLive.addEventListener('click', async () => {
  await postConfig({ provider: state.status.provider });
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

// AIS Provider Settings Modal
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
  dom.statVessels.textContent = status.vesselCount;
  dom.statRate.textContent = status.msgPerSec;

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
  state.allVessels = Array.from(state.vesselsMap.values());
  applyFiltersAndRender();
}

function connectStream() {
  const es = new EventSource('/api/stream');
  es.addEventListener('snapshot', (e) => {
    const data = JSON.parse(e.data);
    if (data.status) updateStatusUI(data.status);
    ingestVessels(data.vessels || [], true);
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

function tickClock() {
  dom.utcClock.textContent = new Date().toISOString().slice(11, 19);
}

renderPresets();
tickClock();
setInterval(tickClock, 1000);
connectStream();
