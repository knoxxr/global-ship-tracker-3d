import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineNm,
  initialBearing,
  slerpLatLon,
  getSubsolarPoint,
  formatCoord,
  formatDms,
  compassDirection,
  knotsToKmh,
} from '../src/geo-math.js';
import {
  flagFromMmsi,
  classifyAisShipType,
  describeAisShipType,
  parseOpenWatersEvent,
  parseOpenWatersFeature,
  parseOpenWatersTilePoint,
  parseOpenWatersTrack,
  parseDigitrafficData,
  parseAisStreamMessage,
} from '../src/ais-parser.js';
import { decodeMvtPoints } from '../src/mvt-decoder.js';
import { LIVE_ZONES, buildBboxAround } from '../src/live-zones.js';
import { ShipTrackerServer } from '../src/server.js';

describe('Spherical Geo Math', () => {
  it('computes great-circle distance, bearing, antimeridian SLERP, DMS, and compass', () => {
    const nm = haversineNm(35.10, 129.04, 33.74, -118.27);
    assert.ok(nm > 5000 && nm < 5400);
    assert.ok(Math.abs(initialBearing(0, 0, 0, 10) - 90) < 0.1);

    const mid = slerpLatLon(43.0, 172.0, 43.5, -170.0, 0.5);
    assert.ok(Math.abs(mid.lon) > 175);

    const sun = getSubsolarPoint(new Date('2026-06-21T12:00:00Z'));
    assert.ok(sun.lat > 20 && sun.lat <= 24);
    assert.equal(formatCoord(35.5, true), "35°30.00'N");
    assert.equal(formatDms(35.5, true), '35°30\'00"N');
    assert.equal(compassDirection(225), 'SW');
    assert.equal(knotsToKmh(20), 37.0);
  });
});

describe('Live AIS Coverage Zones', () => {
  it('keeps every anonymous live zone within Open Waters 100 sq deg cap', () => {
    for (const z of LIVE_ZONES) {
      const [minLat, minLon, maxLat, maxLon] = z.bbox;
      const area = (maxLat - minLat) * (maxLon - minLon);
      assert.ok(area > 0 && area <= 100, `Zone ${z.id} area ${area} exceeds 100 sq deg`);
    }
    const custom = buildBboxAround(35.1, 129.0, 90);
    const area = (custom[2] - custom[0]) * (custom[3] - custom[1]);
    assert.ok(area <= 95, `Custom bbox area ${area} too large`);
  });
});

