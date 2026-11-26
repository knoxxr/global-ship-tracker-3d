/**
 * MarineGlobe 3D — High-DPI Interactive 3D Spherical Nautical Globe Engine.
 * Features:
 *  - High-resolution Natural Earth 50m coastlines, 110m country borders & major lakes
 *  - 3D bounding-sphere culling for locked 60 FPS across 23,000+ coastline vertices
 *  - Smart screen-space clustering for 35,000+ live vessels (click cluster to zoom in)
 *  - Progressive gradient AIS wake trails + kinematic stern wakes for moving ships
 *  - Zoom range up to 18x with adaptive graticule, nautical sea labels, and 38 world ports
 */

import {
  WORLD_POLYGONS,
  COUNTRY_BORDERS,
  WORLD_LAKES,
  PORTS_DATA,
  SEA_LABELS,
  VESSEL_TYPES,
} from './world-data.js';
import { SHIPPING_LANES } from './shipping-lanes.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

function latLonToVec3(lat, lon) {
  const phi = lat * DEG2RAD;
  const lam = lon * DEG2RAD;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lam), Math.sin(phi), cosPhi * Math.sin(lam)];
}

/**
 * Prepare a polygon or polyline into radian pairs + 3D bounding sphere for fast O(1) culling.
 */
function preparePath(coords, isClosed, maxStepDeg = 4.5) {
  const pts = [];
  const len = coords.length;
  const limit = isClosed ? len : len - 1;

  for (let i = 0; i < limit; i++) {
    const [lon1, lat1] = coords[i];
    const [lon2, lat2] = coords[(i + 1) % len];
    pts.push([lat1 * DEG2RAD, lon1 * DEG2RAD]);

    let dLon = lon2 - lon1;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const dLat = lat2 - lat1;
    const span = Math.hypot(dLon, dLat);
    if (span > maxStepDeg) {
      const steps = Math.ceil(span / maxStepDeg);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        pts.push([(lat1 + dLat * t) * DEG2RAD, (lon1 + dLon * t) * DEG2RAD]);
      }
    }
  }
  if (!isClosed && len > 0) {
    const [lonL, latL] = coords[len - 1];
    pts.push([latL * DEG2RAD, lonL * DEG2RAD]);
  }

  // Compute approximate 3D centroid & angular radius for fast culling
  let sx = 0, sy = 0, sz = 0;
  for (let i = 0; i < pts.length; i++) {
    const phi = pts[i][0], lam = pts[i][1];
    const cp = Math.cos(phi);
    sx += cp * Math.cos(lam);
    sy += Math.sin(phi);
    sz += cp * Math.sin(lam);
  }
  const mag = Math.hypot(sx, sy, sz) || 1;
  const cx = sx / mag, cy = sy / mag, cz = sz / mag;
  let minDot = 1;
  for (let i = 0; i < pts.length; i++) {
    const phi = pts[i][0], lam = pts[i][1];
    const cp = Math.cos(phi);
    const dot = cx * (cp * Math.cos(lam)) + cy * Math.sin(phi) + cz * (cp * Math.sin(lam));
    if (dot < minDot) minDot = dot;
  }
  const cPhi = Math.asin(Math.max(-1, Math.min(1, cy)));
  const cLam = Math.atan2(cz, cx);
  const sinRadius = Math.sqrt(Math.max(0, 1 - minDot * minDot));
  const isHuge = minDot < 0.25; // Continents like Eurasia/Antarctica always tested vertex-wise

  return { pts, cPhi, cLam, sinRadius, isHuge };
}

function getSubsolarRad(date = new Date()) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (date.getTime() - startOfYear) / 86400000;
  const decDeg = -23.44 * Math.cos(((2 * Math.PI) / 365.25) * (dayOfYear + 10));
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  const lonDeg = (((12 - utcHours) * 15 + 180) % 360 + 360) % 360 - 180;
  return { phi: decDeg * DEG2RAD, lam: lonDeg * DEG2RAD };
}

function formatClusterCount(n) {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const EARTH_RADIUS_NM = 3440.065;

function _haversineNm(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dp = (lat2 - lat1) * DEG2RAD;
  const dl = (lon2 - lon1) * DEG2RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return EARTH_RADIUS_NM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}

function _initialBearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const dl = (lon2 - lon1) * DEG2RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (Math.atan2(y, x) * RAD2DEG + 360) % 360;
}

function _destinationPoint(lat, lon, bearingDeg, distanceNm) {
  const delta = distanceNm / EARTH_RADIUS_NM;
  const theta = bearingDeg * DEG2RAD;
  const p1 = lat * DEG2RAD;
  const l1 = lon * DEG2RAD;
  const sinP2 = Math.sin(p1) * Math.cos(delta) + Math.cos(p1) * Math.sin(delta) * Math.cos(theta);
  const p2 = Math.asin(Math.max(-1, Math.min(1, sinP2)));
  const y = Math.sin(theta) * Math.sin(delta) * Math.cos(p1);
  const x = Math.cos(delta) - Math.sin(p1) * sinP2;
  let lon2 = ((l1 + Math.atan2(y, x)) * RAD2DEG + 180) % 360;
  if (lon2 < 0) lon2 += 360;
  return { lat: Math.max(-85, Math.min(85, p2 * RAD2DEG)), lon: lon2 - 180 };
}

function _slerpLatLon(lat1, lon1, lat2, lon2, t) {
  if (t <= 0) return { lat: lat1, lon: lon1 };
  if (t >= 1) return { lat: lat2, lon: lon2 };
  const p1 = lat1 * DEG2RAD;
  const l1 = lon1 * DEG2RAD;
  const p2 = lat2 * DEG2RAD;
  const l2 = lon2 * DEG2RAD;
  const x1 = Math.cos(p1) * Math.cos(l1), y1 = Math.cos(p1) * Math.sin(l1), z1 = Math.sin(p1);
  const x2 = Math.cos(p2) * Math.cos(l2), y2 = Math.cos(p2) * Math.sin(l2), z2 = Math.sin(p2);
  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const omega = Math.acos(dot);
  if (omega < 1e-6) return { lat: lat1 + (lat2 - lat1) * t, lon: lon1 + (lon2 - lon1) * t };
  const s = Math.sin(omega);
  const w1 = Math.sin((1 - t) * omega) / s;
  const w2 = Math.sin(t * omega) / s;
  const x = w1 * x1 + w2 * x2, y = w1 * y1 + w2 * y2, z = w1 * z1 + w2 * z2;
  return { lat: Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG, lon: Math.atan2(y, x) * RAD2DEG };
}

