/**
 * MarineGlobe 3D — GitHub Pages Static Client Controller.
 * Runs the full GlobalAisSimulator directly in the browser by default, and
 * optionally connects to a deployed MarineGlobe Node.js backend SSE stream
 * for live AISStream.io global vessel tracking.
 */

import { GlobeEngine } from './globe-engine.js';
import { GlobalAisSimulator } from './ais-simulator.js';
import { VESSEL_TYPES, CAMERA_PRESETS } from './world-data.js';

const simulator = new GlobalAisSimulator();

const state = {
  mode: 'local-sim', // 'local-sim' | 'remote-sse'
  backendUrl: '',
  eventSource: null,
  vesselsMap: new Map(),
  allVessels: [],
  filteredVessels: [],
  selectedMmsi: null,
  followSelected: false,
  activeType: 'all',
  searchQuery: '',
  theme: 'dark',
  paused: false,
  timeScale: 120,
};

const dom = {
  canvas: document.getElementById('globe-canvas'),
  presetBar: document.getElementById('preset-bar'),
  sidebar: document.getElementById('sidebar'),
  btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
  searchInput: document.getElementById('search-input'),
  filterGrid: document.getElementById('filter-grid'),
  filteredCount: document.getElementById('filtered-count'),
  utcClock: document.getElementById('utc-clock'),
  vesselList: document.getElementById('vessel-list'),
  statusDot: document.getElementById('status-dot'),
  statusMode: document.getElementById('status-mode'),
  statVessels: document.getElementById('stat-vessels'),
  statRateWrap: document.getElementById('stat-rate-wrap'),
  statRate: document.getElementById('stat-rate'),
  inspector: document.getElementById('inspector'),
  inspName: document.getElementById('insp-name'),
  inspSub: document.getElementById('insp-sub'),
  inspOrigin: document.getElementById('insp-origin'),
  inspDest: document.getElementById('insp-dest'),
  inspCoords: document.getElementById('insp-coords'),
  inspNav: document.getElementById('insp-nav'),
  inspIds: document.getElementById('insp-ids'),
  inspFlag: document.getElementById('insp-flag'),
  inspDim: document.getElementById('insp-dim'),
  inspEta: document.getElementById('insp-eta'),
  btnCloseInspector: document.getElementById('btn-close-inspector'),
  btnFollowVessel: document.getElementById('btn-follow-vessel'),
  btnCenterVessel: document.getElementById('btn-center-vessel'),
  btnZoomIn: document.getElementById('btn-zoom-in'),
  btnZoomOut: document.getElementById('btn-zoom-out'),
  btnAutoRotate: document.getElementById('btn-autorotate'),
  btnDayNight: document.getElementById('btn-daynight'),
  btnLanes: document.getElementById('btn-lanes'),
  btnWakes: document.getElementById('btn-wakes'),
  btnPorts: document.getElementById('btn-ports'),
  btnPause: document.getElementById('btn-pause'),
  speedSelect: document.getElementById('speed-select'),
  coordReadout: document.getElementById('coord-readout'),
  hoverTooltip: document.getElementById('hover-tooltip'),
  btnTheme: document.getElementById('btn-theme'),
  btnApiConfig: document.getElementById('btn-api-config'),
  apiModal: document.getElementById('api-modal'),
  backendUrlInput: document.getElementById('backend-url'),
  modalError: document.getElementById('modal-error'),
  btnSwitchSim: document.getElementById('btn-switch-sim'),
  btnCancelModal: document.getElementById('btn-cancel-modal'),
  btnSaveApi: document.getElementById('btn-save-api'),
};

function formatCoordShort(val, isLat) {
  const hemi = isLat ? (val >= 0 ? 'N' : 'S') : (val >= 0 ? 'E' : 'W');
  return `${Math.abs(val).toFixed(2)}°${hemi}`;
}

