/**
 * MarineGlobe 3D — High-DPI Interactive 3D Spherical Projection Globe Engine.
 * Zero external dependencies. Renders continents, graticules, real-time solar
 * day/night terminator, atmospheric limb glow, shipping lanes, ports, and
 * hundreds of real-time directional AIS vessels with wake trails at 60 FPS.
 */

import {
  WORLD_POLYGONS,
  PORTS_DATA,
  CORRIDOR_LINES,
  VESSEL_TYPES,
} from './world-data.js';

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

/**
 * Convert geographic (lat, lon) in degrees to 3D unit vector.
 */
function latLonToVec3(lat, lon) {
  const phi = lat * DEG2RAD;
  const lam = lon * DEG2RAD;
  const cosPhi = Math.cos(phi);
  return [cosPhi * Math.cos(lam), Math.sin(phi), cosPhi * Math.sin(lam)];
}

/**
 * Subdivide polygon rings in 3D spherical space so coastlines curve smoothly
 * around the 3D globe and clip cleanly at the horizon.
 */
function subdivideRing(ring, maxStepDeg = 3.0) {
  const out = [];
  for (let i = 0; i < ring.length; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[(i + 1) % ring.length];
    out.push([lat1 * DEG2RAD, lon1 * DEG2RAD]);

    let dLon = lon2 - lon1;
    if (dLon > 180) dLon -= 360;
    if (dLon < -180) dLon += 360;
    const dLat = lat2 - lat1;
    const span = Math.hypot(dLon, dLat);
    if (span > maxStepDeg) {
      const steps = Math.ceil(span / maxStepDeg);
      for (let s = 1; s < steps; s++) {
        const t = s / steps;
        out.push([(lat1 + dLat * t) * DEG2RAD, (lon1 + dLon * t) * DEG2RAD]);
      }
    }
  }
  return out;
}

/**
 * Compute current subsolar point (lat, lon in radians) for real-time day/night shading.
 */
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

export class GlobeEngine {
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.onSelectVessel = options.onSelectVessel || (() => {});
    this.onHoverVessel = options.onHoverVessel || (() => {});
    this.onCameraChange = options.onCameraChange || (() => {});

    // Camera state (degrees)
    this.centerLat = options.initialLat ?? 24;
    this.centerLon = options.initialLon ?? 122;
    this.zoom = options.initialZoom ?? 1.1;
    this.minZoom = 0.85;
    this.maxZoom = 6.5;

    // Velocity inertia & smooth fly-to animation
    this.velLon = 0;
    this.velLat = 0;
    this.flyTarget = null;
    this.isDragging = false;
    this.dragMoved = false;
    this.lastPointer = { x: 0, y: 0 };

    // Layer toggles
    this.options = {
      autoRotate: false,
      showDayNight: true,
      showLanes: true,
      showPorts: true,
      showWakes: true,
      showGraticule: true,
      theme: options.theme || 'dark',
    };

    // Data state
    this.vessels = [];
    this.selectedMmsi = null;
    this.hoveredMmsi = null;
    this.followSelected = false;
    this.screenVessels = []; // Cached projected positions for hit-testing

    // Pre-subdivided world polygons & corridor curves
    this.preparedPolygons = WORLD_POLYGONS.map((ring) => subdivideRing(ring, 3.2));
    this.preparedCorridors = CORRIDOR_LINES.map((line) => {
      const pts = [];
      for (let i = 0; i < line.length - 1; i++) {
        const [lat1, lon1] = line[i];
        const [lat2, lon2] = line[i + 1];
        let dLon = lon2 - lon1;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        const steps = Math.max(2, Math.ceil(Math.hypot(dLon, lat2 - lat1) / 3));
        for (let s = 0; s < steps; s++) {
          const t = s / steps;
          pts.push([(lat1 + (lat2 - lat1) * t) * DEG2RAD, (lon1 + dLon * t) * DEG2RAD]);
        }
      }
      const last = line[line.length - 1];
      pts.push([last[0] * DEG2RAD, last[1] * DEG2RAD]);
      return pts;
    });