export class GlobeEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelectVessel = options.onSelectVessel || (() => {});
    this.onHoverVessel = options.onHoverVessel || (() => {});
    this.onHoverCluster = options.onHoverCluster || (() => {});
    this.onCameraChange = options.onCameraChange || (() => {});
    this.onSelectPort = options.onSelectPort || (() => {});
    this.onSelectVos = options.onSelectVos || (() => {});
    this.onHoverVos = options.onHoverVos || (() => {});
    this.onMeasureChange = options.onMeasureChange || (() => {});

    // Camera state (degrees) — deep zoom up to 1500x (harbor & terminal level!)
    this.centerLat = options.initialLat ?? 28;
    this.centerLon = options.initialLon ?? 124;
    this.zoom = options.initialZoom ?? 1.4;
    this.minZoom = 0.85;
    this.maxZoom = 1500.0;

    this.velLon = 0;
    this.velLat = 0;
    this.flyTarget = null;
    this.isDragging = false;
    this.isPinching = false;
    this.dragMoved = false;
    this.lastPointer = { x: 0, y: 0 };
    this.pointerDownPos = { x: 0, y: 0 };
    this._pointers = new Map();
    this._pinchDist = 0;
    this._pinchMid = { x: 0, y: 0 };
    this._lastTouchTap = { time: 0, x: 0, y: 0 };

    // Great-circle ruler & port geofence filter states
    this.lang = options.lang === 'ko' ? 'ko' : 'en';
    this.measureMode = false;
    this.measurePoints = []; // [{ lat, lon, label?, speedKn? }]
    this.activePortFilter = null; // { name, nameEn?, lat, lon, radiusNm }
    this.screenPorts = [];

    // Layer toggles
    this.options = {
      autoRotate: false,
      showDayNight: true,
      showLanes: true,
      showVosShips: true,
      showPorts: true,
      showWakes: true,
      showClusters: true,
      showBorders: true,
      showLabels: false,
      showGraticule: true,
      showChartTiles: true,
      theme: options.theme || 'dark',
    };

    // Data state
    this.vessels = [];
    this.vosShips = [];
    this.selectedMmsi = null;
    this.selectedVosId = null;
    this.hoveredMmsi = null;
    this.hoveredVosId = null;
    this.hoveredClusterId = null;
    this.followSelected = false;
    this.screenVessels = [];
    this.screenVosShips = [];
    this.screenClusters = [];

    // Boot immediately with lightweight coastlines (~62KB), then lazy-upgrade to full 50m world-geo.js
    this.preparedPolygons = WORLD_POLYGONS.map((ring) => preparePath(ring, true, 4.5));
    this.preparedBorders = COUNTRY_BORDERS.map((line) => preparePath(line, false, 4.5));
    this.preparedLakes = WORLD_LAKES.map((ring) => preparePath(ring, true, 4.5));
    const prepFlatLane = (flat) => {
      const pairs = [];
      for (let i = 0; i < flat.length; i += 2) pairs.push([flat[i], flat[i + 1]]);
      return preparePath(pairs, false, 3.0);
    };
    this.preparedShippingLanes = {
      major: (SHIPPING_LANES.major || []).map(prepFlatLane),
      middle: (SHIPPING_LANES.middle || []).map(prepFlatLane),
      minor: (SHIPPING_LANES.minor || []).map(prepFlatLane),
    };
    this._highResGeoLoaded = false;

    // On-demand high-zoom nautical chart + OpenSeaMap seamark tile cache (LRU)
    this._tileCache = new Map();

    // Subtle background starfield
    this.stars = Array.from({ length: 140 }, (_, i) => {
      const s1 = Math.sin(i * 127.1) * 43758.5453;
      const s2 = Math.sin(i * 269.5) * 43758.5453;
      const s3 = Math.sin(i * 419.2) * 43758.5453;
      return {
        nx: s1 - Math.floor(s1),
        ny: s2 - Math.floor(s2),
        r: 0.5 + (s3 - Math.floor(s3)) * 1.1,
        a: 0.14 + (s3 - Math.floor(s3)) * 0.42,
      };
    });

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.cx = 0;
    this.cy = 0;
    this.baseRadius = 200;
    this.radius = 200;

    this._rafId = null;
    this._lastFrameTs = performance.now();
    this._lastRenderTs = 0;
    this._dirty = true;
    this._spatialGrid = new Map();

    this._bindEvents();
    this.resize();
    this.start();
    this._scheduleHighResGeoUpgrade();
  }

  _scheduleHighResGeoUpgrade() {
    if (this._highResGeoLoaded) return;
    setTimeout(() => {
      import('./world-geo.js')
        .then((mod) => {
          if (!mod || !Array.isArray(mod.WORLD_POLYGONS)) return;
          this.preparedPolygons = mod.WORLD_POLYGONS.map((ring) => preparePath(ring, true, 4.5));
          this.preparedBorders = mod.COUNTRY_BORDERS.map((line) => preparePath(line, false, 4.5));
          this.preparedLakes = mod.WORLD_LAKES.map((ring) => preparePath(ring, true, 4.5));
          this._highResGeoLoaded = true;
          this._dirty = true;
        })
        .catch(() => {
          // Keep lite geometry gracefully if offline or blocked
        });
    }, 120);
  }

  requestRender() {
    this._dirty = true;
  }

  _rebuildSpatialGrid() {
    const grid = new Map();
    const list = this.vessels;
    for (let i = 0; i < list.length; i++) {
      const v = list[i];
      const latB = Math.max(-9, Math.min(8, Math.floor(v.lat / 10)));
      const lonB = Math.max(-18, Math.min(17, Math.floor(v.lon / 10)));
      const key = (latB + 9) * 36 + (lonB + 18);
      let bucket = grid.get(key);
      if (!bucket) {
        bucket = [];
        grid.set(key, bucket);
      }
      bucket.push(v);
    }
    this._spatialGrid = grid;
  }

  _getCandidateVessels() {
    if (this.vessels.length <= 500 || this.zoom < 2.2 || this._spatialGrid.size === 0) {
      return this.vessels;
    }
    const span = this.getViewportSpanDeg();
    const padLat = span.halfLat * 1.25 + 10;
    const padLon = span.halfLon * 1.25 + 10;
    if (padLon >= 160 || padLat >= 80) return this.vessels;

    const minLatB = Math.max(-9, Math.min(8, Math.floor((this.centerLat - padLat) / 10)));
    const maxLatB = Math.max(-9, Math.min(8, Math.floor((this.centerLat + padLat) / 10)));
    const rawMinLonB = Math.floor((this.centerLon - padLon) / 10);
    const rawMaxLonB = Math.floor((this.centerLon + padLon) / 10);

    const out = [];
    for (let lb = minLatB; lb <= maxLatB; lb++) {
      const rowOff = (lb + 9) * 36;
      for (let rawLon = rawMinLonB; rawLon <= rawMaxLonB; rawLon++) {
        const lonIdx = (((rawLon + 18) % 36) + 36) % 36;
        const bucket = this._spatialGrid.get(rowOff + lonIdx);
        if (bucket) {
          for (let j = 0; j < bucket.length; j++) out.push(bucket[j]);
        }
      }
    }
    return out;
  }

  setVessels(vessels) {
    this.vessels = vessels;
    this._rebuildSpatialGrid();
    this._dirty = true;
  }

  setSelectedVessel(mmsi, follow = false) {
    this.selectedMmsi = mmsi;
    if (mmsi) this.selectedVosId = null;
    this.followSelected = Boolean(mmsi && follow);
    this._dirty = true;
  }

  setVosShips(ships) {
    this.vosShips = Array.isArray(ships) ? ships : [];
    this._dirty = true;
  }

  setSelectedVos(id) {
    this.selectedVosId = id || null;
    if (id) {
      this.selectedMmsi = null;
      this.followSelected = false;
    }
    this._dirty = true;
  }

  setOption(key, value) {
    this.options[key] = value;
    this._dirty = true;
  }

  setTheme(theme) {
    this.options.theme = theme;
    this._dirty = true;
  }

  /**
   * Return top visible moving vessels inside the current screen viewport
   * so the app can batch-load real historical AIS tracks for ships on screen.
   */
  getVisibleMovingVessels(maxCount = 24) {
    const phi0 = this.centerLat * DEG2RAD;
    const lam0 = this.centerLon * DEG2RAD;
    const sinPhi0 = Math.sin(phi0);
    const cosPhi0 = Math.cos(phi0);
    const candidates = [];
    const pool = this._getCandidateVessels();

    for (let i = 0; i < pool.length; i++) {
      const v = pool[i];
      if ((v.sog || 0) < 1.5) continue;
      const p = this.projectRad(v.lat * DEG2RAD, v.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
      if (p.z < 0.15) continue;
      if (p.sx < 20 || p.sx > this.width - 20 || p.sy < 60 || p.sy > this.height - 60) continue;
      const distCenter = Math.hypot(p.sx - this.cx, p.sy - this.cy);
      candidates.push({ v, score: distCenter - (v.sog || 0) * 6 });
    }
    candidates.sort((a, b) => a.score - b.score);
    return candidates.slice(0, maxCount).map((c) => c.v);
  }

  /**
   * Exact inverse orthographic projection: screen (sx, sy) -> { lat, lon } in degrees.
   */
  screenToLatLon(sx, sy) {
    const x = (sx - this.cx) / this.radius;
    const y = (this.cy - sy) / this.radius;
    const r2 = x * x + y * y;
    if (r2 >= 0.996) return null;
    const z = Math.sqrt(Math.max(0, 1 - r2));
    const phi0 = this.centerLat * DEG2RAD;
    const lam0 = this.centerLon * DEG2RAD;
    const sinPhi0 = Math.sin(phi0);
    const cosPhi0 = Math.cos(phi0);
    const phi = Math.asin(Math.max(-1, Math.min(1, z * sinPhi0 + y * cosPhi0)));
    const lam = lam0 + Math.atan2(x, z * cosPhi0 - y * sinPhi0);
    const lonDeg = (((lam * RAD2DEG + 180) % 360) + 360) % 360 - 180;
    return { lat: phi * RAD2DEG, lon: lonDeg };
  }

  /**
   * Returns approximate visible geographic half-span in degrees for viewport-aware scans/grids.
   */
  getViewportSpanDeg() {
    const halfLat = Math.min(85, (this.height / (2 * Math.max(80, this.radius))) * RAD2DEG);
    const cosLat = Math.max(0.18, Math.cos(this.centerLat * DEG2RAD));
    const halfLon = Math.min(180, (this.width / (2 * Math.max(80, this.radius) * cosLat)) * RAD2DEG);
    return { halfLat, halfLon };
  }

  flyTo(lat, lon, zoom = this.zoom, durationMs = 750) {
    this.velLat = 0;
    this.velLon = 0;
    let dLon = lon - this.centerLon;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;

    this.flyTarget = {
      startLat: this.centerLat,
      startLon: this.centerLon,
      startZoom: this.zoom,
      targetLat: Math.max(-82, Math.min(82, lat)),
      targetLon: this.centerLon + dLon,
      targetZoom: Math.max(this.minZoom, Math.min(this.maxZoom, zoom)),
      startTs: performance.now(),
      durationMs,
    };
    this._dirty = true;
  }

  zoomBy(factor) {
    const baseZoom = this.flyTarget ? this.flyTarget.targetZoom : this.zoom;
    const targetZoom = Math.max(
      this.minZoom,
      Math.min(this.maxZoom, baseZoom * factor)
    );
    this.flyTo(this.centerLat, this.centerLon, targetZoom, 220);
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    this.width = Math.max(300, rect.width);
    this.height = Math.max(240, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;

    this.cx = this.width / 2;
    this.cy = this.height / 2;
    this.baseRadius = Math.min(this.width, this.height) * 0.42;
    this.radius = this.baseRadius * this.zoom;
    this._dirty = true;
  }

  projectRad(phi, lam, sinPhi0, cosPhi0, lam0) {
    const dLam = lam - lam0;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const cosDLam = Math.cos(dLam);
    const sinDLam = Math.sin(dLam);

    const x = cosPhi * sinDLam;
    const y = sinPhi * cosPhi0 - cosPhi * sinPhi0 * cosDLam;
    const z = sinPhi * sinPhi0 + cosPhi * cosPhi0 * cosDLam;
    return {
      x,
      y,
      z,
      sx: this.cx + x * this.radius,
      sy: this.cy - y * this.radius,
    };
  }

  _bindEvents() {
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // ignore if pointer cannot be captured
      }

      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      this.flyTarget = null;
      this.velLat = 0;
      this.velLon = 0;

      if (this._pointers.size === 1) {
        this.isDragging = true;
        this.isPinching = false;
        this.dragMoved = false;
        this.pointerDownPos = { x: e.clientX, y: e.clientY };
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.canvas.style.cursor = 'grabbing';
      } else if (this._pointers.size === 2) {
        const [p1, p2] = Array.from(this._pointers.values());
        const rect = this.canvas.getBoundingClientRect();
        this.isPinching = true;
        this.isDragging = false;
        this.dragMoved = true;
        this.followSelected = false;
        this._pinchDist = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        this._pinchMid = {
          x: (p1.x + p2.x) * 0.5 - rect.left,
          y: (p1.y + p2.y) * 0.5 - rect.top,
        };
      }
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this._pointers.has(e.pointerId)) {
        this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, type: e.pointerType });
      }

      // Two-finger pinch-to-zoom + anchored midpoint pan
      if (this.isPinching && this._pointers.size >= 2) {
        const [p1, p2] = Array.from(this._pointers.values());
        const dist = Math.max(10, Math.hypot(p2.x - p1.x, p2.y - p1.y));
        const mid = {
          x: (p1.x + p2.x) * 0.5 - rect.left,
          y: (p1.y + p2.y) * 0.5 - rect.top,
        };

        const anchor = this.screenToLatLon(this._pinchMid.x, this._pinchMid.y);
        const scale = dist / Math.max(10, this._pinchDist);
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * scale));
        this.radius = this.baseRadius * this.zoom;

        if (anchor) {
          const after = this.screenToLatLon(mid.x, mid.y);
          if (after) {
            let dLon = anchor.lon - after.lon;
            if (dLon > 180) dLon -= 360;
            if (dLon < -180) dLon += 360;
            this.centerLat = Math.max(-82, Math.min(82, this.centerLat + (anchor.lat - after.lat)));
            this.centerLon = (((this.centerLon + dLon + 180) % 360) + 360) % 360 - 180;
          }
        }

        this._pinchDist = dist;
        this._pinchMid = mid;
        this._dirty = true;
        return;
      }

      if (this.isDragging) {
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        const tapSlop = e.pointerType === 'touch' ? 9 : 3;
        if (
          !this.dragMoved &&
          Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y) > tapSlop
        ) {
          this.dragMoved = true;
          this.followSelected = false;
        }
        if (this.dragMoved) {
          // Exact 1:1 cursor-locked spherical panning at every zoom & latitude
          const radPerPx = 1 / Math.max(80, this.radius);
          const cosLat = Math.max(0.18, Math.cos(this.centerLat * DEG2RAD));
          const dLat = dy * radPerPx * RAD2DEG;
          const dLon = -(dx * radPerPx * RAD2DEG) / cosLat;

          this.centerLon = (((this.centerLon + dLon + 180) % 360) + 360) % 360 - 180;
          this.centerLat = Math.max(-82, Math.min(82, this.centerLat + dLat));
          this.velLon = dLon;
          this.velLat = dLat;
          this._dirty = true;
        }
        this.lastPointer = { x: e.clientX, y: e.clientY };
        return;
      }

      // Skip floating hover tooltips for touch pointers
      if (e.pointerType === 'touch') return;

      // Check cluster hit first, then individual AIS vessel, then open-ocean NOAA VOS ship
      const cluster = this._pickCluster(mx, my, false);
      if (cluster) {
        if (this.hoveredClusterId !== cluster.id || this.hoveredMmsi !== null || this.hoveredVosId !== null) {
          this._dirty = true;
        }
        this.hoveredClusterId = cluster.id;
        this.hoveredMmsi = null;
        this.hoveredVosId = null;
        this.canvas.style.cursor = 'pointer';
        this.onHoverVessel(null, 0, 0);
        this.onHoverVos(null, 0, 0);
        this.onHoverCluster(cluster, mx, my);
        return;
      }
      if (this.hoveredClusterId !== null) {
        this.hoveredClusterId = null;
        this._dirty = true;
        this.onHoverCluster(null, 0, 0);
      }

      const hit = this._pickVessel(mx, my, false);
      const hitId = hit ? hit.mmsi : null;
      if (hit) {
        if (hitId !== this.hoveredMmsi || this.hoveredVosId !== null) {
          this.hoveredMmsi = hitId;
          this.hoveredVosId = null;
          this._dirty = true;
          this.canvas.style.cursor = 'pointer';
        }
        this.onHoverVos(null, 0, 0);
        this.onHoverVessel(hit, mx, my);
        return;
      }
      if (this.hoveredMmsi !== null) {
        this.hoveredMmsi = null;
        this._dirty = true;
        this.onHoverVessel(null, 0, 0);
      }

      const vosHit = this._pickVosShip(mx, my, false);
      const vosId = vosHit ? vosHit.id : null;
      if (vosId !== this.hoveredVosId) {
        this.hoveredVosId = vosId;
        this._dirty = true;
        this.canvas.style.cursor = vosHit ? 'pointer' : 'grab';
      }
      this.onHoverVos(vosHit, mx, my);
    });

    const endDrag = (e) => {
      const wasActive = this._pointers.has(e.pointerId);
      this._pointers.delete(e.pointerId);

      // Transition cleanly from 2-finger pinch back to 1-finger pan without jumping
      if (this._pointers.size === 1) {
        const [remaining] = Array.from(this._pointers.values());
        this.isPinching = false;
        this.isDragging = true;
        this.dragMoved = true;
        this.velLat = 0;
        this.velLon = 0;
        this.lastPointer = { x: remaining.x, y: remaining.y };
        this._dirty = true;
        return;
      }

      if (!wasActive && !this.isDragging && !this.isPinching) return;
      const wasPinching = this.isPinching;
      this.isDragging = false;
      this.isPinching = false;
      this.canvas.style.cursor = this.measureMode
        ? 'crosshair'
        : this.hoveredMmsi || this.hoveredClusterId || this.hoveredVosId
          ? 'pointer'
          : 'grab';

      if (!this.dragMoved && !wasPinching && e.type === 'pointerup') {
        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const isTouch = e.pointerType === 'touch';

        // Great-circle distance/bearing/ETA ruler clicks
        if (this.measureMode) {
          const hitVessel = this._pickVessel(mx, my, isTouch);
          const hitVos = !hitVessel ? this._pickVosShip(mx, my, isTouch) : null;
          const hitPort = !hitVessel && !hitVos ? this._pickPort(mx, my, isTouch) : null;
          const pos = hitVessel
            ? { lat: hitVessel.lat, lon: hitVessel.lon, label: hitVessel.name, speedKn: hitVessel.sog || 0 }
            : hitVos
              ? { lat: hitVos.lat, lon: hitVos.lon, label: 'NOAA VOS' }
              : hitPort
                ? { lat: hitPort.lat, lon: hitPort.lon, label: hitPort.name }
                : this.screenToLatLon(mx, my);
          if (pos) {
            if (this.measurePoints.length >= 2) {
              this.measurePoints = [pos];
            } else {
              this.measurePoints.push(pos);
            }
            this._dirty = true;
            this._notifyMeasure();
          }
          return;
        }

        // Tapping/clicking a cluster smoothly zooms into it
        const cluster = this._pickCluster(mx, my, isTouch);
        if (cluster) {
          this.followSelected = false;
          const nextZoom = Math.min(this.maxZoom, Math.max(this.zoom * 2.5, 3.6));
          this.flyTo(cluster.lat, cluster.lon, nextZoom, 620);
          return;
        }

        const hit = this._pickVessel(mx, my, isTouch);
        if (hit) {
          this.onSelectVessel(hit);
          return;
        }

        const vosHit = this._pickVosShip(mx, my, isTouch);
        if (vosHit) {
          this.onSelectVos(vosHit);
          return;
        }

        // Clicking a major port opens the 15NM port control filter
        const port = this._pickPort(mx, my, isTouch);
        if (port) {
          this.onSelectPort(port);
          return;
        }

        // Touch double-tap anywhere on the map smoothly zooms 2.6x into that spot
        if (isTouch) {
          const now = performance.now();
          const prev = this._lastTouchTap;
          if (now - prev.time < 320 && Math.hypot(mx - prev.x, my - prev.y) < 34) {
            this._lastTouchTap = { time: 0, x: 0, y: 0 };
            const pos = this.screenToLatLon(mx, my);
            if (pos) {
              this.followSelected = false;
              this.flyTo(pos.lat, pos.lon, Math.min(this.maxZoom, this.zoom * 2.6), 420);
            }
          } else {
            this._lastTouchTap = { time: now, x: mx, y: my };
          }
        }
      }
    };

    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener('pointerleave', () => {
      if (!this.isDragging) {
        if (this.hoveredMmsi !== null || this.hoveredClusterId !== null || this.hoveredVosId !== null) {
          this._dirty = true;
        }
        this.hoveredMmsi = null;
        this.hoveredClusterId = null;
        this.hoveredVosId = null;
        this.onHoverVessel(null, 0, 0);
        this.onHoverCluster(null, 0, 0);
        this.onHoverVos(null, 0, 0);
      }
    });

    // Double-click anywhere on the map to smoothly zoom 2.6x into that spot
    this.canvas.addEventListener('dblclick', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      if (this._pickCluster(mx, my, false) || this._pickVessel(mx, my, false) || this._pickVosShip(mx, my, false)) return;
      const pos = this.screenToLatLon(mx, my);
      if (pos) {
        this.followSelected = false;
        this.flyTo(pos.lat, pos.lon, Math.min(this.maxZoom, this.zoom * 2.6), 420);
      }
    });

    // Smooth cursor-anchored wheel zoom (supports both mouse wheel and trackpad pinch/scroll)
    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.flyTarget = null;
        this.velLat = 0;
        this.velLon = 0;

        const rect = this.canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const anchor = this.screenToLatLon(mx, my);

        const clampedDelta = Math.max(-160, Math.min(160, e.deltaY));
        const factor = Math.exp(-clampedDelta * 0.0028);
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
        this.radius = this.baseRadius * this.zoom;

        if (anchor && !this.followSelected) {
          const after = this.screenToLatLon(mx, my);
          if (after) {
            let dLon = anchor.lon - after.lon;
            if (dLon > 180) dLon -= 360;
            if (dLon < -180) dLon += 360;
            this.centerLat = Math.max(-82, Math.min(82, this.centerLat + (anchor.lat - after.lat)));
            this.centerLon = (((this.centerLon + dLon + 180) % 360) + 360) % 360 - 180;
          }
        }
        this._dirty = true;
      },
      { passive: false }
    );
  }

  _pickCluster(mx, my, isTouch = false) {
    const pad = isTouch ? 12 : 3;
    for (let i = this.screenClusters.length - 1; i >= 0; i--) {
      const c = this.screenClusters[i];
      if (Math.hypot(c.sx - mx, c.sy - my) <= c.r + pad) return c;
    }
    return null;
  }

  _pickVessel(mx, my, isTouch = false) {
    let best = null;
    let bestDist = isTouch ? 26 : 14;
    for (let i = this.screenVessels.length - 1; i >= 0; i--) {
      const sv = this.screenVessels[i];
      const d = Math.hypot(sv.sx - mx, sv.sy - my);
      if (d < bestDist) {
        bestDist = d;
        best = sv.vessel;
      }
    }
    return best;
  }

  _pickVosShip(mx, my, isTouch = false) {
    if (!this.options.showVosShips || this.screenVosShips.length === 0) return null;
    let best = null;
    let bestDist = isTouch ? 24 : 12;
    for (let i = this.screenVosShips.length - 1; i >= 0; i--) {
      const item = this.screenVosShips[i];
      const d = Math.hypot(item.sx - mx, item.sy - my);
      if (d < bestDist) {
        bestDist = d;
        best = item.ship;
      }
    }
    return best;
  }

  start() {
    if (this._rafId) return;
    const loop = (ts) => {
      const dt = Math.min(0.05, (ts - this._lastFrameTs) / 1000);
      this._lastFrameTs = ts;
      const moved = this._updateCamera(ts, dt);
      const pulseActive = Boolean(this.selectedMmsi || this.selectedVosId);
      const idleTick = ts - this._lastRenderTs >= 1000;
      if (this._dirty || moved || pulseActive || idleTick) {
        this._dirty = false;
        this._lastRenderTs = ts;
        this.render(ts);
      }
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
  }

  _updateCamera(ts, dt) {
    let moved = false;
    const mobileSheetActive = this.width <= 768 && Boolean(this.selectedMmsi || this.selectedVosId);
    const targetCy = mobileSheetActive ? this.height * 0.32 : this.height * 0.5;
    if (Math.abs(this.cy - targetCy) > 0.5) {
      this.cy += (targetCy - this.cy) * Math.min(1, dt * 9);
      moved = true;
    } else if (this.cy !== targetCy) {
      this.cy = targetCy;
      moved = true;
    }

    if (this.flyTarget) {
      const f = this.flyTarget;
      const t = Math.min(1, (ts - f.startTs) / f.durationMs);
      const ease = 1 - Math.pow(1 - t, 3);
      this.centerLat = f.startLat + (f.targetLat - f.startLat) * ease;
      const lon = f.startLon + (f.targetLon - f.startLon) * ease;
      this.centerLon = (((lon + 180) % 360) + 360) % 360 - 180;
      // Exponential zoom interpolation feels perceptually smooth from 1x to 1500x!
      this.zoom = f.startZoom * Math.pow(f.targetZoom / Math.max(0.1, f.startZoom), ease);
      if (t >= 1) this.flyTarget = null;
      moved = true;
    } else if (this.followSelected && this.selectedMmsi) {
      const target = this.vessels.find((v) => v.mmsi === this.selectedMmsi);
      if (target) {
        let dLon = target.lon - this.centerLon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        if (Math.abs(dLon) > 0.0001 || Math.abs(target.lat - this.centerLat) > 0.0001) {
          this.centerLon = (((this.centerLon + dLon * 0.08 + 180) % 360) + 360) % 360 - 180;
          this.centerLat += (target.lat - this.centerLat) * 0.08;
          moved = true;
        }
      }
    } else if (!this.isDragging) {
      const velEps = 0.004 / Math.max(1, this.zoom);
      if (Math.abs(this.velLon) > velEps || Math.abs(this.velLat) > velEps) {
        this.centerLon =
          (((this.centerLon + this.velLon + 180) % 360) + 360) % 360 - 180;
        this.centerLat = Math.max(-82, Math.min(82, this.centerLat + this.velLat));
        this.velLon *= 0.88;
        this.velLat *= 0.88;
        moved = true;
      } else if (this.options.autoRotate) {
        const rotSpeed = 5.0 / Math.max(1, Math.sqrt(this.zoom));
        this.centerLon =
          (((this.centerLon + dt * rotSpeed + 180) % 360) + 360) % 360 - 180;
        moved = true;
      }
    }

    this.radius = this.baseRadius * this.zoom;
    if (moved || this._dirty) {
      this.onCameraChange({
        lat: this.centerLat,
        lon: this.centerLon,
        zoom: this.zoom,
      });
    }
    return moved;
  }

  _getPalette() {
    if (this.options.theme === 'light') {
      return {
        spaceBg: '#e4edf4',
        oceanInner: '#d8ebf7',
        oceanMid: '#b9d8ee',
        oceanEdge: '#8bb7d6',
        atmosphere: 'rgba(14, 116, 144, 0.22)',
        rimStroke: 'rgba(15, 76, 117, 0.35)',
        graticule: 'rgba(15, 76, 117, 0.11)',
        equator: 'rgba(14, 116, 144, 0.28)',
        shelfGlow: 'rgba(14, 165, 233, 0.14)',
        landFill: '#e4ebe5',
        landStroke: '#6b8c7e',
        borderStroke: 'rgba(71, 85, 105, 0.35)',
        lakeFill: '#c5e0f2',
        seaLabel: 'rgba(15, 76, 117, 0.48)',
        laneStroke: 'rgba(14, 116, 144, 0.24)',
        laneMajor: 'rgba(14, 116, 144, 0.34)',
        laneMiddle: 'rgba(14, 116, 144, 0.20)',
        laneMinor: 'rgba(14, 116, 144, 0.12)',
        vosFill: '#0d9488',
        vosGlow: 'rgba(13, 148, 136, 0.22)',
        vosStroke: 'rgba(255, 255, 255, 0.92)',
        nightTint: 'rgba(15, 35, 58, 0.22)',
        portDot: '#0f766e',
        portLabel: '#0f172a',
        portLabelBg: 'rgba(255, 255, 255, 0.82)',
        clusterText: '#ffffff',
        clusterRing: 'rgba(255, 255, 255, 0.85)',
        calloutBg: 'rgba(15, 23, 42, 0.92)',
        calloutText: '#f8fafc',
      };
    }
    return {
      spaceBg: '#040b14',
      oceanInner: '#0d263e',
      oceanMid: '#081a2d',
      oceanEdge: '#040d18',
      atmosphere: 'rgba(56, 189, 248, 0.25)',
      rimStroke: 'rgba(56, 189, 248, 0.34)',
      graticule: 'rgba(148, 197, 233, 0.08)',
      equator: 'rgba(56, 189, 248, 0.22)',
      shelfGlow: 'rgba(56, 189, 248, 0.14)',
      landFill: '#16283a',
      landStroke: '#385d7c',
      borderStroke: 'rgba(148, 184, 214, 0.24)',
      lakeFill: '#0a2035',
      seaLabel: 'rgba(148, 197, 233, 0.36)',
      laneStroke: 'rgba(56, 189, 248, 0.16)',
      laneMajor: 'rgba(56, 189, 248, 0.30)',
      laneMiddle: 'rgba(56, 189, 248, 0.17)',
      laneMinor: 'rgba(148, 197, 233, 0.10)',
      vosFill: '#2dd4bf',
      vosGlow: 'rgba(45, 212, 191, 0.24)',
      vosStroke: 'rgba(4, 15, 28, 0.88)',
      nightTint: 'rgba(2, 6, 14, 0.4)',
      portDot: '#38bdf8',
      portLabel: '#cbd5e1',
      portLabelBg: 'rgba(6, 17, 29, 0.78)',
      clusterText: '#f8fafc',
      clusterRing: 'rgba(255, 255, 255, 0.35)',
      calloutBg: 'rgba(6, 17, 29, 0.94)',
      calloutText: '#f1f5f9',
    };
  }

  render(ts) {
    const ctx = this.ctx;
    const P = this._getPalette();
    const R = this.radius;
    const cx = this.cx;
    const cy = this.cy;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    // 1. Background
    ctx.fillStyle = P.spaceBg;
    ctx.fillRect(0, 0, this.width, this.height);

    if (this.options.theme !== 'light' && this.zoom < 3.0) {
      for (const st of this.stars) {
        ctx.fillStyle = `rgba(203, 225, 246, ${st.a})`;
        ctx.beginPath();
        ctx.arc(st.nx * this.width, st.ny * this.height, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2. Atmospheric halo
    if (this.zoom < 4.0) {
      const halo = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.12);
      halo.addColorStop(0, P.atmosphere);
      halo.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.12, 0, Math.PI * 2);
      ctx.fill();
    }

    // 3. Clip to Earth disk (skip gigantic arc clip when globe completely fills viewport)
    const fillsViewport = R > Math.hypot(cx, cy) + 8;
    ctx.save();
    if (!fillsViewport) {
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.clip();
    }

    // 4. Spherical ocean shading (crisp viewport fill at deep zoom avoids giant radial gradient artifacts)
    if (fillsViewport) {
      const flatOcean = ctx.createLinearGradient(0, 0, 0, this.height);
      flatOcean.addColorStop(0, P.oceanInner);
      flatOcean.addColorStop(1, P.oceanMid);
      ctx.fillStyle = flatOcean;
      ctx.fillRect(0, 0, this.width, this.height);
    } else {
      const oceanGrad = ctx.createRadialGradient(
        cx - R * 0.25,
        cy - R * 0.22,
        R * 0.08,
        cx,
        cy,
        R * 1.02
      );
      oceanGrad.addColorStop(0, P.oceanInner);
      oceanGrad.addColorStop(0.62, P.oceanMid);
      oceanGrad.addColorStop(1, P.oceanEdge);
      ctx.fillStyle = oceanGrad;
      ctx.fillRect(0, 0, this.width, this.height);
    }

    const phi0 = this.centerLat * DEG2RAD;
    const lam0 = this.centerLon * DEG2RAD;
    const sinPhi0 = Math.sin(phi0);
    const cosPhi0 = Math.cos(phi0);

    // 5. Viewport-culled Adaptive Graticule (20° down to 0.02°)
    if (this.options.showGraticule) {
      this._drawGraticule(ctx, P, sinPhi0, cosPhi0, lam0);
    }

    // 6. Natural Earth 50m Landmasses + Coastal Shelf Glow + Lakes + Country Borders
    this._drawHighResMap(ctx, P, sinPhi0, cosPhi0, lam0);

    // 6.5. Optional High-Zoom Nautical Chart + OpenSeaMap Seamarks Overlay (>= 12x, vector fallback)
    if (this.options.showChartTiles && this.zoom >= 12) {
      this._drawChartTiles(ctx, sinPhi0, cosPhi0, lam0);
    }

    // 7. Real-Time Solar Terminator
    const sun = getSubsolarRad();
    const sunVec = latLonToVec3(sun.phi * RAD2DEG, sun.lam * RAD2DEG);
    if (this.options.showDayNight) {
      this._drawDayNightOverlay(ctx, P, sinPhi0, cosPhi0, lam0, sun, sunVec);
    }

    // 8. Nautical Sea & Strait Labels
    this._drawSeaLabels(ctx, P, sinPhi0, cosPhi0, lam0);

    // 9. Global Commercial Shipping Lanes (Major / Middle / Minor)
    if (this.options.showLanes) {
      this._drawCorridors(ctx, P, sinPhi0, cosPhi0, lam0);
    }

    // 10. Major Ports & Optional 15NM Port Geofence Ring
    if (this.options.showPorts) {
      this._drawPorts(ctx, P, sinPhi0, cosPhi0, lam0, sunVec);
    } else {
      this.screenPorts = [];
    }
    if (this.activePortFilter) {
      this._drawPortRadiusRing(ctx, P, sinPhi0, cosPhi0, lam0);
    }

    // 10.5. Real Open-Ocean Ships (NOAA / WMO Voluntary Observing Ships satellite weather reports)
    if (this.options.showVosShips && this.vosShips.length > 0) {
      this._drawVosShips(ctx, P, sinPhi0, cosPhi0, lam0, ts);
    } else {
      this.screenVosShips = [];
    }

    // 11. Vessels, Smart Clusters & Gradient AIS Tracks
    this._drawVesselsAndClusters(ctx, P, sinPhi0, cosPhi0, lam0, ts);

    // 11.5. Great-Circle Distance, Bearing & ETA Ruler Overlay
    if (this.measurePoints.length > 0) {
      this._drawMeasureOverlay(ctx, P, sinPhi0, cosPhi0, lam0);
    }

    ctx.restore(); // End sphere clip

    // 12. Sphere rim outline
    if (!fillsViewport) {
      ctx.strokeStyle = P.rimStroke;
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(cx, cy, R, 0, Math.PI * 2);
      ctx.stroke();
    }

    // 13. Live Nautical Scale Bar (km / m + NM)
    this._drawScaleBar(ctx, P);

    ctx.restore();
  }

  _drawScaleBar(ctx, P) {
    const isMobile = this.width <= 768;
    if (isMobile && typeof document !== 'undefined' && document.body?.classList?.contains('inspector-open')) {
      return;
    }

    const EARTH_RADIUS_M = 6371000;
    const metersPerPx = EARTH_RADIUS_M / Math.max(80, this.radius);
    const targetPx = isMobile ? 84 : 110;
    const rawMeters = metersPerPx * targetPx;

    // Snap to clean 1 / 2 / 5 × 10^n nautical-friendly distance
    const pow10 = Math.pow(10, Math.floor(Math.log10(Math.max(10, rawMeters))));
    const norm = rawMeters / pow10;
    const niceMult = norm >= 5 ? 5 : norm >= 2 ? 2 : 1;
    const distM = niceMult * pow10;
    const barPx = Math.max(32, Math.min(isMobile ? 120 : 180, distM / metersPerPx));

    const kmText = distM >= 1000 ? `${(distM / 1000).toLocaleString()} km` : `${Math.round(distM)} m`;
    const nmVal = distM / 1852;
    const nmText = nmVal >= 10 ? `${Math.round(nmVal).toLocaleString()} NM` : `${nmVal.toFixed(1)} NM`;
    const label = `${kmText} · ${nmText}`;

    const rightMargin = isMobile ? 10 : 14;
    const x = this.width - barPx - (rightMargin + 6);
    const y = isMobile ? this.height - 72 : this.height - 54;

    ctx.save();
    ctx.font = `600 ${isMobile ? 9.5 : 10}px ui-monospace, SFMono-Regular, monospace`;
    const textW = ctx.measureText(label).width;
    const boxW = Math.max(barPx, textW) + 14;
    const boxX = this.width - boxW - rightMargin;
    const boxY = y - 19;

    ctx.fillStyle = P.portLabelBg;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, boxW, 25, 5);
    ctx.fill();

    ctx.fillStyle = P.portLabel;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'bottom';
    ctx.fillText(label, this.width - (rightMargin + 7), y - 4);

    ctx.strokeStyle = P.portDot;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(x, y - 3);
    ctx.lineTo(x, y + 1);
    ctx.lineTo(x + barPx, y + 1);
    ctx.lineTo(x + barPx, y - 3);
    ctx.stroke();
    ctx.restore();
  }

  _getTile(key, url) {
    let entry = this._tileCache.get(key);
    if (entry) {
      // Refresh LRU order
      this._tileCache.delete(key);
      this._tileCache.set(key, entry);
      return entry;
    }
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    entry = { img, status: 'loading' };
    this._tileCache.set(key, entry);
    if (this._tileCache.size > 240) {
      const oldest = this._tileCache.keys().next().value;
      if (oldest) this._tileCache.delete(oldest);
    }
    img.onload = () => {
      entry.status = 'ok';
      this._dirty = true;
    };
    img.onerror = () => {
      entry.status = 'err';
    };
    img.src = url;
    return entry;
  }

  _drawChartTiles(ctx, sinPhi0, cosPhi0, lam0) {
    if (Math.abs(this.centerLat) > 82) return;
    const alpha = Math.max(0, Math.min(1, (this.zoom - 12) / 8));
    if (alpha <= 0.01) return;

    const rawZ = Math.log2((2 * Math.PI * this.radius * Math.max(0.2, cosPhi0)) / 256);
    const z = Math.max(6, Math.min(16, Math.ceil(rawZ)));
    const n = 1 << z;

    const span = this.getViewportSpanDeg();
    const minLat = Math.max(-84, this.centerLat - span.halfLat * 1.15);
    const maxLat = Math.min(84, this.centerLat + span.halfLat * 1.15);
    const minLon = this.centerLon - span.halfLon * 1.15;
    const maxLon = this.centerLon + span.halfLon * 1.15;

    const latToY = (lat) => {
      const rad = lat * DEG2RAD;
      return Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * n);
    };
    const lonToX = (lon) => Math.floor(((lon + 180) / 360) * n);
    const yToLat = (ty) => Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) * RAD2DEG;
    const xToLon = (tx) => (tx / n) * 360 - 180;

    const minY = Math.max(0, Math.min(n - 1, latToY(maxLat)));
    const maxY = Math.max(0, Math.min(n - 1, latToY(minLat)));
    const rawMinX = lonToX(minLon);
    const rawMaxX = lonToX(maxLon);

    // Guard against huge tile counts on extreme ratios
    if ((maxY - minY + 1) * (rawMaxX - rawMinX + 1) > 64) return;

    const isLight = this.options.theme === 'light';

    ctx.save();
    for (let ty = minY; ty <= maxY; ty++) {
      const latN = yToLat(ty) * DEG2RAD;
      const latS = yToLat(ty + 1) * DEG2RAD;
      for (let rawX = rawMinX; rawX <= rawMaxX; rawX++) {
        const tx = ((rawX % n) + n) % n;
        const lonW = xToLon(tx) * DEG2RAD;
        const lonE = xToLon(tx + 1) * DEG2RAD;

        const pNW = this.projectRad(latN, lonW, sinPhi0, cosPhi0, lam0);
        const pSE = this.projectRad(latS, lonE, sinPhi0, cosPhi0, lam0);
        if (pNW.z <= 0.05 || pSE.z <= 0.05) continue;

        const w = pSE.sx - pNW.sx;
        const h = pSE.sy - pNW.sy;
        if (w <= 2 || h <= 2 || w > this.width * 3) continue;

        const baseKey = `osm/${z}/${tx}/${ty}`;
        const baseUrl = `https://tile.openstreetmap.org/${z}/${tx}/${ty}.png`;
        const baseTile = this._getTile(baseKey, baseUrl);
        if (baseTile && baseTile.status === 'ok') {
          ctx.save();
          if (!isLight) {
            // Transform bright OSM map into low-glare maritime dark chart palette
            ctx.filter = 'invert(1) hue-rotate(185deg) brightness(0.84) contrast(1.08) saturate(0.55)';
          }
          ctx.globalAlpha = alpha * (isLight ? 0.94 : 0.88);
          ctx.drawImage(baseTile.img, pNW.sx, pNW.sy, w + 0.6, h + 0.6);
          ctx.restore();
        }

        // OpenSeaMap nautical seamarks (buoys, lighthouses, harbor channels, TSS)
        if (z >= 9) {
          const seaKey = `seamark/${z}/${tx}/${ty}`;
          const seaUrl = `https://tiles.openseamap.org/seamark/${z}/${tx}/${ty}.png`;
          const seaTile = this._getTile(seaKey, seaUrl);
          if (seaTile && seaTile.status === 'ok') {
            ctx.globalAlpha = alpha * 0.96;
            ctx.drawImage(seaTile.img, pNW.sx, pNW.sy, w + 0.6, h + 0.6);
          }
        }
      }
    }
    ctx.restore();
  }

  _drawGraticule(ctx, P, sinPhi0, cosPhi0, lam0) {
    const z = this.zoom;
    const step =
      z >= 900 ? 0.02
      : z >= 400 ? 0.05
      : z >= 180 ? 0.1
      : z >= 80 ? 0.2
      : z >= 35 ? 0.5
      : z >= 16 ? 1
      : z >= 7.5 ? 2
      : z >= 3.8 ? 5
      : z >= 2.0 ? 10
      : 20;

    const { halfLat, halfLon } = this.getViewportSpanDeg();
    const padLat = Math.min(85, halfLat * 1.35 + step);
    const padLon = Math.min(180, halfLon * 1.35 + step);

    const minLat = Math.max(-80, Math.floor((this.centerLat - padLat) / step) * step);
    const maxLat = Math.min(80, Math.ceil((this.centerLat + padLat) / step) * step);

    // Handle full globe vs local zoomed window for longitude
    const fullLon = padLon >= 165;
    const minLon = fullLon ? -180 : Math.floor((this.centerLon - padLon) / step) * step;
    const maxLon = fullLon ? 180 : Math.ceil((this.centerLon + padLon) / step) * step;
    const sampleStep = Math.max(step * 0.25, Math.min(4, padLon / 28));

    ctx.lineWidth = 0.65;

    for (let lat = minLat; lat <= maxLat + step * 0.1; lat += step) {
      const rLat = Math.round(lat * 1000) / 1000;
      if (rLat < -80 || rLat > 80) continue;
      ctx.strokeStyle = rLat === 0 ? P.equator : P.graticule;
      ctx.beginPath();
      let started = false;
      const phi = rLat * DEG2RAD;
      for (let lon = minLon; lon <= maxLon + sampleStep * 0.1; lon += sampleStep) {
        const p = this.projectRad(phi, lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
        if (p.z > 0) {
          if (!started) { ctx.moveTo(p.sx, p.sy); started = true; }
          else ctx.lineTo(p.sx, p.sy);
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }

    for (let lon = minLon; lon <= maxLon - (fullLon ? step * 0.1 : -step * 0.1); lon += step) {
      const rLon = Math.round(lon * 1000) / 1000;
      const wrappedLon = (((rLon + 180) % 360) + 360) % 360 - 180;
      ctx.strokeStyle = Math.abs(wrappedLon) < 1e-4 ? P.equator : P.graticule;
      ctx.beginPath();
      let started = false;
      const lam = rLon * DEG2RAD;
      for (let lat = minLat; lat <= maxLat + sampleStep * 0.1; lat += sampleStep) {
        const clampedLat = Math.max(-84, Math.min(84, lat));
        const p = this.projectRad(clampedLat * DEG2RAD, lam, sinPhi0, cosPhi0, lam0);
        if (p.z > 0) {
          if (!started) { ctx.moveTo(p.sx, p.sy); started = true; }
          else ctx.lineTo(p.sx, p.sy);
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }
  }

  _isItemPotentiallyVisible(item, sinPhi0, cosPhi0, lam0) {
    if (item.isHuge) return true;
    const c = this.projectRad(item.cPhi, item.cLam, sinPhi0, cosPhi0, lam0);
    if (c.z + item.sinRadius < -0.02) return false;
    const radPx = item.sinRadius * this.radius + 24;
    if (c.sx + radPx < 0 || c.sx - radPx > this.width || c.sy + radPx < 0 || c.sy - radPx > this.height) {
      return false;
    }
    return true;
  }

  _drawHighResMap(ctx, P, sinPhi0, cosPhi0, lam0) {
    const cx = this.cx;
    const cy = this.cy;
    const R = this.radius;

    // 1. Subtle coastal shallow-water shelf glow + crisp 50m land polygons
    ctx.lineJoin = 'round';
    const visiblePolys = [];

    for (let k = 0; k < this.preparedPolygons.length; k++) {
      const item = this.preparedPolygons[k];
      if (!this._isItemPotentiallyVisible(item, sinPhi0, cosPhi0, lam0)) continue;
      const pts = item.pts;
      let anyVisible = false;
      const proj = new Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        const p = this.projectRad(pts[i][0], pts[i][1], sinPhi0, cosPhi0, lam0);
        if (p.z > 0) anyVisible = true;
        proj[i] = p;
      }
      if (!anyVisible) continue;
      visiblePolys.push(proj);
    }

    // Coastal shallow-shelf outer halo
    if (this.zoom >= 1.4) {
      ctx.strokeStyle = P.shelfGlow;
      ctx.lineWidth = Math.min(9, 2.5 + Math.log2(Math.max(1, this.zoom)) * 1.1);
      for (let k = 0; k < visiblePolys.length; k++) {
        this._tracePolygon(ctx, visiblePolys[k], cx, cy, R);
        ctx.stroke();
      }
    }

    // Fill land + crisp coastline outline
    ctx.fillStyle = P.landFill;
    ctx.strokeStyle = P.landStroke;
    ctx.lineWidth = Math.max(0.75, Math.min(2.0, 0.75 + Math.log2(Math.max(1, this.zoom)) * 0.22));
    for (let k = 0; k < visiblePolys.length; k++) {
      this._tracePolygon(ctx, visiblePolys[k], cx, cy, R);
      ctx.fill();
      ctx.stroke();
    }

    // 2. Major inland lakes
    ctx.fillStyle = P.lakeFill;
    ctx.strokeStyle = P.landStroke;
    ctx.lineWidth = 0.65;
    for (let k = 0; k < this.preparedLakes.length; k++) {
      const item = this.preparedLakes[k];
      if (!this._isItemPotentiallyVisible(item, sinPhi0, cosPhi0, lam0)) continue;
      const pts = item.pts;
      let any = false;
      const proj = new Array(pts.length);
      for (let i = 0; i < pts.length; i++) {
        const p = this.projectRad(pts[i][0], pts[i][1], sinPhi0, cosPhi0, lam0);
        if (p.z > 0) any = true;
        proj[i] = p;
      }
      if (!any) continue;
      this._tracePolygon(ctx, proj, cx, cy, R);
      ctx.fill();
      ctx.stroke();
    }

    // 3. Country borders
    if (this.options.showBorders) {
      ctx.save();
      ctx.strokeStyle = P.borderStroke;
      ctx.lineWidth = 0.75;
      ctx.setLineDash([4, 3]);
      for (let k = 0; k < this.preparedBorders.length; k++) {
        const item = this.preparedBorders[k];
        if (!this._isItemPotentiallyVisible(item, sinPhi0, cosPhi0, lam0)) continue;
        const pts = item.pts;
        ctx.beginPath();
        let on = false;
        for (let i = 0; i < pts.length; i++) {
          const p = this.projectRad(pts[i][0], pts[i][1], sinPhi0, cosPhi0, lam0);
          if (p.z > 0.02) {
            if (!on) { ctx.moveTo(p.sx, p.sy); on = true; }
            else ctx.lineTo(p.sx, p.sy);
          } else {
            on = false;
          }
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  _tracePolygon(ctx, proj, cx, cy, R) {
    ctx.beginPath();
    for (let i = 0; i < proj.length; i++) {
      const p = proj[i];
      let sx = p.sx;
      let sy = p.sy;
      if (p.z < 0) {
        const mag = Math.hypot(p.x, p.y) || 1e-6;
        sx = cx + (p.x / mag) * (R + 1.5);
        sy = cy - (p.y / mag) * (R + 1.5);
      }
      if (i === 0) ctx.moveTo(sx, sy);
      else ctx.lineTo(sx, sy);
    }
    ctx.closePath();
  }

  _drawDayNightOverlay(ctx, P, sinPhi0, cosPhi0, lam0, sun, sunVec) {
    // At deep zoom, evaluate real solar elevation smoothly at the viewport center
    if (this.zoom >= 5) {
      const cv = latLonToVec3(this.centerLat, this.centerLon);
      const sunDot = cv[0] * sunVec[0] + cv[1] * sunVec[1] + cv[2] * sunVec[2];
      if (sunDot >= 0.08) return;
      const nightFactor = Math.max(0, Math.min(1, (0.08 - sunDot) / 0.24));
      ctx.save();
      ctx.fillStyle = P.nightTint;
      ctx.globalAlpha = nightFactor * 0.72;
      ctx.fillRect(0, 0, this.width, this.height);
      ctx.restore();
      return;
    }

    const sunProj = this.projectRad(sun.phi, sun.lam, sinPhi0, cosPhi0, lam0);
    const nightX = this.cx - sunProj.x * this.radius * 0.92;
    const nightY = this.cy + sunProj.y * this.radius * 0.92;

    const grad = ctx.createRadialGradient(
      nightX, nightY, this.radius * 0.15,
      nightX, nightY, this.radius * 1.45
    );
    grad.addColorStop(0, P.nightTint);
    grad.addColorStop(0.55, P.nightTint);
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radius + 2, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawSeaLabels(ctx, P, sinPhi0, cosPhi0, lam0) {
    ctx.save();
    ctx.font = 'italic 500 11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = P.seaLabel;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const s of SEA_LABELS) {
      if (this.zoom < s.minZoom || this.zoom > s.maxZoom) continue;
      const p = this.projectRad(s.lat * DEG2RAD, s.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
      if (p.z < 0.2 || p.sx < 0 || p.sx > this.width || p.sy < 0 || p.sy > this.height) continue;
      const label = this.lang === 'ko' ? s.name : (s.nameEn || s.name);
      ctx.fillText(label, p.sx, p.sy);
    }
    ctx.restore();
  }

  _drawCorridors(ctx, P, sinPhi0, cosPhi0, lam0) {
    const tiers = [
      { items: this.preparedShippingLanes.minor, stroke: P.laneMinor, width: 0.7, dash: [2, 4], minZoom: 1.6 },
      { items: this.preparedShippingLanes.middle, stroke: P.laneMiddle, width: 0.95, dash: [4, 4], minZoom: 0.85 },
      { items: this.preparedShippingLanes.major, stroke: P.laneMajor, width: 1.35, dash: [], minZoom: 0.85 },
    ];
    const zoomScale = Math.min(2.1, Math.max(0.85, Math.pow(this.zoom, 0.25)));
    const maxJump = this.radius * 0.45;
    const pad = 40;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const tier of tiers) {
      if (this.zoom < tier.minZoom || !tier.items || tier.items.length === 0) continue;
      ctx.strokeStyle = tier.stroke;
      ctx.lineWidth = tier.width * zoomScale;
      ctx.setLineDash(tier.dash);
      ctx.beginPath();

      for (let k = 0; k < tier.items.length; k++) {
        const item = tier.items[k];
        if (!item.isHuge) {
          const cd = this.projectRad(item.cPhi, item.cLam, sinPhi0, cosPhi0, lam0);
          if (cd.z < -item.sinRadius - 0.05) continue;
        }
        const pts = item.pts;
        let drawing = false;
        let prevX = 0;
        let prevY = 0;
        for (let i = 0; i < pts.length; i++) {
          const p = this.projectRad(pts[i][0], pts[i][1], sinPhi0, cosPhi0, lam0);
          if (p.z > 0.02) {
            if (!drawing) {
              ctx.moveTo(p.sx, p.sy);
              drawing = true;
            } else if (Math.abs(p.sx - prevX) > maxJump || Math.abs(p.sy - prevY) > maxJump) {
              ctx.moveTo(p.sx, p.sy);
            } else if (
              (p.sx >= -pad && p.sx <= this.width + pad && p.sy >= -pad && p.sy <= this.height + pad) ||
              (prevX >= -pad && prevX <= this.width + pad && prevY >= -pad && prevY <= this.height + pad)
            ) {
              ctx.lineTo(p.sx, p.sy);
            } else {
              ctx.moveTo(p.sx, p.sy);
            }
            prevX = p.sx;
            prevY = p.sy;
          } else {
            drawing = false;
          }
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawVosShips(ctx, P, sinPhi0, cosPhi0, lam0, ts) {
    this.screenVosShips = [];
    const list = this.vosShips;
    const len = list.length;
    if (len === 0) return;

    const wPad = this.width + 20;
    const hPad = this.height + 20;
    const r = Math.max(2.6, Math.min(5.2, 2.5 + Math.log2(Math.max(1, this.zoom)) * 0.55));
    const highlighted = [];

    ctx.save();
    // Batch regular VOS diamond beacons in 2 crisp passes (halo + filled diamond) for 60 FPS
    ctx.fillStyle = P.vosGlow;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const s = list[i];
      const p = this.projectRad(s.lat * DEG2RAD, s.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
      if (p.z < 0.05 || p.sx < -20 || p.sx > wPad || p.sy < -20 || p.sy > hPad) continue;
      const isSel = s.id === this.selectedVosId;
      const isHov = s.id === this.hoveredVosId;
      this.screenVosShips.push({ ship: s, sx: p.sx, sy: p.sy });
      if (isSel || isHov) {
        highlighted.push({ ship: s, sx: p.sx, sy: p.sy, isSel, isHov });
        continue;
      }
      ctx.moveTo(p.sx + r * 1.9, p.sy);
      ctx.arc(p.sx, p.sy, r * 1.9, 0, Math.PI * 2);
    }
    ctx.fill();

    ctx.fillStyle = P.vosFill;
    ctx.strokeStyle = P.vosStroke;
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    for (let i = 0; i < this.screenVosShips.length; i++) {
      const item = this.screenVosShips[i];
      if (item.ship.id === this.selectedVosId || item.ship.id === this.hoveredVosId) continue;
      const { sx, sy } = item;
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r, sy);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();

    // Draw hovered/selected VOS ships prominently on top with pulse ring
    for (const h of highlighted) {
      const hr = r * 1.45;
      if (h.isSel) {
        const pulse = 0.5 + 0.5 * Math.sin((ts || 0) * 0.005);
        ctx.strokeStyle = `rgba(45, 212, 191, ${0.4 + pulse * 0.5})`;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(h.sx, h.sy, hr + 5 + pulse * 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.fillStyle = '#5eead4';
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(h.sx, h.sy - hr);
      ctx.lineTo(h.sx + hr, h.sy);
      ctx.lineTo(h.sx, h.sy + hr);
      ctx.lineTo(h.sx - hr, h.sy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPorts(ctx, P, sinPhi0, cosPhi0, lam0, sunVec) {
    this.screenPorts = [];
    ctx.font = '500 10.5px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';
    const placed = [];

    for (const port of PORTS_DATA) {
      if (!port.major && this.zoom < 2.4) continue;
      const p = this.projectRad(port.lat * DEG2RAD, port.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
      if (p.z < 0.14 || p.sx < -20 || p.sx > this.width + 20 || p.sy < -20 || p.sy > this.height + 20) continue;

      const isActivePort = this.activePortFilter && this.activePortFilter.name === port.name;
      const portLabel = this.lang === 'ko' ? port.name : (port.nameEn || port.name);
      const pv = latLonToVec3(port.lat, port.lon);
      const sunDot = pv[0] * sunVec[0] + pv[1] * sunVec[1] + pv[2] * sunVec[2];
      const isNight = this.options.showDayNight && sunDot < -0.05;

      ctx.fillStyle = isActivePort ? '#38bdf8' : isNight ? '#fbbf24' : P.portDot;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, isActivePort ? 3.8 : 2.4, 0, Math.PI * 2);
      ctx.fill();

      const tw = ctx.measureText(portLabel).width + 6;
      const lx = p.sx + 5;
      const ly = p.sy - 7;
      this.screenPorts.push({ port, sx: p.sx, sy: p.sy, lx, ly, w: tw, h: 14 });
      if (!isActivePort && placed.some((r) => lx < r.x + r.w && lx + tw > r.x && ly < r.y + r.h && ly + 14 > r.y)) {
        continue;
      }
      placed.push({ x: lx, y: ly, w: tw, h: 14 });
      ctx.fillStyle = isActivePort ? 'rgba(14, 165, 233, 0.28)' : P.portLabelBg;
      ctx.fillRect(lx - 2, ly, tw, 14);
      ctx.fillStyle = isActivePort ? '#38bdf8' : P.portLabel;
      ctx.fillText(portLabel, lx + 1, p.sy);
    }
  }

  _drawVesselsAndClusters(ctx, P, sinPhi0, cosPhi0, lam0, ts) {
    this.screenVessels = [];
    this.screenClusters = [];
    const selected = [];
    const totalCount = this.vessels.length;
    const candidates = this._getCandidateVessels();
    const candCount = candidates.length;
    const wPad = this.width + 24;
    const hPad = this.height + 24;
    const baseSize = Math.max(3.4, Math.min(9.5, 3.4 + Math.log2(Math.max(1, this.zoom)) * 0.95));

    // Smart clustering activates automatically when zoomed out and vessels are dense
    const useClusters = this.options.showClusters && this.zoom < 4.5 && totalCount > 120;

    if (useClusters) {
      const cellPx = this.zoom < 1.5 ? 40 : this.zoom < 2.6 ? 32 : 24;
      const grid = new Map();

      for (let i = 0; i < candCount; i++) {
        const v = candidates[i];
        const p = this.projectRad(v.lat * DEG2RAD, v.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
        if (p.z < 0.04 || p.sx < -24 || p.sx > wPad || p.sy < -24 || p.sy > hPad) continue;

        const isSel = v.mmsi === this.selectedMmsi;
        const isHov = v.mmsi === this.hoveredMmsi;
        if (isSel || isHov) {
          const angle = this._screenAngle(v, p, sinPhi0, cosPhi0, lam0);
          const entry = { vessel: v, sx: p.sx, sy: p.sy, z: p.z, angle, isSelected: isSel, isHovered: isHov };
          this.screenVessels.push(entry);
          selected.push(entry);
          continue;
        }

        // Always draw recorded multi-point real AIS tracks underneath clusters when wakes enabled
        if (this.options.showWakes && v.trail && v.trail.length > 1) {
          const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
          this._drawGradientTrack(ctx, v.trail, meta.color, 0.55, 1.4, sinPhi0, cosPhi0, lam0);
        }

        const gx = Math.floor(p.sx / cellPx);
        const gy = Math.floor(p.sy / cellPx);
        const key = (gx + 1000) * 10000 + (gy + 1000);
        let cell = grid.get(key);
        if (!cell) {
          cell = {
            id: key,
            count: 0,
            sumX: 0,
            sumY: 0,
            sumLat: 0,
            sumLon: 0,
            movingCount: 0,
            types: {},
            firstVessel: v,
            firstP: p,
          };
          grid.set(key, cell);
        }
        cell.count++;
        cell.sumX += p.sx;
        cell.sumY += p.sy;
        cell.sumLat += v.lat;
        cell.sumLon += v.lon;
        if ((v.sog || 0) >= 0.5) cell.movingCount++;
        cell.types[v.type] = (cell.types[v.type] || 0) + 1;
      }

      // Draw singleton vessels & sleek maritime cluster bubbles
      for (const cell of grid.values()) {
        if (cell.count === 1) {
          const v = cell.firstVessel;
          const p = cell.firstP;
          const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
          const angle = this._screenAngle(v, p, sinPhi0, cosPhi0, lam0);
          this.screenVessels.push({ vessel: v, sx: p.sx, sy: p.sy, z: p.z, angle, isSelected: false, isHovered: false });

          if (this.options.showWakes && (v.sog || 0) >= 1.5 && (!v.trail || v.trail.length < 2)) {
            this._drawSternWake(ctx, p.sx, p.sy, angle, v.sog, meta.color, 0.4);
          }
          this._drawShipGlyph(ctx, p.sx, p.sy, angle, Math.max(3.6, baseSize * 0.9), meta.color, false);
          continue;
        }

        // Find dominant vessel type for cluster color
        let domType = 'bulk';
        let domCount = -1;
        for (const [t, c] of Object.entries(cell.types)) {
          if (c > domCount) { domCount = c; domType = t; }
        }
        const meta = VESSEL_TYPES[domType] || VESSEL_TYPES.bulk;
        const sx = cell.sumX / cell.count;
        const sy = cell.sumY / cell.count;
        const r = Math.min(22, 8.5 + Math.log10(cell.count) * 5.6);
        const isHovCluster = cell.id === this.hoveredClusterId;

        const clusterObj = {
          id: cell.id,
          sx,
          sy,
          r,
          lat: cell.sumLat / cell.count,
          lon: cell.sumLon / cell.count,
          count: cell.count,
          movingCount: cell.movingCount,
          types: cell.types,
          dominantType: domType,
        };
        this.screenClusters.push(clusterObj);

        // Outer soft ring
        ctx.save();
        ctx.fillStyle = meta.color;
        ctx.globalAlpha = isHovCluster ? 0.34 : 0.2;
        ctx.beginPath();
        ctx.arc(sx, sy, r + (isHovCluster ? 5 : 3.5), 0, Math.PI * 2);
        ctx.fill();

        // Main cluster pill/circle
        ctx.globalAlpha = isHovCluster ? 0.96 : 0.86;
        ctx.beginPath();
        ctx.arc(sx, sy, r, 0, Math.PI * 2);
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.strokeStyle = isHovCluster ? '#ffffff' : P.clusterRing;
        ctx.lineWidth = isHovCluster ? 1.8 : 1.1;
        ctx.stroke();

        // Tabular cluster count label
        ctx.fillStyle = P.clusterText;
        ctx.font = `700 ${cell.count >= 1000 ? 9.5 : 10.5}px ui-monospace, SFMono-Regular, monospace`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(formatClusterCount(cell.count), sx, sy + 0.5);
        ctx.restore();
      }
    } else {
      // Unclustered / Zoomed-in High-Detail View (relaxes moored deduplication smoothly down to berth level)
      const showAllLabels = this.options.showLabels || this.zoom >= 5.5;
      const maxLabels = this.zoom >= 20 ? 140 : 65;
      const mooredCellPx = this.zoom < 6 ? 6 : this.zoom < 12 ? 3 : 0;
      const placedLabels = [];
      const mooredOccupancy = new Set();

      for (let i = 0; i < candCount; i++) {
        const v = candidates[i];
        const p = this.projectRad(v.lat * DEG2RAD, v.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
        if (p.z < 0.03 || p.sx < -24 || p.sx > wPad || p.sy < -24 || p.sy > hPad) continue;

        const isSel = v.mmsi === this.selectedMmsi;
        const isHov = v.mmsi === this.hoveredMmsi;
        if (isSel || isHov) {
          const angle = this._screenAngle(v, p, sinPhi0, cosPhi0, lam0);
          const entry = { vessel: v, sx: p.sx, sy: p.sy, z: p.z, angle, isSelected: isSel, isHovered: isHov };
          this.screenVessels.push(entry);
          selected.push(entry);
          continue;
        }

        const isMoving = (v.sog || 0) >= 0.5;
        const hasRealTrack = v.trail && v.trail.length > 1;

        // Deduplicate tightly stacked moored/stationary ships until zoomed into harbor detail (>= 12x)
        if (!isMoving && !hasRealTrack && mooredCellPx > 0) {
          const cellKey = `${Math.floor(p.sx / mooredCellPx)}:${Math.floor(p.sy / mooredCellPx)}`;
          if (mooredOccupancy.has(cellKey)) continue;
          mooredOccupancy.add(cellKey);
        }

        const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
        const angle = this._screenAngle(v, p, sinPhi0, cosPhi0, lam0);
        this.screenVessels.push({ vessel: v, sx: p.sx, sy: p.sy, z: p.z, angle, isSelected: false, isHovered: false });

        // 1. Real recorded AIS track (gradient wake!)
        if (this.options.showWakes && hasRealTrack) {
          this._drawGradientTrack(ctx, v.trail, meta.color, 0.75, 1.85, sinPhi0, cosPhi0, lam0, this.zoom >= 25);
        } else if (this.options.showWakes && (v.sog || 0) >= 1.5) {
          // 2. Crisp kinematic stern wake for moving vessels before historical track arrives
          this._drawSternWake(ctx, p.sx, p.sy, angle, v.sog, meta.color, 0.45);
        }

        // Forward ECDIS speed vector tick for moving vessels
        if (this.zoom >= 3.0 && (v.sog || 0) >= 1.5) {
          const tickLen = Math.min(26, baseSize + v.sog * 0.6);
          ctx.save();
          ctx.strokeStyle = meta.color;
          ctx.globalAlpha = 0.58;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(p.sx, p.sy);
          ctx.lineTo(p.sx + Math.cos(angle) * tickLen, p.sy + Math.sin(angle) * tickLen);
          ctx.stroke();
          ctx.restore();
        }

        if (isMoving || this.zoom >= 5.0) {
          this._drawShipGlyph(ctx, p.sx, p.sy, angle, isMoving ? baseSize : baseSize * 0.72, meta.color, false);
        } else {
          // Moored/anchored vessels render as clean compact circles (classic ECDIS convention!)
          ctx.fillStyle = meta.color;
          ctx.globalAlpha = 0.78;
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, Math.max(2.1, baseSize * 0.42), 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        if (showAllLabels && p.z > 0.2 && placedLabels.length < maxLabels && (isMoving || this.zoom >= 8)) {
          const label = `${v.name}${isMoving ? ` · ${v.sog}kn` : ''}`;
          ctx.font = '500 10px system-ui, -apple-system, sans-serif';
          const tw = ctx.measureText(label).width + 8;
          const th = 14;
          const bx = p.sx + 9;
          const by = p.sy - 7;
          if (!placedLabels.some((r) => bx < r.x + r.w && bx + tw > r.x && by < r.y + r.h && by + th > r.y)) {
            placedLabels.push({ x: bx, y: by, w: tw, h: th });
            ctx.fillStyle = P.portLabelBg;
            ctx.fillRect(bx, by, tw, th);
            ctx.fillStyle = P.portLabel;
            ctx.textBaseline = 'middle';
            ctx.fillText(label, bx + 4, by + th / 2);
          }
        }
      }
    }

    // Draw selected & hovered vessels on top with full vivid 24h track & radar ring
    for (const item of selected) {
      const v = item.vessel;
      const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;

      if (v.trail && v.trail.length > 1) {
        this._drawGradientTrack(ctx, v.trail, meta.color, 0.95, 2.5, sinPhi0, cosPhi0, lam0, true);
      } else if ((v.sog || 0) >= 1.0) {
        this._drawSternWake(ctx, item.sx, item.sy, item.angle, v.sog, meta.color, 0.75);
      }

      const vecLen = Math.min(34, baseSize * 1.6 + (v.sog || 0) * 0.75);
      ctx.save();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(item.sx, item.sy);
      ctx.lineTo(item.sx + Math.cos(item.angle) * vecLen, item.sy + Math.sin(item.angle) * vecLen);
      ctx.stroke();
      ctx.restore();

      if (item.isSelected && (v.sog || 0) >= 0.5) {
        this._drawPredictedCourse(ctx, v, meta.color, P, sinPhi0, cosPhi0, lam0);
      }

      if (item.isSelected) {
        const pulse = (ts % 1600) / 1600;
        ctx.strokeStyle = meta.color;
        ctx.globalAlpha = 1 - pulse;
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.arc(item.sx, item.sy, baseSize + 5 + pulse * 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      this._drawShipGlyph(ctx, item.sx, item.sy, item.angle, baseSize * 1.45, meta.color, true);

      if (item.isSelected) {
        const shortText = `${v.name} · ${v.sog} kn · ${v.cog}°`;
        const fullText = v.destination ? `${shortText} → ${v.destination}` : shortText;
        ctx.font = '600 11.5px system-ui, -apple-system, sans-serif';
        const maxBoxW = Math.max(140, this.width - 20);
        let text = fullText;
        let tw = ctx.measureText(text).width;
        if (tw + 14 > maxBoxW) {
          text = shortText;
          tw = ctx.measureText(text).width;
        }
        const boxW = Math.min(maxBoxW, tw + 14);
        let bx = item.sx + 13;
        if (bx + boxW > this.width - 10) bx = item.sx - boxW - 13;
        bx = Math.max(10, Math.min(this.width - boxW - 10, bx));
        const by = Math.max(104, Math.min(this.height - 34, item.sy - 26));
        ctx.fillStyle = P.calloutBg;
        ctx.beginPath();
        ctx.roundRect(bx, by, boxW, 22, 5);
        ctx.fill();
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1.1;
        ctx.stroke();
        ctx.fillStyle = P.calloutText;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + 7, by + 11, boxW - 14);
      }
    }
  }

  _screenAngle(v, p, sinPhi0, cosPhi0, lam0) {
    const cogRad = (v.cog || 0) * DEG2RAD;
    const phi = v.lat * DEG2RAD;
    const stepDeg = Math.max(0.002, 0.4 / Math.max(1, this.zoom * 0.25));
    const lat2 = Math.max(-89, Math.min(89, v.lat + Math.cos(cogRad) * stepDeg));
    const lon2 = v.lon + (Math.sin(cogRad) * stepDeg) / Math.max(0.2, Math.cos(phi));
    const p2 = this.projectRad(lat2 * DEG2RAD, lon2 * DEG2RAD, sinPhi0, cosPhi0, lam0);
    return Math.atan2(p2.sy - p.sy, p2.sx - p.sx);
  }

  /**
   * Progressive fading gradient wake for real recorded AIS track history.
   */
  _drawGradientTrack(ctx, trail, color, maxAlpha, maxWidth, sinPhi0, cosPhi0, lam0, showNodes = false) {
    const n = trail.length;
    if (n < 2) return;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = color;
    const nodeStride = this.zoom >= 40 ? 2 : 6;

    let prev = null;
    for (let i = 0; i < n; i++) {
      const p = this.projectRad(trail[i][0] * DEG2RAD, trail[i][1] * DEG2RAD, sinPhi0, cosPhi0, lam0);
      if (p.z <= 0.02) {
        prev = null;
        continue;
      }
      if (prev) {
        const frac = i / (n - 1); // 0 = oldest, 1 = newest near stern
        ctx.globalAlpha = maxAlpha * (0.15 + 0.85 * frac * frac);
        ctx.lineWidth = Math.max(0.8, maxWidth * (0.45 + 0.55 * frac));
        ctx.beginPath();
        ctx.moveTo(prev.sx, prev.sy);
        ctx.lineTo(p.sx, p.sy);
        ctx.stroke();

        if (showNodes && (i === 1 || i % nodeStride === 0)) {
          ctx.fillStyle = color;
          ctx.globalAlpha = maxAlpha * (0.35 + 0.65 * frac);
          ctx.beginPath();
          ctx.arc(p.sx, p.sy, 2.2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      prev = p;
    }
    ctx.restore();
  }

  /**
   * Subtle tapered stern wake opposite true COG for moving ships while historical track loads.
   */
  _drawSternWake(ctx, sx, sy, angle, sog, color, alpha) {
    const len = Math.min(26, 7 + sog * 0.85);
    const tailX = sx - Math.cos(angle) * len;
    const tailY = sy - Math.sin(angle) * len;

    ctx.save();
    const grad = ctx.createLinearGradient(sx, sy, tailX, tailY);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.strokeStyle = grad;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Dead Reckoning 15m / 30m / 60m predicted course vector for selected moving vessel.
   */
  _drawPredictedCourse(ctx, v, color, P, sinPhi0, cosPhi0, lam0) {
    const sog = Number(v.sog) || 0;
    const cog = Number(v.cog) || 0;
    if (sog < 0.5) return;

    const p0 = this.projectRad(v.lat * DEG2RAD, v.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
    const p60 = _destinationPoint(v.lat, v.lon, cog, sog);
    const s60 = this.projectRad(p60.lat * DEG2RAD, p60.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
    if (p0.z <= 0.02 || s60.z <= 0.02) return;
    if (Math.hypot(s60.sx - p0.sx, s60.sy - p0.sy) < 14) return;

    const p15 = _destinationPoint(v.lat, v.lon, cog, sog * 0.25);
    const p30 = _destinationPoint(v.lat, v.lon, cog, sog * 0.5);
    const s15 = this.projectRad(p15.lat * DEG2RAD, p15.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
    const s30 = this.projectRad(p30.lat * DEG2RAD, p30.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);

    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.82;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath();
    ctx.moveTo(p0.sx, p0.sy);
    ctx.lineTo(s15.sx, s15.sy);
    ctx.lineTo(s30.sx, s30.sy);
    ctx.lineTo(s60.sx, s60.sy);
    ctx.stroke();
    ctx.setLineDash([]);

    const marks = [
      { pt: s15, label: '+15m' },
      { pt: s30, label: '+30m' },
      { pt: s60, label: '+60m' },
    ];
    ctx.font = '600 9.5px ui-monospace, SFMono-Regular, monospace';
    ctx.textBaseline = 'middle';
    let lastX = p0.sx;
    let lastY = p0.sy;
    for (const m of marks) {
      if (m.pt.z <= 0.02) continue;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(m.pt.sx, m.pt.sy, 2.8, 0, Math.PI * 2);
      ctx.fill();
      if (Math.hypot(m.pt.sx - lastX, m.pt.sy - lastY) >= 26) {
        const tw = ctx.measureText(m.label).width + 6;
        ctx.fillStyle = P.calloutBg;
        ctx.fillRect(m.pt.sx + 5, m.pt.sy - 7, tw, 13);
        ctx.fillStyle = color;
        ctx.fillText(m.label, m.pt.sx + 8, m.pt.sy);
        lastX = m.pt.sx;
        lastY = m.pt.sy;
      }
    }
    ctx.restore();
  }

  /**
   * 15NM spherical geofence ring around the active port filter.
   */
  _drawPortRadiusRing(ctx, P, sinPhi0, cosPhi0, lam0) {
    const pf = this.activePortFilter;
    if (!pf) return;
    const radiusNm = pf.radiusNm || 15;
    const steps = 48;
    ctx.save();
    ctx.strokeStyle = '#38bdf8';
    ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    let started = false;
    for (let i = 0; i <= steps; i++) {
      const b = (i / steps) * 360;
      const pt = _destinationPoint(pf.lat, pf.lon, b, radiusNm);
      const sp = this.projectRad(pt.lat * DEG2RAD, pt.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
      if (sp.z <= 0.02) continue;
      if (!started) {
        ctx.moveTo(sp.sx, sp.sy);
        started = true;
      } else {
        ctx.lineTo(sp.sx, sp.sy);
      }
    }
    if (started) {
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.setLineDash([]);

    const topPt = _destinationPoint(pf.lat, pf.lon, 0, radiusNm);
    const spTop = this.projectRad(topPt.lat * DEG2RAD, topPt.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
    if (spTop.z > 0.05) {
      const pName = this.lang === 'ko' ? pf.name : (pf.nameEn || pf.name);
      const label = this.lang === 'ko' ? `${pName} · ${radiusNm}NM 관제권` : `${pName} · ${radiusNm}NM Zone`;
      ctx.font = '600 10.5px system-ui, -apple-system, sans-serif';
      const tw = ctx.measureText(label).width + 10;
      ctx.fillStyle = P.calloutBg;
      ctx.beginPath();
      ctx.roundRect(spTop.sx - tw / 2, spTop.sy - 18, tw, 17, 4);
      ctx.fill();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = '#38bdf8';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, spTop.sx, spTop.sy - 9.5);
    }
    ctx.restore();
  }

  /**
   * Great-circle distance, true bearing, and live-speed ETA ruler overlay.
   */
  _drawMeasureOverlay(ctx, P, sinPhi0, cosPhi0, lam0) {
    const pts = this.measurePoints;
    if (!pts.length) return;

    ctx.save();
    if (pts.length === 2) {
      const [a, b] = pts;
      const nm = _haversineNm(a.lat, a.lon, b.lat, b.lon);
      const km = nm * 1.852;
      const brg = _initialBearing(a.lat, a.lon, b.lat, b.lon);
      const segs = Math.max(16, Math.min(64, Math.ceil(nm / 40)));

      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 2.2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i <= segs; i++) {
        const p = _slerpLatLon(a.lat, a.lon, b.lat, b.lon, i / segs);
        const sp = this.projectRad(p.lat * DEG2RAD, p.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
        if (sp.z > 0.02) {
          if (!drawing) { ctx.moveTo(sp.sx, sp.sy); drawing = true; }
          else ctx.lineTo(sp.sx, sp.sy);
        } else {
          drawing = false;
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);

      const mid = _slerpLatLon(a.lat, a.lon, b.lat, b.lon, 0.5);
      const sMid = this.projectRad(mid.lat * DEG2RAD, mid.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
      if (sMid.z > 0.02) {
        const speedKn = a.speedKn && a.speedKn >= 0.5 ? a.speedKn : 0;
        let etaStr = '';
        if (speedKn > 0) {
          const hrs = nm / speedKn;
          const d = Math.floor(hrs / 24);
          const h = Math.floor(hrs % 24);
          const m = Math.round((hrs - Math.floor(hrs)) * 60);
          etaStr = d > 0 ? ` · ETA ${d}d ${h}h (${speedKn}kn)` : ` · ETA ${h}h ${m}m (${speedKn}kn)`;
        }
        const badge = `${nm.toFixed(1)} NM (${km.toFixed(1)} km) · ${Math.round(brg)}°${etaStr}`;
        ctx.font = '600 11px ui-monospace, SFMono-Regular, monospace';
        const tw = ctx.measureText(badge).width + 16;
        const bx = Math.max(10, Math.min(this.width - tw - 10, sMid.sx - tw / 2));
        const by = Math.max(76, Math.min(this.height - 64, sMid.sy - 26));
        ctx.fillStyle = P.calloutBg;
        ctx.beginPath();
        ctx.roundRect(bx, by, tw, 24, 6);
        ctx.fill();
        ctx.strokeStyle = '#f59e0b';
        ctx.lineWidth = 1.3;
        ctx.stroke();
        ctx.fillStyle = '#fbbf24';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(badge, bx + 8, by + 12);
      }
    }

    // Draw A / B endpoint pins
    pts.forEach((pt, idx) => {
      const sp = this.projectRad(pt.lat * DEG2RAD, pt.lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
      if (sp.z <= 0.02) return;
      ctx.fillStyle = '#f59e0b';
      ctx.beginPath();
      ctx.arc(sp.sx, sp.sy, 6.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#04101d';
      ctx.font = '700 9.5px ui-monospace, SFMono-Regular, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(idx === 0 ? 'A' : 'B', sp.sx, sp.sy + 0.5);
    });
    ctx.restore();
  }

  _pickPort(mx, my, isTouch = false) {
    if (!this.options.showPorts || !this.screenPorts.length) return null;
    const pad = isTouch ? 14 : 7;
    let best = null;
    let bestDist = Infinity;
    for (const sp of this.screenPorts) {
      const inLabel =
        mx >= sp.lx - pad && mx <= sp.lx + sp.w + pad && my >= sp.ly - pad && my <= sp.ly + sp.h + pad;
      const dist = Math.hypot(mx - sp.sx, my - sp.sy);
      if (dist <= (isTouch ? 20 : 11) || inLabel) {
        if (dist < bestDist) {
          bestDist = dist;
          best = sp.port;
        }
      }
    }
    return best;
  }

  setMeasureMode(enabled, anchorPoint = null) {
    this.measureMode = Boolean(enabled);
    this.measurePoints = this.measureMode && anchorPoint ? [anchorPoint] : [];
    this.canvas.style.cursor = this.measureMode ? 'crosshair' : 'grab';
    this._dirty = true;
    this._notifyMeasure();
  }

  clearMeasure() {
    this.measureMode = false;
    this.measurePoints = [];
    this.canvas.style.cursor = 'grab';
    this._dirty = true;
    this._notifyMeasure();
  }

  _notifyMeasure() {
    if (this.measurePoints.length === 2) {
      const [a, b] = this.measurePoints;
      const nm = _haversineNm(a.lat, a.lon, b.lat, b.lon);
      const brg = _initialBearing(a.lat, a.lon, b.lat, b.lon);
      this.onMeasureChange({ mode: this.measureMode, points: this.measurePoints, nm, km: nm * 1.852, bearing: brg });
    } else {
      this.onMeasureChange({ mode: this.measureMode, points: this.measurePoints, nm: null, km: null, bearing: null });
    }
  }

  setActivePortFilter(port) {
    this.activePortFilter = port ? { ...port, radiusNm: port.radiusNm || 15 } : null;
    this._dirty = true;
  }

  setLang(lang) {
    this.lang = lang === 'ko' ? 'ko' : 'en';
    this._dirty = true;
  }

  /**
   * Export current 3D globe canvas as a high-DPI PNG data URL with UTC timestamp watermark.
   */
  exportPngDataUrl() {
    this.render(performance.now());
    const out = document.createElement('canvas');
    out.width = this.canvas.width;
    out.height = this.canvas.height;
    const octx = out.getContext('2d');
    octx.drawImage(this.canvas, 0, 0);
    const dpr = this.dpr || 1;
    const stamp = `MarineGlobe 3D · 100% Live AIS · ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`;
    octx.save();
    octx.scale(dpr, dpr);
    octx.font = '600 11px ui-monospace, SFMono-Regular, monospace';
    const tw = octx.measureText(stamp).width + 16;
    const x = this.width - tw - 14;
    const y = this.height - 32;
    octx.fillStyle = 'rgba(4, 11, 20, 0.78)';
    octx.beginPath();
    octx.roundRect(x, y, tw, 22, 5);
    octx.fill();
    octx.fillStyle = '#38bdf8';
    octx.textBaseline = 'middle';
    octx.fillText(stamp, x + 8, y + 11);
    octx.restore();
    return out.toDataURL('image/png');
  }

  _drawShipGlyph(ctx, x, y, angle, size, color, emphasized) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(size * 1.35, 0);
    ctx.lineTo(-size * 0.85, -size * 0.65);
    ctx.lineTo(-size * 0.45, 0);
    ctx.lineTo(-size * 0.85, size * 0.65);
    ctx.closePath();

    ctx.fillStyle = color;
    ctx.fill();

    if (emphasized) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.4;
      ctx.stroke();
    }
    ctx.restore();
  }
}
