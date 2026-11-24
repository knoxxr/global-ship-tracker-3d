import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import {
  haversineNm,
  initialBearing,
  destinationPoint,
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
  cleanAisText,
  parseOpenWatersEvent,
  parseOpenWatersFeature,
  parseOpenWatersTilePoint,
  parseOpenWatersTrack,
  parseDigitrafficData,
  parseAisStreamMessage,
} from '../src/ais-parser.js';
import {
  shortSource,
  sortVesselsByColumn,
  escapeCsvCell,
  renderInspectorBodyHtml,
} from '../src/public/telemetry-ui.js';
import {
  filterVesselsList,
  createFavoriteMonitor,
} from '../src/public/ui-controller.js';
import {
  getLang,
  setLang,
  resolveInitialLang,
  t,
  getZoneLabel,
  getPortDisplayName,
} from '../src/public/i18n.js';
import { decodeMvtPoints } from '../src/mvt-decoder.js';
import { LIVE_ZONES, buildBboxAround, getViewportMvtTiles } from '../src/live-zones.js';
import {
  ApiRateGuard,
  RateLimitCooldownError,
  parseRetryAfterMs,
  checkThrottledResponse,
} from '../src/public/api-guard.js';
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

    // Verify webmanifest MIME & MMSI validation
    const manRes = await fetch(`${base}/manifest.webmanifest`);
    assert.equal(manRes.status, 200);
    assert.ok((manRes.headers.get('content-type') || '').includes('application/manifest+json'));

    const badMmsiRes = await fetch(`${base}/api/vessel/not-an-mmsi`);
    assert.equal(badMmsiRes.status, 400);
  });
});

describe('AIS Text Cleaning, Telemetry UI Helpers & CSV Security', () => {
  it('strips ITU-R AIS @ padding characters across parsers', () => {
    assert.equal(cleanAisText('@@@@@BUSAN@@@PORT@@'), 'BUSAN PORT');
    assert.equal(cleanAisText('@@@@@@@@@'), '');
    const feat = parseOpenWatersFeature({
      type: 'Feature',
      id: 440777888,
      geometry: { type: 'Point', coordinates: [129.04, 35.1] },
      properties: {
        mmsi: 440777888,
        name: 'KOREA STAR@@@@@',
        callsign: 'DS9AB@@@',
        destination: '@@@@KR PUS@@@@',
        sog: 12.5,
      },
    });
    assert.equal(feat.name, 'KOREA STAR');
    assert.equal(feat.callsign, 'DS9AB');
    assert.equal(feat.destination, 'KR PUS');
  });

  it('compacts long AIS source keys, sorts fleet columns, and neutralizes CSV formula injection', () => {
    assert.equal(shortSource('station:ed25519:rTY1234567890'), 'station');
    assert.equal(shortSource('kystverket'), 'kystverket');

    const sorted = sortVesselsByColumn(
      [
        { name: 'BETA', sog: 5.2, updatedAt: 100 },
        { name: 'ALPHA', sog: 18.4, updatedAt: 200 },
      ],
      'sog',
      'desc'
    );
    assert.equal(sorted[0].name, 'ALPHA');
    assert.equal(sortVesselsByColumn(sorted, 'name', 'asc')[0].name, 'ALPHA');

    assert.equal(escapeCsvCell('=CMD()'), '"\'=CMD()"');
    assert.equal(escapeCsvCell('+1234'), '"\'+1234"');
    assert.equal(escapeCsvCell('@SUM(A1)'), '"\'@SUM(A1)"');
    assert.equal(escapeCsvCell(-120.45), '"-120.45"');
    assert.equal(escapeCsvCell('-74.01'), '"-74.01"');
  });
});