    // Subtle background starfield (dark theme)
    this.stars = Array.from({ length: 140 }, (_, i) => {
      const s1 = Math.sin(i * 127.1) * 43758.5453;
      const s2 = Math.sin(i * 269.5) * 43758.5453;
      const s3 = Math.sin(i * 419.2) * 43758.5453;
      return {
        nx: s1 - Math.floor(s1),
        ny: s2 - Math.floor(s2),
        r: 0.5 + (s3 - Math.floor(s3)) * 1.1,
        a: 0.15 + (s3 - Math.floor(s3)) * 0.45,
      };
    });

    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.cx = 0;
    this.cy = 0;
    this.radius = 200;

    this._rafId = null;
    this._lastFrameTs = performance.now();

    this._bindEvents();
    this.resize();
    this.start();
  }

  setVessels(vessels) {
    this.vessels = vessels;
  }

  setSelectedVessel(mmsi, follow = false) {
    this.selectedMmsi = mmsi;
    this.followSelected = Boolean(mmsi && follow);
  }

  setOption(key, value) {
    this.options[key] = value;
  }

  setTheme(theme) {
    this.options.theme = theme;
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
  }

  zoomBy(factor) {
    const targetZoom = Math.max(
      this.minZoom,
      Math.min(this.maxZoom, this.zoom * factor)
    );
    this.flyTo(this.centerLat, this.centerLon, targetZoom, 240);
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
  }

  /**
   * Project geographic radians (phi, lam) to 3D view-space and 2D screen coords.
   */
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

  /**
   * Inverse projection: screen (mx, my) -> geographic {lat, lon} if on sphere.
   */
  unproject(mx, my) {
    const nx = (mx - this.cx) / this.radius;
    const ny = (this.cy - my) / this.radius;
    const r2 = nx * nx + ny * ny;
    if (r2 > 1) return null;

    const z = Math.sqrt(Math.max(0, 1 - r2));
    const phi0 = this.centerLat * DEG2RAD;
    const lam0 = this.centerLon * DEG2RAD;
    const sinPhi0 = Math.sin(phi0);
    const cosPhi0 = Math.cos(phi0);

    const lat = Math.asin(Math.max(-1, Math.min(1, z * sinPhi0 + ny * cosPhi0))) * RAD2DEG;
    const lon =
      (lam0 + Math.atan2(nx, z * cosPhi0 - ny * sinPhi0)) * RAD2DEG;
    return {
      lat,
      lon: (((lon + 180) % 360) + 360) % 360 - 180,
    };
  }

  _bindEvents() {
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.canvas.setPointerCapture(e.pointerId);
      this.isDragging = true;
      this.dragMoved = false;
      this.flyTarget = null;
      this.velLat = 0;
      this.velLon = 0;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.canvas.style.cursor = 'grabbing';
    });

    this.canvas.addEventListener('pointermove', (e) => {
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      if (this.isDragging) {
        const dx = e.clientX - this.lastPointer.x;
        const dy = e.clientY - this.lastPointer.y;
        if (Math.hypot(dx, dy) > 2) {
          this.dragMoved = true;
          this.followSelected = false;
        }
        const degPerPx = 90 / Math.max(80, this.radius);
        const dLon = -dx * degPerPx;
        const dLat = dy * degPerPx;

        this.centerLon = (((this.centerLon + dLon + 180) % 360) + 360) % 360 - 180;
        this.centerLat = Math.max(-82, Math.min(82, this.centerLat + dLat));
        this.velLon = dLon;
        this.velLat = dLat;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        return;
      }

      // Hit-test hovered vessel
      const hit = this._pickVessel(mx, my);
      const hitId = hit ? hit.mmsi : null;
      if (hitId !== this.hoveredMmsi) {
        this.hoveredMmsi = hitId;
        this.canvas.style.cursor = hit ? 'pointer' : 'grab';
      }
      this.onHoverVessel(hit, mx, my);
    });

    const endDrag = (e) => {
      if (!this.isDragging) return;
      this.isDragging = false;
      this.canvas.style.cursor = this.hoveredMmsi ? 'pointer' : 'grab';

      if (!this.dragMoved) {
        const rect = this.canvas.getBoundingClientRect();
        const hit = this._pickVessel(e.clientX - rect.left, e.clientY - rect.top);
        if (hit) {
          this.onSelectVessel(hit);
        }
      }
    };

    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);
    this.canvas.addEventListener('pointerleave', () => {
      if (!this.isDragging) {
        this.hoveredMmsi = null;
        this.onHoverVessel(null, 0, 0);
      }
    });

    this.canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.flyTarget = null;
        const factor = e.deltaY < 0 ? 1.14 : 0.88;
        this.zoom = Math.max(this.minZoom, Math.min(this.maxZoom, this.zoom * factor));
        this.radius = this.baseRadius * this.zoom;
      },
      { passive: false }
    );
  }

  _pickVessel(mx, my) {
    let best = null;
    let bestDist = 14; // Click/hover tolerance in px
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

  start() {
    if (this._rafId) return;
    const loop = (ts) => {
      const dt = Math.min(0.05, (ts - this._lastFrameTs) / 1000);
      this._lastFrameTs = ts;
      this._updateCamera(ts, dt);
      this.render(ts);
      this._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  destroy() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    window.removeEventListener('resize', this._onResize);
  }

  _updateCamera(ts, dt) {
    // 1. Fly-to animation
    if (this.flyTarget) {
      const f = this.flyTarget;
      const t = Math.min(1, (ts - f.startTs) / f.durationMs);
      const ease = 1 - Math.pow(1 - t, 3);
      this.centerLat = f.startLat + (f.targetLat - f.startLat) * ease;
      const lon = f.startLon + (f.targetLon - f.startLon) * ease;
      this.centerLon = (((lon + 180) % 360) + 360) % 360 - 180;
      this.zoom = f.startZoom + (f.targetZoom - f.startZoom) * ease;
      if (t >= 1) this.flyTarget = null;
    } else if (this.followSelected && this.selectedMmsi) {
      // 2. Smooth vessel tracking lock
      const target = this.vessels.find((v) => v.mmsi === this.selectedMmsi);
      if (target) {
        let dLon = target.lon - this.centerLon;
        if (dLon > 180) dLon -= 360;
        if (dLon < -180) dLon += 360;
        this.centerLon = (((this.centerLon + dLon * 0.08 + 180) % 360) + 360) % 360 - 180;
        this.centerLat += (target.lat - this.centerLat) * 0.08;
      }
    } else if (!this.isDragging) {
      // 3. Inertia decay
      if (Math.abs(this.velLon) > 0.005 || Math.abs(this.velLat) > 0.005) {
        this.centerLon =
          (((this.centerLon + this.velLon + 180) % 360) + 360) % 360 - 180;
        this.centerLat = Math.max(-82, Math.min(82, this.centerLat + this.velLat));
        this.velLon *= 0.91;
        this.velLat *= 0.91;
      } else if (this.options.autoRotate) {
        // 4. Gentle auto-rotation
        this.centerLon =
          (((this.centerLon + dt * 5.2 + 180) % 360) + 360) % 360 - 180;
      }
    }

    this.radius = this.baseRadius * this.zoom;
    this.onCameraChange({
      lat: this.centerLat,
      lon: this.centerLon,
      zoom: this.zoom,
    });
  }

  _getPalette() {
    if (this.options.theme === 'light') {
      return {
        spaceBg: '#e8eff5',
        oceanInner: '#d4e7f5',
        oceanMid: '#b5d4ea',
        oceanEdge: '#89b4d4',
        atmosphere: 'rgba(14, 116, 144, 0.22)',
        rimStroke: 'rgba(15, 76, 117, 0.35)',
        graticule: 'rgba(15, 76, 117, 0.12)',
        equator: 'rgba(14, 116, 144, 0.28)',
        landFill: '#e2e8e4',
        landStroke: '#7f998f',
        laneStroke: 'rgba(14, 116, 144, 0.25)',
        nightTint: 'rgba(15, 35, 58, 0.26)',
        portDot: '#0f766e',
        portLabel: '#0f172a',
        portLabelBg: 'rgba(255, 255, 255, 0.78)',
        calloutBg: 'rgba(15, 23, 42, 0.9)',
        calloutText: '#f8fafc',
      };
    }
    return {
      spaceBg: '#040b14',
      oceanInner: '#0d263e',
      oceanMid: '#091b2e',
      oceanEdge: '#040d18',
      atmosphere: 'rgba(56, 189, 248, 0.26)',
      rimStroke: 'rgba(56, 189, 248, 0.34)',
      graticule: 'rgba(148, 197, 233, 0.085)',
      equator: 'rgba(56, 189, 248, 0.22)',
      landFill: '#17293b',
      landStroke: '#2d4b66',
      laneStroke: 'rgba(56, 189, 248, 0.16)',
      nightTint: 'rgba(2, 6, 14, 0.42)',
      portDot: '#38bdf8',
      portLabel: '#cbd5e1',
      portLabelBg: 'rgba(6, 17, 29, 0.74)',
      calloutBg: 'rgba(6, 17, 29, 0.92)',
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

    // 1. Background canvas
    ctx.fillStyle = P.spaceBg;
    ctx.fillRect(0, 0, this.width, this.height);

    // Subtle stars in dark mode
    if (this.options.theme !== 'light') {
      for (const st of this.stars) {
        ctx.fillStyle = `rgba(203, 225, 246, ${st.a})`;
        ctx.beginPath();
        ctx.arc(st.nx * this.width, st.ny * this.height, st.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // 2. Outer atmospheric halo
    const halo = ctx.createRadialGradient(cx, cy, R * 0.94, cx, cy, R * 1.13);
    halo.addColorStop(0, P.atmosphere);
    halo.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.13, 0, Math.PI * 2);
    ctx.fill();

    // 3. Clip to Earth sphere disk
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.clip();

    // 4. 3D spherical ocean gradient
    const oceanGrad = ctx.createRadialGradient(
      cx - R * 0.28,
      cy - R * 0.25,
      R * 0.08,
      cx,
      cy,
      R * 1.02
    );
    oceanGrad.addColorStop(0, P.oceanInner);
    oceanGrad.addColorStop(0.62, P.oceanMid);
    oceanGrad.addColorStop(1, P.oceanEdge);
    ctx.fillStyle = oceanGrad;
    ctx.fillRect(cx - R - 2, cy - R - 2, R * 2 + 4, R * 2 + 4);

    const phi0 = this.centerLat * DEG2RAD;
    const lam0 = this.centerLon * DEG2RAD;
    const sinPhi0 = Math.sin(phi0);
    const cosPhi0 = Math.cos(phi0);

    // 5. Graticule (lat/lon grid)
    if (this.options.showGraticule) {
      this._drawGraticule(ctx, P, sinPhi0, cosPhi0, lam0);
    }

    // 6. World Continents & Islands (with smooth horizon clamping)
    this._drawContinents(ctx, P, sinPhi0, cosPhi0, lam0);

    // 7. Real-Time Solar Terminator (Day/Night hemisphere shading)
    const sun = getSubsolarRad();
    const sunVec = latLonToVec3(sun.phi * RAD2DEG, sun.lam * RAD2DEG);
    if (this.options.showDayNight) {
      this._drawDayNightOverlay(ctx, P, sinPhi0, cosPhi0, lam0, sun);
    }

    // 8. Global Shipping Lanes
    if (this.options.showLanes) {
      this._drawCorridors(ctx, P, sinPhi0, cosPhi0, lam0);
    }

    // 9. Major Ports (with warm night-side lights!)
    if (this.options.showPorts) {
      this._drawPorts(ctx, P, sinPhi0, cosPhi0, lam0, sunVec);
    }

    // 10. Vessels & Wakes
    this._drawVessels(ctx, P, sinPhi0, cosPhi0, lam0, ts);

    ctx.restore(); // End sphere clip

    // 11. Crisp sphere rim outline
    ctx.strokeStyle = P.rimStroke;
    ctx.lineWidth = 1.25;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();

    ctx.restore();
  }

  _drawGraticule(ctx, P, sinPhi0, cosPhi0, lam0) {
    const step = this.zoom > 2.6 ? 10 : 20;
    ctx.lineWidth = 0.7;

    // Parallels (latitude lines)
    for (let lat = -80; lat <= 80; lat += step) {
      ctx.strokeStyle = lat === 0 ? P.equator : P.graticule;
      ctx.beginPath();
      let started = false;
      const phi = lat * DEG2RAD;
      for (let lon = -180; lon <= 180; lon += 4) {
        const p = this.projectRad(phi, lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
        if (p.z > 0) {
          if (!started) {
            ctx.moveTo(p.sx, p.sy);
            started = true;
          } else {
            ctx.lineTo(p.sx, p.sy);
          }
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }

    // Meridians (longitude lines)
    for (let lon = -180; lon < 180; lon += step) {
      ctx.strokeStyle = lon === 0 ? P.equator : P.graticule;
      ctx.beginPath();
      let started = false;
      const lam = lon * DEG2RAD;
      for (let lat = -84; lat <= 84; lat += 4) {
        const p = this.projectRad(lat * DEG2RAD, lam, sinPhi0, cosPhi0, lam0);
        if (p.z > 0) {
          if (!started) {
            ctx.moveTo(p.sx, p.sy);
            started = true;
          } else {
            ctx.lineTo(p.sx, p.sy);
          }
        } else {
          started = false;
        }
      }
      ctx.stroke();
    }
  }

  _drawContinents(ctx, P, sinPhi0, cosPhi0, lam0) {
    ctx.fillStyle = P.landFill;
    ctx.strokeStyle = P.landStroke;
    ctx.lineWidth = Math.max(0.8, Math.min(1.5, 0.9 * Math.sqrt(this.zoom)));
    ctx.lineJoin = 'round';

    const cx = this.cx;
    const cy = this.cy;
    const R = this.radius;

    for (const ring of this.preparedPolygons) {
      let anyVisible = false;
      const projected = new Array(ring.length);

      for (let i = 0; i < ring.length; i++) {
        const [phi, lam] = ring[i];
        const p = this.projectRad(phi, lam, sinPhi0, cosPhi0, lam0);
        if (p.z > 0) anyVisible = true;
        projected[i] = p;
      }
      if (!anyVisible) continue;

      ctx.beginPath();
      for (let i = 0; i < projected.length; i++) {
        const p = projected[i];
        let sx = p.sx;
        let sy = p.sy;
        if (p.z < 0) {
          // Project back-hemisphere boundary radially onto horizon rim
          const mag = Math.hypot(p.x, p.y) || 1e-6;
          sx = cx + (p.x / mag) * (R + 1.5);
          sy = cy - (p.y / mag) * (R + 1.5);
        }
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  }

  _drawDayNightOverlay(ctx, P, sinPhi0, cosPhi0, lam0, sun) {
    // Subsolar vector in view space
    const sunProj = this.projectRad(sun.phi, sun.lam, sinPhi0, cosPhi0, lam0);
    // Antisolar (midnight) center in screen coordinates
    const nightX = this.cx - sunProj.x * this.radius * 0.92;
    const nightY = this.cy + sunProj.y * this.radius * 0.92;

    const grad = ctx.createRadialGradient(
      nightX,
      nightY,
      this.radius * 0.15,
      nightX,
      nightY,
      this.radius * 1.45
    );
    grad.addColorStop(0, P.nightTint);
    grad.addColorStop(0.55, P.nightTint);
    grad.addColorStop(1, 'rgba(0,0,0,0)');

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(this.cx, this.cy, this.radius + 2, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawCorridors(ctx, P, sinPhi0, cosPhi0, lam0) {
    ctx.save();
    ctx.strokeStyle = P.laneStroke;
    ctx.lineWidth = Math.max(0.9, 0.95 * Math.sqrt(this.zoom));
    ctx.setLineDash([4, 5]);

    for (const pts of this.preparedCorridors) {
      ctx.beginPath();
      let drawing = false;
      for (let i = 0; i < pts.length; i++) {
        const [phi, lam] = pts[i];
        const p = this.projectRad(phi, lam, sinPhi0, cosPhi0, lam0);
        if (p.z > 0.02) {
          if (!drawing) {
            ctx.moveTo(p.sx, p.sy);
            drawing = true;
          } else {
            ctx.lineTo(p.sx, p.sy);
          }
        } else {
          drawing = false;
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawPorts(ctx, P, sinPhi0, cosPhi0, lam0, sunVec) {
    ctx.font = '500 11px system-ui, -apple-system, sans-serif';
    ctx.textBaseline = 'middle';

    for (const port of PORTS_DATA) {
      if (!port.major && this.zoom < 1.8) continue;
      const p = this.projectRad(
        port.lat * DEG2RAD,
        port.lon * DEG2RAD,
        sinPhi0,
        cosPhi0,
        lam0
      );
      if (p.z < 0.12) continue;

      // Check if port is on the night side to add a subtle harbor glow
      const pv = latLonToVec3(port.lat, port.lon);
      const sunDot = pv[0] * sunVec[0] + pv[1] * sunVec[1] + pv[2] * sunVec[2];
      const isNight = this.options.showDayNight && sunDot < -0.05;

      if (isNight && this.options.theme !== 'light') {
        const glow = ctx.createRadialGradient(p.sx, p.sy, 0, p.sx, p.sy, 11);
        glow.addColorStop(0, 'rgba(251, 191, 36, 0.55)');
        glow.addColorStop(1, 'rgba(251, 191, 36, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, 11, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.fillStyle = isNight ? '#fbbf24' : P.portDot;
      ctx.beginPath();
      ctx.arc(p.sx, p.sy, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Draw crisp label pill
      const label = port.name;
      const tw = ctx.measureText(label).width;
      const lx = p.sx + 6;
      const ly = p.sy;
      ctx.fillStyle = P.portLabelBg;
      ctx.fillRect(lx - 3, ly - 8, tw + 6, 16);
      ctx.fillStyle = P.portLabel;
      ctx.fillText(label, lx, ly);
    }
  }

  _drawVessels(ctx, P, sinPhi0, cosPhi0, lam0, ts) {
    this.screenVessels = [];
    const selected = [];
    const baseSize = Math.max(3.6, Math.min(7.4, 3.8 + this.zoom * 0.78));
    const showAllLabels = this.options.showLabels || this.zoom >= 3.6;
    const placedLabels = [];

    for (const v of this.vessels) {
      const phi = v.lat * DEG2RAD;
      const lam = v.lon * DEG2RAD;
      const p = this.projectRad(phi, lam, sinPhi0, cosPhi0, lam0);
      if (p.z < 0.03) continue;

      const isSelected = v.mmsi === this.selectedMmsi;
      const isHovered = v.mmsi === this.hoveredMmsi;

      // Compute true 3D screen heading by projecting a small step along COG
      const cogRad = (v.cog || 0) * DEG2RAD;
      const stepDeg = 0.6;
      const lat2 = Math.max(-89, Math.min(89, v.lat + Math.cos(cogRad) * stepDeg));
      const lon2 =
        v.lon + (Math.sin(cogRad) * stepDeg) / Math.max(0.2, Math.cos(phi));
      const p2 = this.projectRad(lat2 * DEG2RAD, lon2 * DEG2RAD, sinPhi0, cosPhi0, lam0);
      const angle = Math.atan2(p2.sy - p.sy, p2.sx - p.sx);

      const entry = { vessel: v, sx: p.sx, sy: p.sy, z: p.z, angle, isSelected, isHovered };
      this.screenVessels.push(entry);

      if (isSelected || isHovered) {
        selected.push(entry);
        continue;
      }

      const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;
      if (this.options.showWakes && v.trail && v.trail.length > 1) {
        this._drawWake(ctx, v.trail, meta.color, 0.28, 1.0, sinPhi0, cosPhi0, lam0);
      }

      // Subtle ECDIS speed leader tick when zoomed in
      if (this.zoom >= 2.2 && v.sog > 1) {
        const tickLen = Math.min(18, baseSize + v.sog * 0.45);
        ctx.save();
        ctx.strokeStyle = meta.color;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(p.sx, p.sy);
        ctx.lineTo(p.sx + Math.cos(angle) * tickLen, p.sy + Math.sin(angle) * tickLen);
        ctx.stroke();
        ctx.restore();
      }

      this._drawShipGlyph(ctx, p.sx, p.sy, angle, baseSize, meta.color, false);

      // Collision-free inline vessel labels when enabled or closely zoomed
      if (showAllLabels && p.z > 0.22 && placedLabels.length < 70) {
        const label = `${v.name} · ${v.sog}kn`;
        ctx.font = '500 10px system-ui, -apple-system, sans-serif';
        const tw = ctx.measureText(label).width + 8;
        const th = 14;
        const bx = p.sx + 8;
        const by = p.sy - 7;
        let overlaps = false;
        for (let j = 0; j < placedLabels.length; j++) {
          const r = placedLabels[j];
          if (bx < r.x + r.w && bx + tw > r.x && by < r.y + r.h && by + th > r.y) {
            overlaps = true;
            break;
          }
        }
        if (!overlaps) {
          placedLabels.push({ x: bx, y: by, w: tw, h: th });
          ctx.fillStyle = P.portLabelBg;
          ctx.fillRect(bx, by, tw, th);
          ctx.fillStyle = P.portLabel;
          ctx.textBaseline = 'middle';
          ctx.fillText(label, bx + 4, by + th / 2);
        }
      }
    }

    // Draw hovered & selected vessels on top with full wake, planned route, and radar ring
    for (const item of selected) {
      const v = item.vessel;
      const meta = VESSEL_TYPES[v.type] || VESSEL_TYPES.bulk;

      if (v.routeAhead && v.routeAhead.length > 1) {
        this._drawPlannedRoute(ctx, v.routeAhead, meta.color, sinPhi0, cosPhi0, lam0);
      }

      if (v.trail && v.trail.length > 1) {
        this._drawWake(ctx, v.trail, meta.color, 0.85, 2.2, sinPhi0, cosPhi0, lam0);
      }

      // Forward speed/COG vector line
      const vecLen = Math.min(28, baseSize * 1.5 + (v.sog || 0) * 0.7);
      ctx.save();
      ctx.strokeStyle = meta.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(item.sx, item.sy);
      ctx.lineTo(item.sx + Math.cos(item.angle) * vecLen, item.sy + Math.sin(item.angle) * vecLen);
      ctx.stroke();
      ctx.restore();

      if (item.isSelected) {
        const pulse = (ts % 1600) / 1600;
        ctx.strokeStyle = meta.color;
        ctx.globalAlpha = 1 - pulse;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(item.sx, item.sy, baseSize + 4 + pulse * 18, 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      this._drawShipGlyph(
        ctx,
        item.sx,
        item.sy,
        item.angle,
        baseSize * 1.5,
        meta.color,
        true
      );

      // Selected callout badge on globe
      if (item.isSelected) {
        const text = `${v.name} · ${v.sog} kn · ${v.cog}° → ${v.destination || '-'}`;
        ctx.font = '600 11.5px system-ui, -apple-system, sans-serif';
        const tw = ctx.measureText(text).width;
        const bx = item.sx + 12;
        const by = item.sy - 22;
        ctx.fillStyle = P.calloutBg;
        ctx.beginPath();
        ctx.roundRect(bx, by, tw + 14, 22, 5);
        ctx.fill();
        ctx.strokeStyle = meta.color;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = P.calloutText;
        ctx.textBaseline = 'middle';
        ctx.fillText(text, bx + 7, by + 11);
      }
    }
  }

  _drawPlannedRoute(ctx, points, color, sinPhi0, cosPhi0, lam0) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.65;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    let started = false;
    let lastPt = null;
    for (let i = 0; i < points.length; i++) {
      const [lat, lon] = points[i];
      const p = this.projectRad(lat * DEG2RAD, lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
      if (p.z > 0.02) {
        if (!started) {
          ctx.moveTo(p.sx, p.sy);
          started = true;
        } else {
          ctx.lineTo(p.sx, p.sy);
        }
        lastPt = p;
      } else {
        started = false;
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    if (lastPt) {
      ctx.globalAlpha = 0.9;
      ctx.beginPath();
      ctx.arc(lastPt.sx, lastPt.sy, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  _drawWake(ctx, trail, color, alpha, width, sinPhi0, cosPhi0, lam0) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = width;
    ctx.beginPath();
    let started = false;
    for (let i = 0; i < trail.length; i++) {
      const [lat, lon] = trail[i];
      const p = this.projectRad(lat * DEG2RAD, lon * DEG2RAD, sinPhi0, cosPhi0, lam0);
      if (p.z > 0.02) {
        if (!started) {
          ctx.moveTo(p.sx, p.sy);
          started = true;
        } else {
          ctx.lineTo(p.sx, p.sy);
        }
      } else {
        started = false;
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  _drawShipGlyph(ctx, x, y, angle, size, color, emphasized) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    // Sharp nautical ship hull arrow pointing along +X
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
