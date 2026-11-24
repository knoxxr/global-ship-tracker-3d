/**
 * Shared UI Controller for MarineGlobe 3D (used by both Node.js SSE app.js and GitHub Pages pages-app.js).
 * Centralizes preferences persistence, URL deep-linking, mobile drawer/bottom-sheet gestures,
 * favorites, sortable/searchable fleet table, layer toggles, keyboard shortcuts, and PWA SW registration.
 */

import { VESSEL_TYPES } from './world-data.js';
import { sortVesselsByColumn, exportVesselsCsv } from './telemetry-ui.js';
import {
  t,
  applyStaticI18n,
  getVesselTypeLabel,
  getPortDisplayName,
} from './i18n.js';

export const PREFS_KEY = 'marineglobe_prefs_v1';

export const isMobileViewport = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;

export function loadPrefs() {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function persistPrefs(state, globe, extra = {}) {
  try {
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        theme: state.theme,
        lang: state.lang || 'en',
        movingOnly: state.movingOnly,
        sortBy: state.sortBy,
        favorites: Array.from(state.favorites),
        ...extra,
        layers: {
          showClusters: globe.options.showClusters,
          showBorders: globe.options.showBorders,
          autoRotate: globe.options.autoRotate,
          showDayNight: globe.options.showDayNight,
          showWakes: globe.options.showWakes,
          showChartTiles: globe.options.showChartTiles,
          showPorts: globe.options.showPorts,
          showLabels: globe.options.showLabels,
        },
      })
    );
  } catch {
    // ignore private browsing quota errors
  }
}

export function parseHashDeepLink() {
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

export function createToast(toastEl) {
  let timer = null;
  return (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(timer);
    timer = setTimeout(() => toastEl.classList.add('hidden'), 2200);
  };
}

export function queryCommonDom() {
  return {
    canvas: document.getElementById('globe-canvas'),
    presetBar: document.getElementById('preset-bar'),
    sidebar: document.getElementById('sidebar'),
    btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),
    btnCloseSidebar: document.getElementById('btn-close-sidebar'),
    mobileBackdrop: document.getElementById('mobile-backdrop'),
    searchInput: document.getElementById('search-input'),
    filterGrid: document.getElementById('filter-grid'),
    portFilterBanner: document.getElementById('port-filter-banner'),
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
    btnMeasure: document.getElementById('btn-measure'),
    btnShareView: document.getElementById('btn-share-view'),
    btnSnapshot: document.getElementById('btn-snapshot'),
    btnClusters: document.getElementById('btn-clusters'),
    btnMovingOnly: document.getElementById('btn-moving-only'),
    btnCharts: document.getElementById('btn-charts'),
    btnBorders: document.getElementById('btn-borders'),
    btnAutoRotate: document.getElementById('btn-autorotate'),
    btnDayNight: document.getElementById('btn-daynight'),
    btnWakes: document.getElementById('btn-wakes'),
    btnPorts: document.getElementById('btn-ports'),
    btnLabels: document.getElementById('btn-labels'),
    coordReadout: document.getElementById('coord-readout'),
    hoverTooltip: document.getElementById('hover-tooltip'),
    toastNotice: document.getElementById('toast-notice'),
    btnLang: document.getElementById('btn-lang'),
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
    modalError: document.getElementById('modal-error'),
    btnCancelModal: document.getElementById('btn-cancel-modal'),
    btnSaveApi: document.getElementById('btn-save-api'),
  };
}

export function haversineNmSimple(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const dp = (lat2 - lat1) * r;
  const dl = (lon2 - lon1) * r;
  const a =
    Math.sin(dp / 2) ** 2 +
    Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dl / 2) ** 2;
  return 3440.065 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

const marineWeatherCache = new Map(); // gridKey -> { data, ts }
const WEATHER_CACHE_TTL_MS = 10 * 60 * 1000;

/**
 * Fetches live wave height, period, sea surface temperature, and wind speed/direction
 * from the free, keyless Open-Meteo Marine + Forecast APIs with 10-minute 0.25° grid caching.
 */
