/**
 * MarineGlobe 3D — 100% Live Real-Time AIS Server (Zero Simulation Data).
 *
 * Supported Real-Time Data Sources:
 *  1. Open Waters AIS (Default — No API key required):
 *     - Global multi-zone live REST bootstrap (/v1/vessels)
 *     - Live WebSocket push stream (wss://ais.openwaters.io/v1/stream)
 *     - On-demand real vessel particulars & 24h AIS track (/v1/vessels/{mmsi})
 *  2. Fintraffic Digitraffic Marine Open API (No API key required):
 *     - Official real-time AIS REST feed (/api/ais/v1/locations + /vessels)
 *  3. AISStream.io (Optional free API key):
 *     - Global WebSocket push stream (wss://stream.aisstream.io/v0/stream)
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LIVE_ZONES } from './live-zones.js';
import { decodeMvtPoints } from './mvt-decoder.js';
import {
  parseOpenWatersEvent,
  parseOpenWatersFeature,
  parseOpenWatersTilePoint,
  parseOpenWatersTrack,
  parseDigitrafficData,
  parseAisStreamMessage,
} from './ais-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const USER_AGENT = 'MarineGlobe3D/2.0 (https://github.com/knoxxr/global-ship-tracker-3d)';
const MAX_LIVE_VESSELS = 60000;
const STALE_VESSEL_MS = 7 * 24 * 60 * 60 * 1000; // Keep stationary port vessels up to 7 days like Open Waters

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function runPool(items, concurrency, fn) {
  let idx = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (idx < items.length) {
        const item = items[idx++];
        try {
          await fn(item);
        } catch {
          // isolate per-item failure
        }
      }
    })
  );
}

export class ShipTrackerServer {
  constructor(options = {}) {
    this.port = Number(options.port ?? process.env.PORT ?? 3000);
    this.host = options.host ?? process.env.HOST ?? '0.0.0.0';
    this.autoConnect = options.autoConnect ?? true;

    this.aisStreamKey = (options.aisStreamKey ?? process.env.AISSTREAM_API_KEY ?? '').trim();
    this.openWatersToken = (options.openWatersToken ?? process.env.OPENWATERS_TOKEN ?? '').trim();

    this.provider = this.aisStreamKey ? 'aisstream' : (options.provider || 'openwaters');
    this.activeZoneId = options.zoneId || 'korea-strait';
    this.activeBbox =
      LIVE_ZONES.find((z) => z.id === this.activeZoneId)?.bbox || LIVE_ZONES[0].bbox;

    this.connectionState = 'idle';
    this.lastError = null;
    this.lastSyncAt = null;

    this.vessels = new Map();
    this.dirtyIds = new Set();
    this.sseClients = new Set();
    this.ws = null;
    this.reconnectTimer = null;
    this.pollTimer = null;

    this.startedAt = Date.now();
    this.msgCounter = 0;
    this.msgPerSec = 0;

    this._flushInterval = null;
    this._statsInterval = null;
    this.httpServer = null;
  }

  getActiveVessels() {
    return Array.from(this.vessels.values());
  }

  getStatus() {
    return {
      provider: this.provider,
      connectionState: this.connectionState,
      activeZoneId: this.activeZoneId,
      activeBbox: this.activeBbox,
      vesselCount: this.vessels.size,
      msgPerSec: this.msgPerSec,
      lastSyncAt: this.lastSyncAt,
      hasOpenWatersToken: Boolean(this.openWatersToken),
      hasAisStreamKey: Boolean(this.aisStreamKey),
      lastError: this.lastError,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
    };
  }

  broadcastSse(event, data) {
    if (this.sseClients.size === 0) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(payload);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  _upsertVessel(v) {
    if (!v || v.lat === null || v.lon === null) return;
    this.vessels.set(v.mmsi, v);
    this.dirtyIds.add(v.mmsi);
    this.msgCounter++;
    this.lastSyncAt = Date.now();

    if (this.vessels.size > MAX_LIVE_VESSELS) {
      const oldestKey = this.vessels.keys().next().value;
      if (oldestKey) this.vessels.delete(oldestKey);
    }
  }

  disconnectFeeds() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.ws) {
      const old = this.ws;
      this.ws = null;
      try {
        old.close();
      } catch {
        // ignore
      }
    }
  }

  async connectActiveProvider() {
    this.disconnectFeeds();
    this.lastError = null;
    this.connectionState = 'connecting';
    this.broadcastSse('status', this.getStatus());

    if (this.provider === 'aisstream') {
      this._connectAisStream();
    } else if (this.provider === 'digitraffic') {
      await this._pollDigitraffic();
      this.pollTimer = setInterval(() => {
        this._pollDigitraffic().catch(() => {});
      }, 30000);
    } else {
      await this._bootstrapOpenWatersGlobal();
      this._connectOpenWatersWs(this.activeBbox);
    }
  }

  async _fetchOpenWatersBbox(bbox) {
    const [minLat, minLon, maxLat, maxLon] = bbox;
    const params = new URLSearchParams({
      bbox: `${minLat},${minLon},${maxLat},${maxLon}`,
      kind: 'vessel',
    });
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
    if (this.openWatersToken) {
      headers.Authorization = `Bearer ${this.openWatersToken}`;
    }

    const res = await fetch(`https://ais.openwaters.io/v1/vessels?${params}`, {
      headers,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) {
      throw new Error(`Open Waters REST HTTP ${res.status}`);
    }
    const geo = await res.json();
    const features = Array.isArray(geo.features) ? geo.features : [];
    let added = 0;
    for (const f of features) {
      const existing = this.vessels.get(String(f.properties?.mmsi || f.id || ''));
      const parsed = parseOpenWatersFeature(f, existing);
      if (parsed) {
        this._upsertVessel(parsed);
        added++;
      }
    }
    return added;
  }

  async _fetchOpenWatersTile(z, x, y) {
    const headers = { 'User-Agent': USER_AGENT };
    if (this.openWatersToken) headers.Authorization = `Bearer ${this.openWatersToken}`;
    const res = await fetch(
      `https://ais.openwaters.io/v1/vessels/tiles/${z}/${x}/${y}?kind=vessel`,
      { headers, signal: AbortSignal.timeout(10000) }
    );
    if (res.status !== 200) return 0;
    const pts = decodeMvtPoints(await res.arrayBuffer(), z, x, y);
    let added = 0;
    for (const pt of pts) {
      const existing = this.vessels.get(String(pt.properties?.mmsi || pt.id || ''));
      const parsed = parseOpenWatersTilePoint(pt, existing);
      if (parsed) {
        this._upsertVessel(parsed);
        added++;
      }
    }
    return added;
  }

  async _bootstrapOpenWatersGlobal() {
    try {
      let totalLoaded = 0;
      // 1. All 64 global z=3 MVT vector tiles (every ocean & coastline worldwide)
      const z3Tiles = [];
      for (let x = 0; x < 8; x++) {
        for (let y = 0; y < 8; y++) z3Tiles.push([3, x, y]);
      }
      await runPool(z3Tiles, 6, async ([z, x, y]) => {
        totalLoaded += await this._fetchOpenWatersTile(z, x, y);
      });

      // 2. Un-thinned REST detail for 16 major global hubs
      await runPool(LIVE_ZONES, 4, async (z) => {
        totalLoaded += await this._fetchOpenWatersBbox(z.bbox);
      });

      if (totalLoaded > 0) {
        this.connectionState = 'connected';
        this.broadcastSse('snapshot', {
          vessels: this.getActiveVessels(),
          status: this.getStatus(),
        });
      } else {
        await this._pollDigitraffic();
      }
    } catch (err) {
      this.lastError = `Open Waters 전역 로드 오류: ${err.message}`;
      this.connectionState = 'error';
      this.broadcastSse('status', this.getStatus());
    }
  }

  _connectOpenWatersWs(bbox) {
    const url = this.openWatersToken
      ? `wss://ais.openwaters.io/v1/stream?key=${encodeURIComponent(this.openWatersToken)}`
      : 'wss://ais.openwaters.io/v1/stream';

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.addEventListener('open', () => {
        if (this.ws !== ws) return;
        this.connectionState = 'connected';
        this.lastError = null;
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            bbox: [bbox],
            snapshot: true,
          })
        );
        this.broadcastSse('status', this.getStatus());
      });

      ws.addEventListener('message', (evt) => {
        if (this.ws !== ws) return;
        try {
          const text = typeof evt.data === 'string' ? evt.data : String(evt.data);
          const data = JSON.parse(text);
          if (data.type === 'error') {
            this.lastError = String(data.error || 'Open Waters 구독 오류');
            this.broadcastSse('status', this.getStatus());
            return;
          }
          if (data.type === 'event') {
            const existing = this.vessels.get(String(data.mmsi || ''));
            const parsed = parseOpenWatersEvent(data, existing);
            if (parsed) this._upsertVessel(parsed);
          }
        } catch {
          // ignore malformed frames
        }
      });

      ws.addEventListener('error', () => {
        if (this.ws !== ws) return;
        this.lastError = 'Open Waters WebSocket 연결 오류';
        this.connectionState = 'error';
        this.broadcastSse('status', this.getStatus());
      });

      ws.addEventListener('close', () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.provider === 'openwaters') {
          this.connectionState = 'reconnecting';
          this.broadcastSse('status', this.getStatus());
          this.reconnectTimer = setTimeout(() => {
            if (this.provider === 'openwaters') {
              this._connectOpenWatersWs(this.activeBbox);
            }
          }, 5000);
        }
      });
    } catch (err) {
      this.lastError = err.message;
      this.connectionState = 'error';
      this.broadcastSse('status', this.getStatus());
    }
  }

  async _pollDigitraffic() {
    try {
      const headers = {
        'User-Agent': USER_AGENT,
        'Digitraffic-User': USER_AGENT,
        Accept: 'application/json',
      };
      const [locRes, metaRes] = await Promise.all([
        fetch('https://meri.digitraffic.fi/api/ais/v1/locations', {
          headers,
          signal: AbortSignal.timeout(15000),
        }),
        fetch('https://meri.digitraffic.fi/api/ais/v1/vessels', {
          headers,
          signal: AbortSignal.timeout(15000),
        }),
      ]);
      if (!locRes.ok) throw new Error(`Digitraffic HTTP ${locRes.status}`);
      const locJson = await locRes.json();
      const metaJson = metaRes.ok ? await metaRes.json() : [];
      const vessels = parseDigitrafficData(locJson, metaJson);
      for (const v of vessels) {
        const prev = this.vessels.get(v.mmsi);
        if (prev && prev.trail.length > 0) {
          const last = prev.trail[prev.trail.length - 1];
          v.trail =
            Math.abs(last[0] - v.lat) + Math.abs(last[1] - v.lon) > 0.002
              ? [...prev.trail.slice(-39), [v.lat, v.lon]]
              : prev.trail;
        }
        this._upsertVessel(v);
      }
      this.connectionState = 'connected';
      this.lastError = null;
      this.broadcastSse('snapshot', {
        vessels: this.getActiveVessels(),
        status: this.getStatus(),
      });
    } catch (err) {
      this.lastError = `Digitraffic 수신 오류: ${err.message}`;
      this.connectionState = 'error';
      this.broadcastSse('status', this.getStatus());
    }
  }

  _connectAisStream() {
    if (!this.aisStreamKey) {
      this.lastError = 'AISStream.io API 키가 필요합니다.';
      this.connectionState = 'error';
      this.broadcastSse('status', this.getStatus());
      return;
    }

    try {
      const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
      this.ws = ws;

      ws.addEventListener('open', () => {
        if (this.ws !== ws) return;
        this.connectionState = 'connected';
        this.lastError = null;
        ws.send(
          JSON.stringify({
            APIKey: this.aisStreamKey,
            BoundingBoxes: [[[-90, -180], [90, 180]]],
            FilterMessageTypes: [
              'PositionReport',
              'StandardClassBPositionReport',
              'ExtendedClassBPositionReport',
              'ShipStaticData',
            ],
          })
        );
        this.broadcastSse('status', this.getStatus());
      });

      ws.addEventListener('message', (evt) => {
        if (this.ws !== ws) return;
        try {
          const text = typeof evt.data === 'string' ? evt.data : String(evt.data);
          const raw = JSON.parse(text);
          if (raw.error) {
            this.lastError = String(raw.error);
            this.connectionState = 'error';
            this.broadcastSse('status', this.getStatus());
            return;
          }
          const existing = this.vessels.get(String(raw.MetaData?.MMSI || ''));
          const parsed = parseAisStreamMessage(raw, existing);
          if (parsed) this._upsertVessel(parsed);
        } catch {
          // ignore
        }
      });

      ws.addEventListener('error', () => {
        if (this.ws !== ws) return;
        this.lastError = 'AISStream WebSocket 연결 오류';
        this.connectionState = 'error';
        this.broadcastSse('status', this.getStatus());
      });

      ws.addEventListener('close', () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.provider === 'aisstream' && this.aisStreamKey) {
          this.connectionState = 'reconnecting';
          this.broadcastSse('status', this.getStatus());
          this.reconnectTimer = setTimeout(() => {
            if (this.provider === 'aisstream' && this.aisStreamKey) {
              this._connectAisStream();
            }
          }, 5000);
        }
      });
    } catch (err) {
      this.lastError = err.message;
      this.connectionState = 'error';
      this.broadcastSse('status', this.getStatus());
    }
  }

  async _fetchVesselEnrichment(mmsi) {
    const clean = String(mmsi || '').replace(/\D/g, '');
    if (!clean) return null;
    const headers = { 'User-Agent': USER_AGENT, Accept: 'application/json' };
    if (this.openWatersToken) headers.Authorization = `Bearer ${this.openWatersToken}`;

    const [detailRes, trackRes] = await Promise.allSettled([
      fetch(`https://ais.openwaters.io/v1/vessels/${clean}`, {
        headers,
        signal: AbortSignal.timeout(10000),
      }),
      fetch(`https://ais.openwaters.io/v1/vessels/${clean}/track`, {
        headers,
        signal: AbortSignal.timeout(10000),
      }),
    ]);

    let vessel = this.vessels.get(clean) || null;
    if (detailRes.status === 'fulfilled' && detailRes.value.ok) {
      const feature = await detailRes.value.json();
      const parsed = parseOpenWatersFeature(feature, vessel);
      if (parsed) vessel = parsed;
    }
    if (trackRes.status === 'fulfilled' && trackRes.value.ok) {
      const trackGeo = await trackRes.value.json();
      const trackPts = parseOpenWatersTrack(trackGeo);
      if (vessel && trackPts.length > 0) {
        vessel = { ...vessel, trail: trackPts.slice(-120) };
      }
    }
    if (vessel) {
      this._upsertVessel(vessel);
    }
    return vessel;
  }

  _startLoops() {
    this._flushInterval = setInterval(() => {
      if (this.dirtyIds.size > 0) {
        const updates = [];
        for (const id of this.dirtyIds) {
          const v = this.vessels.get(id);
          if (v) updates.push(v);
        }
        this.dirtyIds.clear();
        if (updates.length > 0 && this.sseClients.size > 0) {
          this.broadcastSse('delta', { provider: this.provider, vessels: updates });
        }
      }

      if (this.vessels.size > 0) {
        const cutoff = Date.now() - STALE_VESSEL_MS;
        for (const [mmsi, v] of this.vessels) {
          if (v.updatedAt < cutoff) this.vessels.delete(mmsi);
        }
      }
    }, 500);

    this._statsInterval = setInterval(() => {
      this.msgPerSec = this.msgCounter;
      this.msgCounter = 0;
      this.broadcastSse('status', this.getStatus());
    }, 1000);
  }

  async _handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
    }

    if (pathname === '/api/status' && req.method === 'GET') {
      return this._sendJson(res, 200, this.getStatus());
    }

    if (pathname === '/api/zones' && req.method === 'GET') {
      return this._sendJson(res, 200, { zones: LIVE_ZONES });
    }

    if (pathname === '/api/vessels' && req.method === 'GET') {
      let list = this.getActiveVessels();
      const typeFilter = url.searchParams.get('type');
      const query = (url.searchParams.get('q') || '').trim().toLowerCase();

      if (typeFilter && typeFilter !== 'all') {
        list = list.filter((v) => v.type === typeFilter);
      }
      if (query) {
        list = list.filter(
          (v) =>
            v.name.toLowerCase().includes(query) ||
            v.mmsi.includes(query) ||
            (v.imo && v.imo.includes(query)) ||
            (v.destination && v.destination.toLowerCase().includes(query)) ||
            (v.flagName && v.flagName.toLowerCase().includes(query))
        );
      }
      return this._sendJson(res, 200, {
        provider: this.provider,
        count: list.length,
        vessels: list,
      });
    }

    if (pathname.startsWith('/api/vessel/') && req.method === 'GET') {
      const mmsi = pathname.slice('/api/vessel/'.length);
      try {
        const vessel = await this._fetchVesselEnrichment(mmsi);
        if (!vessel) return this._sendJson(res, 404, { error: 'Vessel not found' });
        return this._sendJson(res, 200, { vessel });
      } catch (err) {
        return this._sendJson(res, 502, { error: err.message });
      }
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      try {
        const body = await this._readJsonBody(req);
        if (typeof body.openWatersToken === 'string') {
          this.openWatersToken = body.openWatersToken.trim();
        }
        if (typeof body.aisStreamKey === 'string') {
          this.aisStreamKey = body.aisStreamKey.trim();
        }
        if (typeof body.zoneId === 'string') {
          const z = LIVE_ZONES.find((item) => item.id === body.zoneId);
          if (z) {
            this.activeZoneId = z.id;
            this.activeBbox = z.bbox;
          }
        }
        if (Array.isArray(body.bbox) && body.bbox.length === 4) {
          this.activeZoneId = 'custom';
          this.activeBbox = body.bbox.map(Number);
        }
        if (body.provider && ['openwaters', 'digitraffic', 'aisstream'].includes(body.provider)) {
          if (body.provider !== this.provider) {
            this.vessels.clear();
          }
          this.provider = body.provider;
        }

        if (this.autoConnect) {
          if (this.provider === 'openwaters' && body.bboxOnly) {
            await this._fetchOpenWatersBbox(this.activeBbox).catch(() => {});
            this._connectOpenWatersWs(this.activeBbox);
          } else {
            await this.connectActiveProvider();
          }
        }
        this.broadcastSse('status', this.getStatus());
        return this._sendJson(res, 200, { ok: true, status: this.getStatus() });
      } catch (err) {
        return this._sendJson(res, 400, { ok: false, error: err.message });
      }
    }

    if (pathname === '/api/stream' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.write(': connected\n\n');
      this.sseClients.add(res);

      res.write(
        `event: snapshot\ndata: ${JSON.stringify({
          vessels: this.getActiveVessels(),
          status: this.getStatus(),
        })}\n\n`
      );

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    return this._serveStatic(pathname, res);
  }

  async _serveStatic(pathname, res) {
    const safePath = pathname === '/' ? '/index.html' : pathname;
    const normalized = path.normalize(safePath).replace(/^(\.\.[/\\])+/, '');
    const fullPath = path.join(PUBLIC_DIR, normalized);

    if (!fullPath.startsWith(PUBLIC_DIR)) {
      res.writeHead(403);
      return res.end('Forbidden');
    }

    try {
      const data = await fs.readFile(fullPath);
      const ext = path.extname(fullPath).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      res.end(data);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
    }
  }

  _sendJson(res, status, obj) {
    const body = JSON.stringify(obj);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  }

  _readJsonBody(req) {
    return new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (chunk) => {
        data += chunk;
        if (data.length > 1024 * 64) {
          reject(new Error('Payload too large'));
          req.destroy();
        }
      });
      req.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          reject(new Error('Invalid JSON payload'));
        }
      });
      req.on('error', reject);
    });
  }

  async start() {
    this._startLoops();
    if (this.autoConnect) {
      this.connectActiveProvider().catch(() => {});
    }
    this.httpServer = http.createServer((req, res) => {
      this._handleRequest(req, res).catch((err) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }));
        }
      });
    });

    await new Promise((resolve) => {
      this.httpServer.listen(this.port, this.host, resolve);
    });
    const addr = this.httpServer.address();
    this.port = typeof addr === 'object' && addr ? addr.port : this.port;
    return this;
  }

  async stop() {
    this.disconnectFeeds();
    clearInterval(this._flushInterval);
    clearInterval(this._statsInterval);
    for (const res of this.sseClients) {
      try {
        res.end();
      } catch {
        // ignore
      }
    }
    this.sseClients.clear();
    if (this.httpServer) {
      await new Promise((resolve) => this.httpServer.close(resolve));
      this.httpServer = null;
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = new ShipTrackerServer();
  server.start().then(() => {
    console.log(
      `[MarineGlobe 3D Live] Running on http://localhost:${server.port} (provider: ${server.provider})`
    );
  });
}
