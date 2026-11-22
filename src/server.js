/**
 * Global 3D AIS Ship Tracker — Zero-dependency Node.js 22 Server.
 *
 * Features:
 *  - Serves the 3D Web Client from ./public
 *  - Live AISStream.io WebSocket connector (uses Node 22 built-in WebSocket)
 *  - Automatic fallback to high-fidelity Global Maritime AIS Simulator
 *  - Real-time Server-Sent Events (SSE) streaming to all connected browsers
 *  - Runtime configuration endpoint to connect/disconnect AISStream API keys
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalAisSimulator, MAJOR_PORTS, SHIPPING_CORRIDORS } from './ais-simulator.js';
import { parseAisStreamMessage } from './ais-parser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const MAX_LIVE_VESSELS = 1500;
const STALE_VESSEL_MS = 15 * 60 * 1000; // 15 minutes

export class ShipTrackerServer {
  constructor(options = {}) {
    this.port = Number(options.port ?? process.env.PORT ?? 3000);
    this.host = options.host ?? process.env.HOST ?? '0.0.0.0';
    this.apiKey = options.apiKey ?? process.env.AISSTREAM_API_KEY ?? '';
    this.boundingBoxes = options.boundingBoxes ?? [[[-90, -180], [90, 180]]];

    this.mode = this.apiKey ? 'aisstream' : 'simulator';
    this.connectionState = this.apiKey ? 'connecting' : 'simulated';
    this.lastError = null;
    this.timeScale = 120; // Default visual speed in simulator mode (120x = ~2 min/sec)
    this.paused = false;

    this.simulator = new GlobalAisSimulator();
    this.liveVessels = new Map();
    this.dirtyLiveIds = new Set();
    this.sseClients = new Set();
    this.ws = null;
    this.reconnectTimer = null;

    this.startedAt = Date.now();
    this.msgCounter = 0;
    this.msgPerSec = 0;

    this._simInterval = null;
    this._statsInterval = null;
    this._liveFlushInterval = null;
    this.httpServer = null;
  }

  getActiveVessels() {
    if (this.mode === 'aisstream') {
      return Array.from(this.liveVessels.values());
    }
    return this.simulator.getSnapshot();
  }

  getStatus() {
    return {
      mode: this.mode,
      connectionState: this.connectionState,
      vesselCount:
        this.mode === 'aisstream'
          ? this.liveVessels.size
          : this.simulator.vessels.length,
      msgPerSec: this.msgPerSec,
      timeScale: this.timeScale,
      paused: this.paused,
      hasApiKey: Boolean(this.apiKey),
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

  connectAisStream(apiKey, boundingBoxes = [[[-90, -180], [90, 180]]]) {
    this.disconnectAisStream();
    this.apiKey = (apiKey || '').trim();
    this.boundingBoxes = boundingBoxes;

    if (!this.apiKey) {
      this.mode = 'simulator';
      this.connectionState = 'simulated';
      this.lastError = null;
      this.broadcastSse('status', this.getStatus());
      this.broadcastSse('snapshot', {
        vessels: this.getActiveVessels(),
        status: this.getStatus(),
      });
      return;
    }

    this.mode = 'aisstream';
    this.connectionState = 'connecting';
    this.lastError = null;
    this.broadcastSse('status', this.getStatus());

    try {
      const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
      this.ws = ws;

      ws.addEventListener('open', () => {
        if (this.ws !== ws) return;
        this.connectionState = 'connected';
        this.lastError = null;
        ws.send(
          JSON.stringify({
            APIKey: this.apiKey,
            BoundingBoxes: this.boundingBoxes,
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
          const existing = this.liveVessels.get(
            String(raw.MetaData?.MMSI || '')
          );
          const parsed = parseAisStreamMessage(raw, existing);
          if (parsed && parsed.lat !== null && parsed.lon !== null) {
            this.liveVessels.set(parsed.mmsi, parsed);
            this.dirtyLiveIds.add(parsed.mmsi);
            this.msgCounter++;

            // Enforce memory cap by evicting oldest entry
            if (this.liveVessels.size > MAX_LIVE_VESSELS) {
              const firstKey = this.liveVessels.keys().next().value;
              if (firstKey) this.liveVessels.delete(firstKey);
            }
          }
        } catch {
          // Ignore malformed packets
        }
      });

      ws.addEventListener('error', () => {
        if (this.ws !== ws) return;
        this.lastError = 'AISStream WebSocket 연결 오류 (API 키 또는 네트워크를 확인하세요)';
        this.connectionState = 'error';
        this.broadcastSse('status', this.getStatus());
      });

      ws.addEventListener('close', () => {
        if (this.ws !== ws) return;
        this.ws = null;
        if (this.mode === 'aisstream' && this.apiKey) {
          this.connectionState = 'reconnecting';
          this.broadcastSse('status', this.getStatus());
          this.reconnectTimer = setTimeout(() => {
            if (this.mode === 'aisstream' && this.apiKey) {
              this.connectAisStream(this.apiKey, this.boundingBoxes);
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

  disconnectAisStream() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
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

  _startLoops() {
    // Advance simulator every 1s and broadcast compact updates
    this._simInterval = setInterval(() => {
      if (this.mode === 'simulator' && !this.paused) {
        this.simulator.step(1.0, this.timeScale);
        this.msgCounter += this.simulator.vessels.length;
        if (this.sseClients.size > 0) {
          this.broadcastSse('batch', {
            mode: 'simulator',
            vessels: this.simulator.getSnapshot(),
          });
        }
      }
    }, 1000);

    // Flush live AIS updates in 500ms batches to avoid overwhelming browsers
    this._liveFlushInterval = setInterval(() => {
      if (this.mode === 'aisstream' && this.dirtyLiveIds.size > 0) {
        const updates = [];
        for (const id of this.dirtyLiveIds) {
          const v = this.liveVessels.get(id);
          if (v) updates.push(v);
        }
        this.dirtyLiveIds.clear();
        if (updates.length > 0 && this.sseClients.size > 0) {
          this.broadcastSse('delta', { mode: 'aisstream', vessels: updates });
        }
      }
      // Prune stale live vessels occasionally
      if (this.mode === 'aisstream' && this.liveVessels.size > 0) {
        const cutoff = Date.now() - STALE_VESSEL_MS;
        for (const [mmsi, v] of this.liveVessels) {
          if (v.updatedAt < cutoff) this.liveVessels.delete(mmsi);
        }
      }
    }, 500);

    // Calculate packets/sec every 1s
    this._statsInterval = setInterval(() => {
      this.msgPerSec = this.msgCounter;
      this.msgCounter = 0;
      this.broadcastSse('status', this.getStatus());
    }, 1000);
  }

  async _handleRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    // Enable CORS for /api/* so static frontends (e.g. GitHub Pages) can connect to a deployed backend
    if (pathname.startsWith('/api/')) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
    }

    // API endpoints
    if (pathname === '/api/status' && req.method === 'GET') {
      return this._sendJson(res, 200, this.getStatus());
    }

    if (pathname === '/api/metadata' && req.method === 'GET') {
      return this._sendJson(res, 200, {
        ports: MAJOR_PORTS,
        corridors: SHIPPING_CORRIDORS.map((c) => ({
          id: c.id,
          name: c.name,
          origin: c.origin,
          destination: c.destination,
          waypoints: c.waypoints,
        })),
      });
    }

    if (pathname === '/api/vessels' && req.method === 'GET') {
      let vessels = this.getActiveVessels();
      const typeFilter = url.searchParams.get('type');
      const query = (url.searchParams.get('q') || '').trim().toLowerCase();

      if (typeFilter && typeFilter !== 'all') {
        vessels = vessels.filter((v) => v.type === typeFilter);
      }
      if (query) {
        vessels = vessels.filter(
          (v) =>
            v.name.toLowerCase().includes(query) ||
            v.mmsi.includes(query) ||
            (v.imo && v.imo.includes(query)) ||
            (v.destination && v.destination.toLowerCase().includes(query)) ||
            (v.flagName && v.flagName.toLowerCase().includes(query))
        );
      }
      return this._sendJson(res, 200, {
        mode: this.mode,
        count: vessels.length,
        vessels,
      });
    }

    if (pathname === '/api/config' && req.method === 'POST') {
      try {
        const body = await this._readJsonBody(req);
        if (typeof body.paused === 'boolean') {
          this.paused = body.paused;
        }
        if (Number.isFinite(Number(body.timeScale))) {
          this.timeScale = Math.max(1, Math.min(3600, Number(body.timeScale)));
        }
        if (body.mode === 'simulator') {
          this.disconnectAisStream();
          this.apiKey = '';
          this.mode = 'simulator';
          this.connectionState = 'simulated';
          this.lastError = null;
          this.broadcastSse('snapshot', {
            vessels: this.getActiveVessels(),
            status: this.getStatus(),
          });
        } else if (body.mode === 'aisstream' && typeof body.apiKey === 'string') {
          this.liveVessels.clear();
          this.connectAisStream(body.apiKey, body.boundingBoxes || [[[-90, -180], [90, 180]]]);
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

      // Push initial snapshot immediately
      const initPayload = {
        vessels: this.getActiveVessels(),
        status: this.getStatus(),
      };
      res.write(`event: snapshot\ndata: ${JSON.stringify(initPayload)}\n\n`);

      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    // Static files from src/public
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
    if (this.apiKey) {
      this.connectAisStream(this.apiKey, this.boundingBoxes);
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
    this.disconnectAisStream();
    clearInterval(this._simInterval);
    clearInterval(this._statsInterval);
    clearInterval(this._liveFlushInterval);
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

// Run directly when executed as main module
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  const server = new ShipTrackerServer();
  server.start().then(() => {
    console.log(
      `[MarineGlobe 3D] Running on http://localhost:${server.port} (mode: ${server.mode})`
    );
  });
}
