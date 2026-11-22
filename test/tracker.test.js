import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineNm,
  initialBearing,
  slerpLatLon,
  getSubsolarPoint,
  formatCoord,
} from '../src/geo-math.js';
import {
  flagFromMmsi,
  classifyAisShipType,
  parseAisStreamMessage,
} from '../src/ais-parser.js';
import { GlobalAisSimulator } from '../src/ais-simulator.js';
import { ShipTrackerServer } from '../src/server.js';

describe('Spherical Geo Math', () => {
  it('computes accurate great-circle distance (Busan to Los Angeles)', () => {
    const nm = haversineNm(35.10, 129.04, 33.74, -118.27);
    assert.ok(nm > 5000 && nm < 5400, `Expected ~5200 nm, got ${nm}`);
  });

  it('computes initial bearing correctly', () => {
    const north = initialBearing(0, 0, 10, 0);
    const east = initialBearing(0, 0, 0, 10);
    const west = initialBearing(0, 0, 0, -10);
    assert.ok(Math.abs(north - 0) < 0.1);
    assert.ok(Math.abs(east - 90) < 0.1);
    assert.ok(Math.abs(west - 270) < 0.1);
  });

  it('interpolates cleanly across the antimeridian (Pacific)', () => {
    const mid = slerpLatLon(43.0, 172.0, 43.5, -170.0, 0.5);
    assert.ok(mid.lat > 43 && mid.lat < 45, `Unexpected lat ${mid.lat}`);
    assert.ok(
      Math.abs(mid.lon) > 175,
      `Expected midpoint near 180° antimeridian, got ${mid.lon}`
    );
  });

  it('computes valid subsolar coordinates and formats nautical coordinates', () => {
    const sun = getSubsolarPoint(new Date('2026-06-21T12:00:00Z'));
    assert.ok(sun.lat > 20 && sun.lat <= 24);
    assert.ok(Math.abs(sun.lon) < 1);
    assert.equal(formatCoord(35.5, true), "35°30.00'N");
    assert.equal(formatCoord(-118.25, false), "118°15.00'W");
  });
});

describe('AISStream.io Parser', () => {
  it('resolves MMSI MID flags and AIS ship types', () => {
    assert.equal(flagFromMmsi('440123456').code, 'KR');
    assert.equal(flagFromMmsi('563999001').code, 'SG');
    assert.equal(classifyAisShipType(71), 'container');
    assert.equal(classifyAisShipType(82), 'tanker');
    assert.equal(classifyAisShipType(60), 'passenger');
    assert.equal(classifyAisShipType(30), 'fishing');
  });

  it('parses PositionReport and merges ShipStaticData', () => {
    const posMsg = {
      MessageType: 'PositionReport',
      MetaData: { MMSI: 440123456, ShipName: 'HMM ALGECIRAS  ' },
      Message: {
        PositionReport: {
          UserID: 440123456,
          Latitude: 35.095,
          Longitude: 129.041,
          Sog: 19.4,
          Cog: 112.6,
          TrueHeading: 113,
          NavigationalStatus: 0,
        },
      },
    };
    const v1 = parseAisStreamMessage(posMsg);
    assert.ok(v1);
    assert.equal(v1.mmsi, '440123456');
    assert.equal(v1.name, 'HMM ALGECIRAS');
    assert.equal(v1.flagCode, 'KR');
    assert.equal(v1.sog, 19.4);
    assert.equal(v1.cog, 113);
    assert.equal(v1.trail.length, 1);

    const staticMsg = {
      MessageType: 'ShipStaticData',
      MetaData: { MMSI: 440123456 },
      Message: {
        ShipStaticData: {
          UserID: 440123456,
          ImoNumber: 9863297,
          CallSign: 'D7AA',
          Destination: 'NLRTM',
          Type: 71,
          MaximumStaticDraught: 15.2,
          Dimension: { A: 200, B: 200, C: 30, D: 31 },
          Eta: { Month: 12, Day: 15, Hour: 8, Minute: 30 },
        },
      },
    };
    const v2 = parseAisStreamMessage(staticMsg, v1);
    assert.equal(v2.type, 'container');
    assert.equal(v2.imo, '9863297');
    assert.equal(v2.destination, 'NLRTM');
    assert.equal(v2.length, 400);
    assert.equal(v2.beam, 61);
    assert.equal(v2.eta, '12-15 08:30 UTC');
  });

  it('rejects out-of-range AIS coordinates (91/181 sentinel values)', () => {
    const invalid = parseAisStreamMessage({
      MessageType: 'PositionReport',
      MetaData: { MMSI: 440000001 },
      Message: {
        PositionReport: { Latitude: 91, Longitude: 181, Sog: 0, Cog: 0 },
      },
    });
    assert.equal(invalid, null);
  });
});

describe('Global AIS Simulator', () => {
  it('initializes 300+ vessels and advances positions smoothly', () => {
    const sim = new GlobalAisSimulator(42);
    const snap1 = sim.getSnapshot();
    assert.ok(snap1.length >= 300, `Expected >= 300 vessels, got ${snap1.length}`);

    const firstBefore = { lat: snap1[0].lat, lon: snap1[0].lon };
    sim.step(10, 120);
    const snap2 = sim.getSnapshot();

    assert.notDeepEqual(
      { lat: snap2[0].lat, lon: snap2[0].lon },
      firstBefore,
      'Vessel should move after simulation step'
    );
    for (const v of snap2) {
      assert.ok(Number.isFinite(v.lat) && v.lat >= -85 && v.lat <= 85);
      assert.ok(Number.isFinite(v.lon) && v.lon >= -180 && v.lon <= 180);
      assert.ok(v.trail.length >= 2);
    }
  });
});

describe('ShipTrackerServer HTTP & SSE API', () => {
  const server = new ShipTrackerServer({ port: 0, host: '127.0.0.1' });

  after(async () => {
    await server.stop();
  });

  it('serves UI, REST endpoints, config updates, and SSE snapshot stream', async () => {
    await server.start();
    const base = `http://127.0.0.1:${server.port}`;

    // Static index.html
    const htmlRes = await fetch(`${base}/`);
    assert.equal(htmlRes.status, 200);
    const html = await htmlRes.text();
    assert.ok(html.includes('MarineGlobe 3D'));

    // Status API
    const statusRes = await fetch(`${base}/api/status`);
    assert.equal(statusRes.status, 200);
    const status = await statusRes.json();
    assert.equal(status.mode, 'simulator');
    assert.ok(status.vesselCount >= 300);

    // Filtered vessels API
    const filteredRes = await fetch(`${base}/api/vessels?type=container`);
    const filtered = await filteredRes.json();
    assert.ok(filtered.count > 0);
    assert.ok(filtered.vessels.every((v) => v.type === 'container'));

    // Config API (pause & speed)
    const cfgRes = await fetch(`${base}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: true, timeScale: 60 }),
    });
    const cfg = await cfgRes.json();
    assert.equal(cfg.ok, true);
    assert.equal(cfg.status.paused, true);
    assert.equal(cfg.status.timeScale, 60);

    // SSE real-time stream initial snapshot
    const ctrl = new AbortController();
    const sseRes = await fetch(`${base}/api/stream`, { signal: ctrl.signal });
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (!buffer.includes('event: snapshot')) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
    }
    ctrl.abort();
    assert.ok(buffer.includes('event: snapshot'));
    assert.ok(buffer.includes('"vessels"'));
  });
});