describe('Multi-User Rate-Limit Guard, Coalescing & Shared Viewport API', () => {
  it('coalesces concurrent identical requests and serves TTL cache hits with 1 upstream call', async () => {
    const guard = new ApiRateGuard({ maxBurst: 10, refillPerSec: 10 });
    let upstreamCalls = 0;

    // 25 concurrent users asking for the same tile/vessel simultaneously
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        guard.run('tile:5/27/12', { ttlMs: 60000 }, async () => {
          upstreamCalls++;
          await new Promise((r) => setTimeout(r, 20));
          return { ships: 1615 };
        })
      )
    );

    assert.equal(upstreamCalls, 1);
    assert.equal(results.length, 25);
    assert.ok(results.every((r) => r.ships === 1615));

    // Subsequent call within TTL hits memory cache with 0 upstream calls
    const cached = await guard.run('tile:5/27/12', { ttlMs: 60000 }, async () => {
      upstreamCalls++;
      return { ships: 0 };
    });
    assert.equal(cached.ships, 1615);
    assert.equal(upstreamCalls, 1);

    const stats = guard.getStats();
    assert.equal(stats.upstreamRequests, 1);
    assert.equal(stats.coalescedHits, 24);
    assert.equal(stats.cacheHits, 1);
  });

  it('activates global cooldown on HTTP 429 with Retry-After and prevents request storms', async () => {
    let cooldownTriggered = false;
    const guard = new ApiRateGuard({
      maxBurst: 10,
      refillPerSec: 10,
      baseBackoffMs: 1000,
      maxBackoffMs: 15000,
      onCooldown: () => {
        cooldownTriggered = true;
      },
    });

    assert.equal(parseRetryAfterMs('7'), 7000);
    assert.ok(parseRetryAfterMs(new Date(Date.now() + 5000).toUTCString()) > 0);

    await assert.rejects(
      () =>
        guard.run('bbox:test', { ttlMs: 1000 }, async () => {
          const fake429 = { status: 429, headers: new Headers({ 'retry-after': '4' }) };
          checkThrottledResponse(guard, fake429);
        }),
      RateLimitCooldownError
    );

    assert.equal(cooldownTriggered, true);
    assert.equal(guard.isCoolingDown(), true);
    assert.ok(guard.getCooldownRemainingMs() >= 3000);

    // Follow-up calls during cooldown are skipped immediately instead of hammering upstream
    let executedDuringCooldown = false;
    await assert.rejects(
      () =>
        guard.run('tile:5/1/1', { ttlMs: 1000 }, async () => {
          executedDuringCooldown = true;
          return 1;
        }),
      RateLimitCooldownError
    );
    assert.equal(executedDuringCooldown, false);
    assert.equal(guard.getStats().skippedDuringCooldown, 1);
  });

  it('computes antimeridian-safe center-first viewport MVT tiles and exposes server /api/viewport & rateLimit status', async () => {
    const tiles = getViewportMvtTiles(35.1, 179.5, 6, 8, 5, 12);
    assert.ok(tiles.length > 0 && tiles.length <= 12);
    assert.ok(tiles.some((t) => t.x === 31) && tiles.some((t) => t.x === 0));

    const srv = new ShipTrackerServer({ port: 0, host: '127.0.0.1', autoConnect: false });
    try {
      await srv.start();
      const base = `http://127.0.0.1:${srv.port}`;

      const vpRes = await fetch(`${base}/api/viewport`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lat: 35.1, lon: 129.0, zoom: 5.0, halfLat: 5, halfLon: 7 }),
      });
      assert.equal(vpRes.status, 200);
      const vpJson = await vpRes.json();
      assert.equal(vpJson.ok, true);
      assert.ok(vpJson.rateLimit && typeof vpJson.rateLimit.upstreamRequests === 'number');

      const stRes = await fetch(`${base}/api/status`);
      const stJson = await stRes.json();
      assert.equal(typeof stJson.connectedClients, 'number');
      assert.ok(stJson.rateLimit && typeof stJson.rateLimit.cacheSize === 'number');
    } finally {
      await srv.stop();
    }
  });
});