function escapeHtml(str) {
  return String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

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
    const meta = VESSEL_TYPES[vessel.type] || VESSEL_TYPES.bulk;
    dom.hoverTooltip.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px;font-weight:700;">
        <span class="type-dot" style="background:${meta.color}"></span>
        <span>${escapeHtml(vessel.name)}</span>
      </div>
      <div style="color:var(--text-muted);margin-top:2px;">
        ${meta.label} · ${escapeHtml(vessel.flagName || vessel.flagCode)}
      </div>
      <div class="mono" style="margin-top:3px;">
        ${vessel.sog} kn · ${vessel.cog}° · ${escapeHtml(vessel.destination || '-')}
      </div>
    `;
    dom.hoverTooltip.style.left = `${Math.min(window.innerWidth - 250, mx + 14)}px`;
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
    updateFollowButton();
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

function applyFiltersAndRender() {
  const q = state.searchQuery;
  state.filteredVessels = state.allVessels.filter((v) => {
    if (state.activeType !== 'all' && v.type !== state.activeType) return false;
    if (!q) return true;
    return (
      v.name.toLowerCase().includes(q) ||
      v.mmsi.includes(q) ||
      (v.imo && v.imo.includes(q)) ||
      (v.destination && v.destination.toLowerCase().includes(q)) ||
      (v.origin && v.origin.toLowerCase().includes(q)) ||
      (v.flagName && v.flagName.toLowerCase().includes(q))
    );
  });

  dom.statVessels.textContent = state.allVessels.length;
  globe.setVessels(state.filteredVessels);
  renderFilterChips();
  renderVesselList();
  renderInspector();
}

function renderVesselList() {
  dom.filteredCount.textContent = `표시 중: ${state.filteredVessels.length}척`;
  const slice = state.filteredVessels.slice(0, 90);
  if (slice.length === 0) {
    dom.vesselList.innerHTML = `<div style="padding:20px;text-align:center;color:var(--text-muted);">조건에 일치하는 선박이 없습니다.</div>`;
    return;
  }

  dom.vesselList.innerHTML = slice
    .map((v) => {
      const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
      const sel = v.mmsi === state.selectedMmsi ? 'selected' : '';
      return `
        <button class="vessel-item ${sel}" data-mmsi="${v.mmsi}" role="listitem">
          <div class="vessel-item-top">
            <span class="vessel-name">
              <span class="type-dot" style="background:${meta.color}"></span>
              ${escapeHtml(v.name)}
            </span>
            <span class="vessel-speed mono">${v.sog} kn</span>
          </div>
          <div class="vessel-item-sub">
            <span>${meta.short} · ${escapeHtml(v.flagName || v.flagCode)}</span>
            <span class="mono">${escapeHtml(v.origin || 'AIS')} → ${escapeHtml(v.destination || '-')}</span>
          </div>
        </button>
      `;
    })
    .join('');
}

dom.vesselList.addEventListener('click', (e) => {
  const item = e.target.closest('[data-mmsi]');
  if (item) selectVessel(item.dataset.mmsi, true);
});

function selectVessel(mmsi, fly = false) {
  state.selectedMmsi = mmsi;
  const v = state.vesselsMap.get(mmsi);
  if (!v) return;
  globe.setSelectedVessel(mmsi, state.followSelected);
  if (fly) globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 2.8), 700);
  renderVesselList();
  renderInspector();
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
  const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
  dom.inspector.classList.remove('hidden');
  dom.inspName.textContent = v.name;
  dom.inspSub.innerHTML = `<span class="type-dot" style="background:${meta.color};display:inline-block;margin-right:5px;"></span>${meta.label} · ${escapeHtml(v.corridorName || '글로벌 항로')}`;
  dom.inspOrigin.textContent = v.origin || 'LIVE';
  dom.inspDest.textContent = v.destination || '미지정';
  dom.inspCoords.textContent = `${formatCoordShort(v.lat, true)}, ${formatCoordShort(v.lon, false)}`;
  dom.inspNav.textContent = `${v.sog} kn / ${v.cog}° (HDG ${v.heading}°)`;
  dom.inspIds.textContent = `${v.mmsi} / ${v.imo || '-'}`;
  dom.inspFlag.textContent = `${v.callsign || '-'} · ${v.flagName || v.flagCode}`;
  dom.inspDim.textContent =
    v.length && v.beam
      ? `${v.length}m × ${v.beam}m / ${v.draught ?? '-'}m`
      : `흘수 ${v.draught ?? '-'}m`;
  dom.inspEta.textContent = `${v.navStatus || '항해 중'} · ${v.eta || '-'}`;
  updateFollowButton();
}

function updateFollowButton() {
  dom.btnFollowVessel.textContent = state.followSelected ? '추적 잠금 해제' : '카메라 추적 잠금';
  dom.btnFollowVessel.classList.toggle('active', state.followSelected);
}

dom.btnCloseInspector.addEventListener('click', () => {
  state.selectedMmsi = null;
  state.followSelected = false;
  globe.setSelectedVessel(null, false);
  renderVesselList();
  renderInspector();
});
dom.btnFollowVessel.addEventListener('click', () => {
  if (!state.selectedMmsi) return;
  state.followSelected = !state.followSelected;
  globe.setSelectedVessel(state.selectedMmsi, state.followSelected);
  updateFollowButton();
});
dom.btnCenterVessel.addEventListener('click', () => {
  const v = state.vesselsMap.get(state.selectedMmsi);
  if (v) globe.flyTo(v.lat, v.lon, Math.max(globe.zoom, 3.4), 600);
});

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

dom.btnTheme.addEventListener('click', () => {
  state.theme = state.theme === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('theme-light', state.theme === 'light');
  dom.btnTheme.textContent = state.theme === 'dark' ? '☀' : '☾';
  globe.setTheme(state.theme);
});

dom.btnPause.addEventListener('click', () => {
  state.paused = !state.paused;
  dom.btnPause.textContent = state.paused ? '재생' : '일시정지';
  dom.btnPause.classList.toggle('active', state.paused);
});
dom.speedSelect.addEventListener('change', (e) => {
  state.timeScale = Number(e.target.value);
});

// Remote Backend Modal
dom.btnApiConfig.addEventListener('click', () => {
  dom.modalError.style.display = 'none';
  dom.backendUrlInput.value = state.backendUrl;
  dom.apiModal.classList.remove('hidden');
});
dom.btnCancelModal.addEventListener('click', () => dom.apiModal.classList.add('hidden'));
dom.btnSwitchSim.addEventListener('click', () => {
  disconnectRemote();
  dom.apiModal.classList.add('hidden');
});
dom.btnSaveApi.addEventListener('click', () => {
  const url = dom.backendUrlInput.value.trim().replace(/\/+$/, '');
  if (!url || !/^https?:\/\//.test(url)) {
    dom.modalError.textContent = '올바른 http:// 또는 https:// 백엔드 URL을 입력하세요.';
    dom.modalError.style.display = 'block';
    return;
  }
  connectRemote(url);
  dom.apiModal.classList.add('hidden');
});

function ingestVessels(vessels, replaceAll = false) {
  if (replaceAll) state.vesselsMap.clear();
  for (const v of vessels) state.vesselsMap.set(v.mmsi, v);
  state.allVessels = Array.from(state.vesselsMap.values());
  applyFiltersAndRender();
}

function disconnectRemote() {
  if (state.eventSource) {
    state.eventSource.close();
    state.eventSource = null;
  }
  state.mode = 'local-sim';
  state.backendUrl = '';
  dom.statusDot.className = 'status-dot sim';
  dom.statusMode.textContent = 'SIM';
  dom.statRateWrap.style.display = 'none';
  dom.speedSelect.disabled = false;
  ingestVessels(simulator.getSnapshot(), true);
}

function connectRemote(baseUrl) {
  disconnectRemote();
  state.mode = 'remote-sse';
  state.backendUrl = baseUrl;
  dom.statusDot.className = 'status-dot sim';
  dom.statusMode.textContent = '연결 중...';
  dom.statRateWrap.style.display = '';
  dom.speedSelect.disabled = true;

  const es = new EventSource(`${baseUrl}/api/stream`);
  state.eventSource = es;

  es.addEventListener('snapshot', (e) => {
    const data = JSON.parse(e.data);
    ingestVessels(data.vessels || [], true);
    if (data.status) {
      dom.statusDot.className = 'status-dot';
      dom.statusMode.textContent = data.status.mode === 'aisstream' ? 'LIVE AIS' : 'REMOTE SIM';
      dom.statRate.textContent = data.status.msgPerSec ?? 0;
    }
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
    const st = JSON.parse(e.data);
    dom.statRate.textContent = st.msgPerSec ?? 0;
    dom.statusDot.className = st.connectionState === 'error' ? 'status-dot error' : 'status-dot';
    dom.statusMode.textContent = st.mode === 'aisstream' ? 'LIVE AIS' : 'REMOTE SIM';
  });
  es.onerror = () => {
    dom.statusDot.className = 'status-dot error';
    dom.statusMode.textContent = '재연결 중';
  };
}

// Local real-time simulator loop (60 FPS smooth movement when in local-sim mode)
let lastStep = performance.now();
let lastInspectorSync = 0;

function simTick(ts) {
  const dt = Math.min(0.1, (ts - lastStep) / 1000);
  lastStep = ts;
  if (state.mode === 'local-sim' && !state.paused) {
    simulator.step(dt, state.timeScale);
    if (ts - lastInspectorSync > 500) {
      lastInspectorSync = ts;
      if (state.selectedMmsi) renderInspector();
    }
  }
  requestAnimationFrame(simTick);
}

function tickClock() {
  dom.utcClock.textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
}

// Also enable CORS-free sharing of live simulator vessel array directly
function initLocalSim() {
  const vessels = simulator.vessels;
  state.vesselsMap.clear();
  for (const v of vessels) state.vesselsMap.set(v.mmsi, v);
  state.allVessels = vessels;
  applyFiltersAndRender();
}

renderPresets();
initLocalSim();
tickClock();
setInterval(tickClock, 1000);
requestAnimationFrame(simTick);