describe('Live AIS Parsers (Open Waters, Digitraffic, AISStream)', () => {
  it('resolves MMSI MID flags and AIS ship type classifications', () => {
    assert.equal(flagFromMmsi('440123456').code, 'KR');
    assert.equal(flagFromMmsi('257090090').code, 'NO');
    assert.equal(classifyAisShipType(71), 'container');
    assert.equal(classifyAisShipType(84), 'tanker');
    assert.equal(classifyAisShipType(60), 'passenger');
    assert.ok(describeAisShipType(84).includes('LNG'));
  });

  it('parses Open Waters /v1/stream WebSocket PositionReport & ShipStaticData events', () => {
    const posEv = {
      type: 'event',
      time: '2026-11-22T01:00:00Z',
      source: 'kystverket',
      station: 'kystverket/2573010',
      channel: 'A',
      mmsi: 257090090,
      msg_type: 'PositionReport',
      lat: 59.88693,
      lon: 10.74938,
      message: {
        UserID: 257090090,
        Sog: 12.4,
        Cog: 185.2,
        TrueHeading: 184,
        RateOfTurn: -2,
        NavigationalStatus: 0,
      },
    };
    const v1 = parseOpenWatersEvent(posEv);
    assert.ok(v1);
    assert.equal(v1.mmsi, '257090090');
    assert.equal(v1.flagCode, 'NO');
    assert.equal(v1.sog, 12.4);
    assert.equal(v1.cog, 185);
    assert.equal(v1.heading, 184);
    assert.equal(v1.rot, -0.2);
    assert.equal(v1.source, 'kystverket');
    assert.equal(v1.station, 'kystverket/2573010');

    const staticEv = {
      type: 'event',
      time: '2026-11-22T01:01:00Z',
      source: 'kystverket',
      mmsi: 257090090,
      msg_type: 'ShipStaticData',
      lat: 59.88693,
      lon: 10.74938,
      message: {
        UserID: 257090090,
        Name: 'COLOR MAGIC',
        ImoNumber: 9349863,
        CallSign: 'LACE6',
        Destination: 'OSLO',
        Type: 60,
        MaximumStaticDraught: 6.8,
        Dimension: { A: 112, B: 112, C: 18, D: 17 },
      },
    };
    const v2 = parseOpenWatersEvent(staticEv, v1);
    assert.equal(v2.name, 'COLOR MAGIC');
    assert.equal(v2.type, 'passenger');
    assert.equal(v2.imo, '9349863');
    assert.equal(v2.length, 224);
    assert.equal(v2.beam, 35);
    assert.equal(v2.destination, 'OSLO');
  });

  it('parses Open Waters REST Feature & 24h Track GeoJSON', () => {
    const feature = {
      type: 'Feature',
      id: 440123456,
      geometry: { type: 'Point', coordinates: [129.0412, 35.0981] },
      properties: {
        mmsi: 440123456,
        name: 'HMM ALGECIRAS',
        type: 71,
        sog: 19.2,
        cog: 110,
        heading: 111,
        nav_status: 0,
        destination: 'NLRTM',
        length: 400,
        beam: 61,
        draught: 15.1,
        source: 'aishub',
        seen: '2026-11-22T01:00:00Z',
        particulars: { deadweight: 228283, gross_tonnage: 228283, year_built: 2020 },
      },
    };
    const v = parseOpenWatersFeature(feature);
    assert.ok(v);
    assert.equal(v.name, 'HMM ALGECIRAS');
    assert.equal(v.type, 'container');
    assert.equal(v.dwt, 228283);
    assert.equal(v.builtYear, 2020);

    const track = parseOpenWatersTrack({
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [[129.01, 35.01], [129.04, 35.09]],
      },
    });
    assert.equal(track.length, 2);
    assert.deepEqual(track[1], [35.09, 129.04]);
  });

  it('parses Fintraffic Digitraffic locations & vessels metadata', () => {
    const locs = {
      type: 'FeatureCollection',
      features: [
        {
          mmsi: 230616000,
          geometry: { type: 'Point', coordinates: [24.95, 60.16] },
          properties: { sog: 14.5, cog: 178, heading: 179, navStat: 0, timestampExternal: 1795309200000 },
        },
      ],
    };
    const meta = [
      {
        mmsi: 230616000,
        name: 'MEGASTAR',
        imo: 9773064,
        callSign: 'ES2017',
        destination: 'TALLINN',
        shipType: 60,
        draught: 71,
        referencePointA: 106,
        referencePointB: 106,
        referencePointC: 15,
        referencePointD: 15,
      },
    ];
    const vessels = parseDigitrafficData(locs, meta);
    assert.equal(vessels.length, 1);
    assert.equal(vessels[0].name, 'MEGASTAR');
    assert.equal(vessels[0].draught, 7.1);
    assert.equal(vessels[0].length, 212);
    assert.equal(vessels[0].source, 'digitraffic');
  });

  it('parses AISStream.io messages and rejects invalid sentinel coordinates', () => {
    const valid = parseAisStreamMessage({
      MessageType: 'PositionReport',
      MetaData: { MMSI: 440123456, ShipName: 'BUSAN EXPRESS' },
      Message: {
        PositionReport: { UserID: 440123456, Latitude: 35.1, Longitude: 129.04, Sog: 18.0, Cog: 95 },
      },
    });
    assert.ok(valid);
    assert.equal(valid.name, 'BUSAN EXPRESS');

    const invalid = parseAisStreamMessage({
      MessageType: 'PositionReport',
      MetaData: { MMSI: 440000001 },
      Message: { PositionReport: { Latitude: 91, Longitude: 181 } },
    });
    assert.equal(invalid, null);
  });

  it('decodes Mapbox Vector Tile (MVT v2) binary points and normalizes to live vessel', () => {
    const varint = (n) => {
      const out = [];
      let v = n;
      while (v >= 0x80) { out.push((v & 0x7f) | 0x80); v = Math.floor(v / 128); }
      out.push(v);
      return out;
    };
    const zigzag = (n) => (n >= 0 ? n * 2 : -n * 2 - 1);
    const fieldBytes = (num, bytes) => [...varint((num << 3) | 2), ...varint(bytes.length), ...bytes];
    const fieldVarint = (num, val) => [...varint((num << 3) | 0), ...varint(val)];
    const fieldStr = (num, str) => fieldBytes(num, [...new TextEncoder().encode(str)]);

    const v0 = fieldStr(1, 'HMM BUSAN');
    const v1 = fieldVarint(5, 440999888);
    const fBuf = new ArrayBuffer(4);
    new DataView(fBuf).setFloat32(0, 19.5, true);
    const v2 = [...varint((2 << 3) | 5), ...new Uint8Array(fBuf)];
    const v3 = fieldVarint(5, 71);
    const v4 = fieldStr(1, 'vessel');

    const geom = [...varint(9), ...varint(zigzag(3515)), ...varint(zigzag(1610))];
    const tags = [...varint(0), ...varint(0), ...varint(1), ...varint(1), ...varint(2), ...varint(2), ...varint(3), ...varint(3), ...varint(4), ...varint(4)];
    const feature = [
      ...fieldVarint(1, 440999888),
      ...fieldBytes(2, tags),
      ...fieldVarint(3, 1),
      ...fieldBytes(4, geom),
    ];
    const layer = [
      ...fieldStr(1, 'vessels'),
      ...fieldBytes(2, feature),
      ...fieldStr(3, 'name'),
      ...fieldStr(3, 'mmsi'),
      ...fieldStr(3, 'sog'),
      ...fieldStr(3, 'type'),
      ...fieldStr(3, 'kind'),
      ...fieldBytes(4, v0),
      ...fieldBytes(4, v1),
      ...fieldBytes(4, v2),
      ...fieldBytes(4, v3),
      ...fieldBytes(4, v4),
      ...fieldVarint(5, 4096),
      ...fieldVarint(15, 2),
    ];

    const pts = decodeMvtPoints(new Uint8Array(fieldBytes(3, layer)), 0, 0, 0);
    assert.equal(pts.length, 1);
    assert.ok(pts[0].lat > 30 && pts[0].lat < 42 && pts[0].lon > 120 && pts[0].lon < 135);
    const vessel = parseOpenWatersTilePoint(pts[0]);
    assert.ok(vessel);
    assert.equal(vessel.name, 'HMM BUSAN');
    assert.equal(vessel.mmsi, '440999888');
    assert.equal(vessel.type, 'container');
    assert.equal(vessel.sog, 19.5);
  });
});

