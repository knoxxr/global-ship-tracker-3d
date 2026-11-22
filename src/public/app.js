/**
 * MarineGlobe 3D — Client Controller (Node.js SSE Backend Mode)
 * Streams real-time AIS snapshots/deltas over Server-Sent Events (/api/stream),
 * displays ALL tracked vessels with detailed 5-section telemetry & full fleet table.
 */

import { GlobeEngine } from './globe-engine.js';
import { VESSEL_TYPES, CAMERA_PRESETS } from './world-data.js';
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

const REGION_BBOXES = {
  global: [[[-90, -180], [90, 180]]],
  korea: [[[28, 120], [42, 142]]],
  malacca: [[[-4, 94], [10, 110]]],
  europe: [[[45, -10], [60, 15]]],
  suez: [[[24, 24], [39, 40]]],
};

const state = {
  vesselsMap: new Map(),
  allVessels: [],
  filteredVessels: [],
  selectedMmsi: null,
  followSelected: false,
  activeType: 'all',
  searchQuery: '',
  sortBy: 'speed-desc',
  theme: 'dark',
  fleetModalOpen: false,
  status: {
    mode: 'simulator',
    connectionState: 'simulated',
    vesselCount: 0,
    msgPerSec: 0,
    paused: false,
    timeScale: 120,
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
  btnAutoRotate: document.getElementById('btn-autorotate'),
  btnDayNight: document.getElementById('btn-daynight'),
  btnLanes: document.getElementById('btn-lanes'),
  btnWakes: document.getElementById('btn-wakes'),
  btnPorts: document.getElementById('btn-ports'),
  btnLabels: document.getElementById('btn-labels'),
  btnPause: document.getElementById('btn-pause'),
  speedSelect: document.getElementById('speed-select'),
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
  aisApiKey: document.getElementById('ais-api-key'),
  aisRegion: document.getElementById('ais-region'),
  modalError: document.getElementById('modal-error'),
  btnSwitchSim: document.getElementById('btn-switch-sim'),
  btnCancelModal: document.getElementById('btn-cancel-modal'),
  btnSaveApi: document.getElementById('btn-save-api'),
};

const globe = new GlobeEngine(dom.canvas, {
  initialLat: 24,
  initialLon: 122,
  initialZoom: 1.15,
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

function renderPresets() {
  dom.presetBar.innerHTML = CAMERA_PRESETS.map(
    (p) => `<button class="btn" data-preset="${p.id}">${p.label}</button>`
  ).join('');
  dom.presetBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-preset]');
    if (!btn) return;
    const preset = CAMERA_PRESETS.find((p) => p.id === btn.dataset.preset);
    if (!preset) return;
    state.followSelected = false;
    globe.setSelectedVessel(state.selectedMmsi, false);
    renderInspector();
    globe.flyTo(preset.lat, preset.lon, preset.zoom, 800);
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
      (v.operator && v.operator.toLowerCase().includes(q)) ||
      (v.destination && v.destination.toLowerCase().includes(q)) ||
      (v.destinationName && v.destinationName.toLowerCase().includes(q)) ||
      (v.origin && v.origin.toLowerCase().includes(q)) ||
      (v.flagName && v.flagName.toLowerCase().includes(q)) ||
      (v.callsign && v.callsign.toLowerCase().includes(q))
    );
  });

  state.filteredVessels = sortVessels(matched, state.sortBy);
  globe.setVessels(state.filteredVessels);

  dom.btnFleetTable.textContent = `전체 선박 표 (${state.filteredVessels.length})`;
  dom.fleetSummary.innerHTML = renderFleetSummaryHtml(state.filteredVessels);
  dom.filteredCount.textContent = `전체 표시: ${state.filteredVessels.length}척`;

  renderFilterChips();
  dom.vesselList.innerHTML = renderAllVesselListHtml(state.filteredVessels, state.selectedMmsi);
  renderInspector();
  if (state.fleetModalOpen) renderFleetTable();
}