describe('Nautical Analysis Tools, Port Geofence & Favorite Status Alerts', () => {
  it('computes accurate Dead Reckoning destinationPoint matching haversineNm & initialBearing', () => {
    const startLat = 35.1;
    const startLon = 129.04;
    const dest = destinationPoint(startLat, startLon, 45, 60);
    const dist = haversineNm(startLat, startLon, dest.lat, dest.lon);
    const brg = initialBearing(startLat, startLon, dest.lat, dest.lon);
    assert.ok(Math.abs(dist - 60) < 0.05);
    assert.ok(Math.abs(brg - 45) < 0.1);
  });

  it('filters vessels within 15NM port control radius and detects favorite departure/arrival changes', () => {
    const busan = { name: '부산항', lat: 35.1, lon: 129.04, radiusNm: 15 };
    const ships = [
      { mmsi: '440100001', name: 'NEAR SHIP', type: 'container', lat: 35.12, lon: 129.08, sog: 12.0 },
      { mmsi: '440100002', name: 'FAR SHIP', type: 'container', lat: 37.5, lon: 126.6, sog: 14.0 },
    ];
    const filtered = filterVesselsList(ships, {
      movingOnly: false,
      activeType: 'all',
      searchQuery: '',
      favorites: new Set(),
      portFilter: busan,
    });
    assert.equal(filtered.length, 1);
    assert.equal(filtered[0].mmsi, '440100001');

    const alerts = [];
    const checkFav = createFavoriteMonitor((ev) => alerts.push(ev));
    const map = new Map([['440100001', { mmsi: '440100001', name: 'KOREA STAR', sog: 0.1 }]]);
    const favs = new Set(['440100001']);

    // First tick records baseline moored state (no alert)
    checkFav(map, favs);
    assert.equal(alerts.length, 0);

    // Vessel departs (sog crosses 0.5kn)
    map.set('440100001', { mmsi: '440100001', name: 'KOREA STAR', sog: 6.4 });
    checkFav(map, favs);
    assert.equal(alerts.length, 1);
    assert.equal(alerts[0].type, 'departed');

    // Vessel arrives/moors
    map.set('440100001', { mmsi: '440100001', name: 'KOREA STAR', sog: 0.2 });
    checkFav(map, favs);
    assert.equal(alerts.length, 2);
    assert.equal(alerts[1].type, 'moored');

    // Marine weather card renders cleanly inside inspector HTML
    const html = renderInspectorBodyHtml(
      {
        mmsi: '440100001',
        name: 'KOREA STAR',
        type: 'container',
        lat: 35.1,
        lon: 129.04,
        sog: 12.5,
        cog: 90,
        trail: [],
      },
      false,
      false,
      true,
      { waveHeight: 1.4, wavePeriod: 6.2, waveDir: 180, seaTemp: 17.8, windKn: 14.2, windDir: 210 }
    );
    assert.ok(html.includes('Open-Meteo Marine'));
    assert.ok(html.includes('1.4 m'));
    assert.ok(html.includes('14.2 kn'));
    assert.ok(html.includes('btn-measure-from-vessel'));
  });

  it('defaults to English (en) and cleanly switches UI/zone/port labels to Korean (ko)', () => {
    assert.equal(resolveInitialLang(undefined), 'en');
    assert.equal(resolveInitialLang('ko'), 'ko');
    setLang('en');
    assert.equal(getLang(), 'en');
    assert.equal(t('btnScanView'), 'Scan View');
    assert.equal(getZoneLabel('korea-strait'), 'Korea Strait');
    assert.equal(getPortDisplayName({ name: '부산', nameEn: 'Busan' }), 'Busan');

    setLang('ko');
    assert.equal(getLang(), 'ko');
    assert.equal(t('btnScanView'), '현재 화면 수신');
    assert.equal(getZoneLabel('korea-strait'), '한반도·대한해협');
    assert.equal(getPortDisplayName({ name: '부산', nameEn: 'Busan' }), '부산');

    // Restore default English
    setLang('en');
  });
});