export async function fetchMarineWeather(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const gLat = (Math.round(lat * 4) / 4).toFixed(2);
  const gLon = (Math.round(lon * 4) / 4).toFixed(2);
  const key = `${gLat},${gLon}`;
  const hit = marineWeatherCache.get(key);
  if (hit && Date.now() - hit.ts < WEATHER_CACHE_TTL_MS) {
    return hit.data;
  }

  try {
    const [marineRes, windRes] = await Promise.allSettled([
      fetch(
        `https://marine-api.open-meteo.com/v1/marine?latitude=${gLat}&longitude=${gLon}&current=wave_height,wave_direction,wave_period,sea_surface_temperature`
      ),
      fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${gLat}&longitude=${gLon}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn`
      ),
    ]);

    const data = {
      waveHeight: null,
      wavePeriod: null,
      waveDir: null,
      seaTemp: null,
      windKn: null,
      windDir: null,
    };
    let hasAny = false;

    if (marineRes.status === 'fulfilled' && marineRes.value.ok) {
      const m = await marineRes.value.json();
      const cur = m?.current || {};
      if (cur.wave_height != null) { data.waveHeight = Number(cur.wave_height); hasAny = true; }
      if (cur.wave_period != null) { data.wavePeriod = Number(cur.wave_period); hasAny = true; }
      if (cur.wave_direction != null) { data.waveDir = Number(cur.wave_direction); hasAny = true; }
      if (cur.sea_surface_temperature != null) { data.seaTemp = Number(cur.sea_surface_temperature); hasAny = true; }
    }
    if (windRes.status === 'fulfilled' && windRes.value.ok) {
      const w = await windRes.value.json();
      const cur = w?.current || {};
      if (cur.wind_speed_10m != null) { data.windKn = Number(cur.wind_speed_10m); hasAny = true; }
      if (cur.wind_direction_10m != null) { data.windDir = Number(cur.wind_direction_10m); hasAny = true; }
    }

    const result = hasAny ? data : null;
    if (marineWeatherCache.size > 200) {
      marineWeatherCache.delete(marineWeatherCache.keys().next().value);
    }
    marineWeatherCache.set(key, { data: result, ts: Date.now() });
    return result;
  } catch {
    return null;
  }
}

/**
 * Tracks favorite (★) vessels' moving vs moored state and emits departure/arrival notifications.
 */
export function createFavoriteMonitor(onEvent) {
  const prevState = new Map(); // mmsi -> boolean (moving)
  return (vesselsMap, favorites) => {
    const events = [];
    if (!favorites || favorites.size === 0) return events;
    for (const mmsi of favorites) {
      const v = vesselsMap.get(mmsi);
      if (!v) continue;
      const moving = (Number(v.sog) || 0) >= 0.5;
      if (prevState.has(mmsi)) {
        const wasMoving = prevState.get(mmsi);
        if (wasMoving !== moving) {
          const ev = {
            mmsi,
            name: v.name || `MMSI ${mmsi}`,
            type: moving ? 'departed' : 'moored',
            sog: Number(v.sog) || 0,
          };
          events.push(ev);
          if (onEvent) onEvent(ev);
        }
      }
      prevState.set(mmsi, moving);
    }
    return events;
  };
}

export function renderPortFilterBanner(bannerEl, portFilter, filteredVessels) {
  if (!bannerEl) return;
  if (!portFilter) {
    bannerEl.classList.add('hidden');
    bannerEl.innerHTML = '';
    return;
  }
  let moving = 0;
  for (const v of filteredVessels) {
    if ((v.sog || 0) >= 0.5) moving++;
  }
  const moored = filteredVessels.length - moving;
  const safeName = String(getPortDisplayName(portFilter) || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');
  bannerEl.classList.remove('hidden');
  bannerEl.innerHTML = `
    <div class="port-banner-info">
      <strong>⚓ ${safeName} (${portFilter.radiusNm || 15}NM)</strong>
      <span class="mono">${t('portBannerStats', { moving, moored })}</span>
    </div>
    <button id="btn-clear-port-filter" class="btn btn-icon" type="button" title="${t('portClearTitle')}" aria-label="${t('portClearTitle')}">✕</button>
  `;
}

export function buildFilterChipsHtml(allVessels, activeType, favorites) {
  const counts = { all: allVessels.length, favorites: 0 };
  for (const key of Object.keys(VESSEL_TYPES)) counts[key] = 0;
  for (const v of allVessels) {
    if (counts[v.type] !== undefined) counts[v.type]++;
    if (favorites.has(v.mmsi)) counts.favorites++;
  }

  let html = `<button class="filter-chip ${activeType === 'all' ? 'active' : ''}" data-type="all">${t('allFilter')} <span class="mono">${counts.all.toLocaleString()}</span></button>`;
  if (favorites.size > 0 || activeType === 'favorites') {
    html += `<button class="filter-chip ${activeType === 'favorites' ? 'active' : ''}" data-type="favorites"><span class="fav-star">★</span> ${t('favFilter')} <span class="mono">${counts.favorites.toLocaleString()}</span></button>`;
  }
  for (const [key, meta] of Object.entries(VESSEL_TYPES)) {
    html += `
      <button class="filter-chip ${activeType === key ? 'active' : ''}" data-type="${key}">
        <span class="type-dot" style="background:${meta.color}"></span>
        ${getVesselTypeLabel(meta, true)} <span class="mono">${counts[key].toLocaleString()}</span>
      </button>
    `;
  }
  return html;
}

export function filterVesselsList(allVessels, { movingOnly, activeType, searchQuery, favorites, portFilter }) {
  const q = searchQuery;
  return allVessels.filter((v) => {
    if (movingOnly && (v.sog || 0) < 0.5) return false;
    if (portFilter) {
      const dist = haversineNmSimple(v.lat, v.lon, portFilter.lat, portFilter.lon);
      if (dist > (portFilter.radiusNm || 15)) return false;
    }
    if (activeType === 'favorites') {
      if (!favorites.has(v.mmsi)) return false;
    } else if (activeType !== 'all' && v.type !== activeType) {
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
}

export function filterAndSortTableVessels(filteredVessels, { tableSearchQuery, tableSortCol, tableSortDir }) {
  const tq = tableSearchQuery;
  const base = tq
    ? filteredVessels.filter(
        (v) =>
          v.name.toLowerCase().includes(tq) ||
          v.mmsi.includes(tq) ||
          (v.imo && v.imo.includes(tq)) ||
          (v.callsign && v.callsign.toLowerCase().includes(tq)) ||
          (v.destination && v.destination.toLowerCase().includes(tq)) ||
          (v.flagName && v.flagName.toLowerCase().includes(tq))
      )
    : filteredVessels;
  return sortVesselsByColumn(base, tableSortCol, tableSortDir);
}

export function updateTableSortIndicators(theadEl, col, dir) {
  if (!theadEl) return;
  theadEl.querySelectorAll('th[data-sort-col]').forEach((th) => {
    const active = th.dataset.sortCol === col;
    th.classList.toggle('sort-active', active);
    th.classList.toggle('sort-asc', active && dir === 'asc');
    th.classList.toggle('sort-desc', active && dir === 'desc');
  });
}

export function bindSharedUi({
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
  onLangChange,
}) {
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

  // Virtual scroll listeners
  dom.vesselList.addEventListener('scroll', () => renderVisibleList(), { passive: true });
  dom.fleetTableWrap.addEventListener('scroll', () => {
    if (state.fleetModalOpen) renderFleetTable(false);
  }, { passive: true });

  // Sidebar filters, search, sort & list clicks
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
  dom.vesselList.addEventListener('click', (e) => {
    const item = e.target.closest('[data-mmsi]');
    if (item) {
      if (isMobileViewport()) setSidebarOpen(false);
      selectVessel(item.dataset.mmsi, true);
    }
  });

  // Inspector actions (handle, favorite, close, follow, center, share deep-link)
  dom.inspector.addEventListener('click', (e) => {
    if (e.target.closest('#inspector-handle')) {
      dom.inspector.classList.toggle('expanded');
      return;
    }
    if (e.target.closest('#btn-favorite-vessel')) {
      if (!state.selectedMmsi) return;
      if (state.favorites.has(state.selectedMmsi)) {
        state.favorites.delete(state.selectedMmsi);
        showToast(t('toastFavRemoved'));
      } else {
        state.favorites.add(state.selectedMmsi);
        showToast(t('toastFavAdded'));
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
    if (e.target.closest('#btn-measure-from-vessel')) {
      const v = state.vesselsMap.get(state.selectedMmsi);
      if (!v) return;
      if (isMobileViewport()) dom.inspector.classList.remove('expanded');
      globe.setMeasureMode(true, {
        lat: v.lat,
        lon: v.lon,
        label: v.name,
        speedKn: Number(v.sog) || 0,
      });
      if (dom.btnMeasure) dom.btnMeasure.classList.add('active');
      showToast(t('toastMeasureFromVessel', { name: v.name }));
      return;
    }
    if (e.target.closest('#btn-share-vessel')) {
      const v = state.vesselsMap.get(state.selectedMmsi);
      if (!v) return;
      const z = Math.max(6, Math.round(globe.zoom * 10) / 10);
      const hash = `#mmsi=${encodeURIComponent(v.mmsi)}&lat=${v.lat.toFixed(4)}&lon=${v.lon.toFixed(4)}&z=${z}`;
      const shareUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
      try {
        window.history.replaceState(null, '', hash);
      } catch { /* ignore */ }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(shareUrl)
          .then(() => showToast(t('toastVesselLinkCopied')))
          .catch(() => showToast(t('toastUrlUpdated')));
      } else {
        showToast(t('toastUrlUpdated'));
      }
    }
  });

  // Port 15NM geofence filter helper & clear button
  function setPortFilter(port) {
    state.portFilter = port
      ? { name: port.name, nameEn: port.nameEn, lat: port.lat, lon: port.lon, radiusNm: port.radiusNm || 15 }
      : null;
    globe.setActivePortFilter(state.portFilter);
    dom.vesselList.scrollTop = 0;
    if (state.portFilter) {
      globe.flyTo(port.lat, port.lon, Math.max(globe.zoom, 6.2), 650);
      setSidebarOpen(true);
      showToast(t('toastPortApplied', { name: getPortDisplayName(port), radius: state.portFilter.radiusNm }));
    } else {
      showToast(t('toastPortCleared'));
    }
    applyFiltersAndRender();
  }

  globe.onSelectPort = (port) => {
    if (state.portFilter && state.portFilter.name === port.name) {
      setPortFilter(null);
    } else {
      setPortFilter(port);
    }
  };

  if (dom.portFilterBanner) {
    dom.portFilterBanner.addEventListener('click', (e) => {
      if (e.target.closest('#btn-clear-port-filter')) {
        setPortFilter(null);
      }
    });
  }

  // Mobile bottom-sheet swipe gestures
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

  // Full Fleet Table Modal (column sort, modal search, CSV export)
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

  // Mobile Drawer & Zoom
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

  // Great-circle distance/bearing/ETA ruler toggle
  if (dom.btnMeasure) {
    dom.btnMeasure.addEventListener('click', () => {
      const next = !globe.measureMode;
      if (next) {
        const v = state.selectedMmsi ? state.vesselsMap.get(state.selectedMmsi) : null;
        const anchor = v
          ? { lat: v.lat, lon: v.lon, label: v.name, speedKn: Number(v.sog) || 0 }
          : null;
        globe.setMeasureMode(true, anchor);
        dom.btnMeasure.classList.add('active');
        showToast(
          anchor
            ? t('toastMeasureFromVessel', { name: anchor.label })
            : t('toastMeasureStart')
        );
      } else {
        globe.clearMeasure();
        dom.btnMeasure.classList.remove('active');
        showToast(t('toastMeasureEnd'));
      }
    });
  }

  // One-click current view / selected vessel deep-link share
  if (dom.btnShareView) {
    dom.btnShareView.addEventListener('click', () => {
      const params = new URLSearchParams();
      if (state.selectedMmsi) params.set('mmsi', state.selectedMmsi);
      params.set('lat', globe.centerLat.toFixed(4));
      params.set('lon', globe.centerLon.toFixed(4));
      params.set('z', (Math.round(globe.zoom * 10) / 10).toString());
      const hash = `#${params.toString()}`;
      const shareUrl = `${window.location.origin}${window.location.pathname}${window.location.search}${hash}`;
      try {
        window.history.replaceState(null, '', hash);
      } catch { /* ignore */ }
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(shareUrl)
          .then(() => showToast(t('toastViewLinkCopied')))
          .catch(() => showToast(t('toastUrlUpdated')));
      } else {
        showToast(t('toastUrlUpdated'));
      }
    });
  }

  // High-DPI PNG snapshot export
  if (dom.btnSnapshot) {
    dom.btnSnapshot.addEventListener('click', () => {
      try {
        const dataUrl = globe.exportPngDataUrl();
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `marineglobe-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        showToast(t('toastSnapshotSaved'));
      } catch {
        showToast(t('toastSnapshotErr'));
      }
    });
  }

  // Layer toggles (including high-zoom nautical chart tiles!)
  const LAYER_BINDINGS = [
    [dom.btnClusters, 'showClusters'],
    [dom.btnCharts, 'showChartTiles'],
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

  if (dom.btnMovingOnly) {
    dom.btnMovingOnly.addEventListener('click', () => {
      state.movingOnly = !state.movingOnly;
      dom.btnMovingOnly.classList.toggle('active', state.movingOnly);
      savePrefs();
      dom.vesselList.scrollTop = 0;
      applyFiltersAndRender();
    });
  }

  // EN / KO Language Toggle (English default)
  if (dom.btnLang) {
    dom.btnLang.addEventListener('click', () => {
      state.lang = state.lang === 'en' ? 'ko' : 'en';
      applyStaticI18n(state.lang);
      globe.setLang(state.lang);
      savePrefs();
      if (dom.inspector) dom.inspector._lastHtml = null;
      if (typeof onLangChange === 'function') onLangChange(state.lang);
      applyFiltersAndRender();
      showToast(t('toastLangSwitched'));
    });
  }

  dom.btnTheme.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    document.body.classList.toggle('theme-light', state.theme === 'light');
    dom.btnTheme.textContent = state.theme === 'dark' ? '☀' : '☾';
    globe.setTheme(state.theme);
    savePrefs();
  });

  // Keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.key === 'Escape') {
      if (state.fleetModalOpen) {
        state.fleetModalOpen = false;
        dom.fleetModal.classList.add('hidden');
      } else if (!dom.apiModal.classList.contains('hidden')) {
        dom.apiModal.classList.add('hidden');
      } else if (globe.measureMode) {
        globe.clearMeasure();
        if (dom.btnMeasure) dom.btnMeasure.classList.remove('active');
      } else if (state.portFilter) {
        setPortFilter(null);
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

  // Restore saved UI preferences & language on boot
  applyStaticI18n(state.lang || 'en');
  globe.setLang(state.lang || 'en');
  if (state.theme === 'light') {
    document.body.classList.add('theme-light');
    dom.btnTheme.textContent = '☾';
  }
  if (state.movingOnly && dom.btnMovingOnly) {
    dom.btnMovingOnly.classList.add('active');
  }
  if (dom.sortSelect) {
    dom.sortSelect.value = state.sortBy;
  }
  if (isMobileViewport()) {
    setSidebarOpen(false);
  }

  return { setSidebarOpen, closeInspector, setPortFilter };
}

export function registerAppServiceWorker(swUrl = './sw.js') {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register(swUrl).catch(() => {});
    });
  }
}