dom.vesselList.addEventListener('click', (e) => {
  const item = e.target.closest('[data-mmsi]');
  if (!item) return;
  selectVessel(item.dataset.mmsi, true);
});

function selectVessel(mmsi, fly = false) {
  state.selectedMmsi = mmsi;
  const v = state.vesselsMap.get(mmsi);
  if (!v) return;

  globe.setSelectedVessel(mmsi, state.followSelected);
  if (fly) {
    globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 2.8), 700);
  }
  dom.vesselList.innerHTML = renderAllVesselListHtml(state.filteredVessels, state.selectedMmsi);
  renderInspector();
  if (state.fleetModalOpen) renderFleetTable();
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
  dom.inspector.innerHTML = renderInspectorBodyHtml(v, state.followSelected);
  dom.inspector.scrollTop = prevScroll;
}

// Delegated Inspector Actions (preserved across live updates)
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
    if (v) globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 3.6), 600);
  }
});

// Full Fleet Table Modal
function renderFleetTable() {
  dom.fleetModalSub.textContent = `총 ${state.filteredVessels.length}척 전체 표시 중 · 행을 클릭하면 3D 지구본에서 즉시 해당 선박으로 이동합니다.`;
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

dom.btnExportCsv.addEventListener('click', () => {
  exportVesselsCsv(state.filteredVessels);
});

dom.fleetTableBody.addEventListener('click', (e) => {
  const row = e.target.closest('tr[data-mmsi]');
  if (!row) return;
  state.fleetModalOpen = false;
  dom.fleetModal.classList.add('hidden');
  selectVessel(row.dataset.mmsi, true);
});

// Toolbar Controls
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

dom.btnPause.addEventListener('click', async () => {
  await postConfig({ paused: !state.status.paused });
});

dom.speedSelect.addEventListener('change', async (e) => {
  await postConfig({ timeScale: Number(e.target.value) });
});

// API Modal
dom.btnApiConfig.addEventListener('click', () => {
  dom.modalError.style.display = 'none';
  dom.apiModal.classList.remove('hidden');
});
dom.btnCancelModal.addEventListener('click', () => dom.apiModal.classList.add('hidden'));
dom.btnSwitchSim.addEventListener('click', async () => {
  await postConfig({ mode: 'simulator' });
  dom.apiModal.classList.add('hidden');
});
dom.btnSaveApi.addEventListener('click', async () => {
  const key = dom.aisApiKey.value.trim();
  if (!key) {
    dom.modalError.textContent = 'API 키를 입력하거나 "시뮬레이터로 전환"을 선택하세요.';
    dom.modalError.style.display = 'block';
    return;
  }
  const region = dom.aisRegion.value;
  await postConfig({
    mode: 'aisstream',
    apiKey: key,
    boundingBoxes: REGION_BBOXES[region] || REGION_BBOXES.global,
  });
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

  dom.statusDot.classList.remove('sim', 'error');
  if (status.mode === 'aisstream') {
    if (status.connectionState === 'error') {
      dom.statusDot.classList.add('error');
      dom.statusMode.textContent = 'LIVE ERR';
    } else if (status.connectionState === 'connected') {
      dom.statusMode.textContent = 'LIVE AIS';
    } else {
      dom.statusDot.classList.add('sim');
      dom.statusMode.textContent = '연결 중...';
    }
  } else {
    dom.statusDot.classList.add('sim');
    dom.statusMode.textContent = 'SIM';
  }

  dom.btnPause.textContent = status.paused ? '재생' : '일시정지';
  dom.btnPause.classList.toggle('active', status.paused);
  dom.speedSelect.disabled = status.mode === 'aisstream';
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
  es.addEventListener('batch', (e) => {
    const data = JSON.parse(e.data);
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
    dom.statusMode.textContent = '재연결 중';
  };
}

function tickClock() {
  dom.utcClock.textContent = `${new Date().toISOString().slice(11, 19)}`;
}

renderPresets();
tickClock();
setInterval(tickClock, 1000);
connectStream();