describe('ShipTrackerServer Live-Only HTTP & SSE API', () => {
  const server = new ShipTrackerServer({ port: 0, host: '127.0.0.1', autoConnect: false });

  after(async () => {
    await server.stop();
  });

  it('starts with zero simulated vessels, serves live REST/SSE endpoints, and streams real updates', async () => {
    await server.start();
    const base = `http://127.0.0.1:${server.port}`;

    const htmlRes = await fetch(`${base}/`);
    assert.equal(htmlRes.status, 200);
    assert.ok((await htmlRes.text()).includes('100% Live AIS Telemetry'));

    // Zero fake/simulated vessels on startup before live packets arrive
    const statusRes = await fetch(`${base}/api/status`);
    const status = await statusRes.json();
    assert.equal(status.provider, 'openwaters');
    assert.equal(status.vesselCount, 0);

    // Inject one real parsed Open Waters packet into server state
    const parsed = parseOpenWatersEvent({
      type: 'event',
      source: 'kystverket',
      mmsi: 257090090,
      msg_type: 'PositionReport',
      lat: 59.88,
      lon: 10.75,
      message: { UserID: 257090090, Sog: 11.2, Cog: 180, NavigationalStatus: 0 },
    });
    server._upsertVessel(parsed);

    const vesselsRes = await fetch(`${base}/api/vessels`);
    const vData = await vesselsRes.json();
    assert.equal(vData.count, 1);
    assert.equal(vData.vessels[0].mmsi, '257090090');

    // Verify SSE initial snapshot carries the live vessel
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
    assert.ok(buffer.includes('257090090'));
  });
});
