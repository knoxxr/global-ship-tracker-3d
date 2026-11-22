/**
 * High-fidelity Global Maritime AIS Simulator.
 * Generates 320+ realistic vessels steaming along authentic international
 * sea lanes (Trans-Pacific, Asia-Europe via Suez, Trans-Atlantic, Panama Canal,
 * Persian Gulf oil routes, Cape of Good Hope, East Asia coastal, North Sea/Med).
 * Positions advance continuously via great-circle SLERP kinematics.
 */

import { haversineNm, initialBearing, slerpLatLon } from './geo-math.js';
import { flagFromMmsi } from './ais-parser.js';

export const MAJOR_PORTS = [
  { code: 'KRPUS', name: '부산항 (Busan)', lat: 35.10, lon: 129.04 },
  { code: 'KRINC', name: '인천항 (Incheon)', lat: 37.45, lon: 126.60 },
  { code: 'CNSHA', name: '상하이항 (Shanghai)', lat: 31.23, lon: 121.47 },
  { code: 'HKHKG', name: '홍콩항 (Hong Kong)', lat: 22.30, lon: 114.17 },
  { code: 'JPYOK', name: '요코하마항 (Yokohama)', lat: 35.44, lon: 139.64 },
  { code: 'SGSIN', name: '싱가포르항 (Singapore)', lat: 1.26, lon: 103.82 },
  { code: 'AEJEA', name: '두바이 제벨알리 (Dubai)', lat: 25.01, lon: 55.06 },
  { code: 'EGPSD', name: '포트사이드/수에즈 (Suez)', lat: 31.26, lon: 32.31 },
  { code: 'NLRTM', name: '로테르담항 (Rotterdam)', lat: 51.95, lon: 4.13 },
  { code: 'DEHAM', name: '함부르크항 (Hamburg)', lat: 53.54, lon: 9.97 },
  { code: 'GRPIR', name: '피레우스항 (Piraeus)', lat: 37.94, lon: 23.64 },
  { code: 'USLAX', name: '로스앤젤레스항 (LA)', lat: 33.74, lon: -118.27 },
  { code: 'USNYC', name: '뉴욕/뉴저지항 (New York)', lat: 40.67, lon: -74.04 },
  { code: 'PAPTY', name: '파나마 운하 (Panama)', lat: 8.95, lon: -79.56 },
  { code: 'BRSSZ', name: '산토스항 (Santos)', lat: -23.96, lon: -46.30 },
  { code: 'ZACPT', name: '케이프타운항 (Cape Town)', lat: -33.91, lon: 18.43 },
  { code: 'AUSYD', name: '시드니항 (Sydney)', lat: -33.85, lon: 151.21 },
];

/**
 * Verified ocean-only waypoints [lat, lon] along global shipping corridors.
 */
export const SHIPPING_CORRIDORS = [
  {
    id: 'pacific-north',
    name: '태평양 횡단 항로 (부산 ↔ LA)',
    origin: 'KRPUS',
    destination: 'USLAX',
    types: ['container', 'bulk', 'container', 'tanker'],
    vesselCount: 38,
    waypoints: [
      [35.0, 129.1], [33.5, 134.5], [34.8, 141.5], [39.5, 155.0],
      [43.0, 172.0], [43.5, -170.0], [41.5, -150.0], [37.5, -132.0],
      [33.7, -118.3],
    ],
  },
  {
    id: 'asia-europe-suez',
    name: '아시아-유럽 수에즈 항로 (상하이 ↔ 로테르담)',
    origin: 'CNSHA',
    destination: 'NLRTM',
    types: ['container', 'container', 'tanker', 'bulk'],
    vesselCount: 54,
    waypoints: [
      [31.1, 122.2], [25.5, 121.0], [20.5, 115.0], [11.0, 110.5],
      [2.0, 104.8], [1.2, 103.6], [4.5, 99.2], [6.2, 94.0],
      [5.8, 80.2], [9.5, 67.0], [12.3, 52.0], [12.7, 43.3],
      [21.0, 38.2], [29.8, 32.5], [31.5, 32.3], [35.2, 23.0],
      [36.8, 13.5], [36.0, -5.5], [37.0, -9.5], [43.5, -9.8],
      [49.5, -4.5], [51.1, 1.5], [52.0, 4.0],
    ],
  },
  {
    id: 'trans-atlantic',
    name: '대서양 횡단 항로 (로테르담 ↔ 뉴욕)',
    origin: 'NLRTM',
    destination: 'USNYC',
    types: ['container', 'passenger', 'tanker', 'bulk'],
    vesselCount: 30,
    waypoints: [
      [52.0, 4.0], [50.8, 1.2], [49.4, -5.5], [48.5, -18.0],
      [46.5, -35.0], [43.5, -52.0], [41.2, -66.0], [40.5, -73.9],
    ],
  },
  {
    id: 'asia-us-panama',
    name: '파나마 운하 항로 (부산 ↔ 뉴욕)',
    origin: 'KRPUS',
    destination: 'USNYC',
    types: ['container', 'tanker', 'bulk'],
    vesselCount: 34,
    waypoints: [
      [34.9, 129.2], [32.0, 138.0], [28.0, 158.0], [23.0, 178.0],
      [18.5, -158.0], [14.0, -130.0], [10.5, -102.0], [8.5, -80.2],
      [9.4, -79.9], [16.5, -78.0], [22.5, -74.5], [29.5, -76.5],
      [36.5, -74.0], [40.5, -73.9],
    ],
  },
  {
    id: 'gulf-east-asia',
    name: '중동 원유/LNG 수송로 (두바이 ↔ 부산)',
    origin: 'AEJEA',
    destination: 'KRPUS',
    types: ['tanker', 'tanker', 'tanker', 'bulk'],
    vesselCount: 28,
    waypoints: [
      [25.2, 55.1], [26.4, 56.4], [24.0, 59.5], [16.0, 67.0],
      [7.0, 77.5], [5.8, 81.2], [5.9, 95.0], [2.5, 101.8],
      [1.3, 104.2], [10.0, 111.0], [21.5, 117.0], [28.5, 124.0],
      [34.9, 129.1],
    ],
  },
  {
    id: 'cape-europe-asia',
    name: '희망봉 우회 항로 (로테르담 ↔ 싱가포르)',
    origin: 'NLRTM',
    destination: 'SGSIN',
    types: ['tanker', 'bulk', 'container'],
    vesselCount: 28,
    waypoints: [
      [51.9, 3.8], [49.4, -5.2], [43.0, -10.5], [32.0, -14.0],
      [16.0, -19.5], [0.0, -11.0], [-18.0, 4.0], [-34.5, 18.0],
      [-35.5, 22.0], [-29.0, 40.0], [-18.0, 62.0], [-6.0, 86.0],
      [1.2, 103.5],
    ],
  },
  {
    id: 'south-america-europe',
    name: '남미-유럽 항로 (산토스 ↔ 로테르담)',
    origin: 'BRSSZ',
    destination: 'NLRTM',
    types: ['bulk', 'container', 'tanker'],
    vesselCount: 22,
    waypoints: [
      [-24.2, -46.2], [-18.0, -37.5], [-6.0, -33.5], [8.0, -27.5],
      [22.0, -21.0], [36.0, -12.5], [44.0, -9.8], [49.5, -4.5],
      [51.9, 3.8],
    ],
  },
  {
    id: 'oceania-east-asia',
    name: '오세아니아-동아시아 항로 (시드니 ↔ 요코하마)',
    origin: 'AUSYD',
    destination: 'JPYOK',
    types: ['bulk', 'tanker', 'container', 'passenger'],
    vesselCount: 20,
    waypoints: [
      [-33.8, 151.6], [-26.0, 154.5], [-16.0, 153.5], [-6.0, 152.0],
      [4.0, 148.0], [16.0, 144.0], [27.5, 141.0], [35.2, 139.8],
    ],
  },
  {
    id: 'east-asia-coastal',
    name: '동북아 연안/한일중 항로 (인천 ↔ 부산 ↔ 홍콩)',
    origin: 'KRINC',
    destination: 'HKHKG',
    types: ['container', 'fishing', 'passenger', 'special', 'bulk'],
    vesselCount: 28,
    waypoints: [
      [37.2, 126.2], [34.4, 125.6], [33.8, 127.6], [35.0, 129.1],
      [33.2, 129.2], [31.2, 123.0], [26.8, 121.2], [23.2, 117.5],
      [22.1, 114.2],
    ],
  },
  {
    id: 'mediterranean-intra',
    name: '지중해 항로 (지브롤터 ↔ 피레우스 ↔ 수에즈)',
    origin: 'GRPIR',
    destination: 'EGPSD',
    types: ['passenger', 'container', 'fishing', 'special'],
    vesselCount: 18,
    waypoints: [
      [36.0, -5.2], [38.0, 2.0], [41.5, 7.5], [38.2, 15.5],
      [37.6, 23.6], [35.2, 27.5], [31.5, 32.3],
    ],
  },
  {
    id: 'north-sea-baltic',
    name: '북해-스칸디나비아 연안 (로테르담 ↔ 함부르크)',
    origin: 'NLRTM',
    destination: 'DEHAM',
    types: ['special', 'fishing', 'tanker', 'passenger', 'container'],
    vesselCount: 16,
    waypoints: [
      [52.1, 3.8], [54.2, 5.2], [54.1, 8.2], [57.8, 9.8],
      [59.0, 10.6], [57.2, 7.5], [53.9, 8.5],
    ],
  },
  {
    id: 'caribbean-americas',
    name: '미주/카리브해 크루즈 및 연안 항로',
    origin: 'USNYC',
    destination: 'PAPTY',
    types: ['passenger', 'passenger', 'tanker', 'container'],
    vesselCount: 16,
    waypoints: [
      [40.4, -73.8], [34.5, -75.0], [25.8, -79.8], [21.5, -84.5],
      [16.5, -82.5], [10.0, -79.8],
    ],
  },
];

const VESSEL_PREFIXES = {
  container: [
    'HMM', 'MAERSK', 'MSC', 'CMA CGM', 'EVER', 'COSCO', 'ONE', 'HAPAG', 'YANG MING', 'ZIM',
  ],
  tanker: [
    'PACIFIC', 'ATLANTIC', 'KOREA GAS', 'HYUNDAI LNG', 'FRONT', 'STENA', 'SHELL', 'DHT', 'EAGLE', 'NORDIC',
  ],
  bulk: [
    'PAN OCEAN', 'STAR', 'GOLDEN', 'CAPE', 'OCEAN', 'ORIENT', 'FEDERAL', 'BERGE', 'OLDENDORFF', 'POLARIS',
  ],
  passenger: [
    'SYMPHONY', 'QUANTUM', 'NORWEGIAN', 'PRINCESS', 'QUEEN', 'CELEBRITY', 'MSC', 'COSTA', 'VIKING', 'SEABOURN',
  ],
  fishing: [
    'HAEUNDONG', 'DONGWON', 'SAJO', 'NORTH STAR', 'PACIFIC HARVEST', 'BALTIC', 'ATLANTIC', 'KAIYO',
  ],
  special: [
    'ISABU', 'ARAON', 'OCEAN SURVEYOR', 'CABLE INNOVATOR', 'SEISMIC', 'DEEPWATER', 'GUARDIAN', 'RESCUE',
  ],
};

const VESSEL_SUFFIXES = [
  'ALGECIRAS', 'SEOUL', 'BUSAN', 'OSLO', 'ROTTERDAM', 'SINGAPORE', 'VANGUARD',
  'HORIZON', 'ENTERPRISE', 'APEX', 'LEGACY', 'SPIRIT', 'TRIUMPH', 'VOYAGER',
  'MERIDIAN', 'VENTURE', 'ZENITH', 'ODYSSEY', 'PIONEER', 'SOLARIS', 'AURORA',
  'EXPLORER', 'TITAN', 'ATLAS', 'NAVIGATOR', 'CROWN', 'GLORY', 'EXPRESS',
  'HARMONY', 'FREEDOM', 'FORTUNE', 'LIBERTY', 'VICTORY', 'PRIDE', 'EMERALD',
];

const TYPE_SPECS = {
  container: { aisCode: 71, speedRange: [16.5, 23.0], lenRange: [260, 400], beamRange: [38, 61], draughtRange: [11.5, 16.0] },
  tanker:    { aisCode: 80, speedRange: [11.5, 16.5], lenRange: [220, 333], beamRange: [40, 60], draughtRange: [11.0, 21.0] },
  bulk:      { aisCode: 70, speedRange: [11.0, 14.8], lenRange: [180, 300], beamRange: [30, 48], draughtRange: [9.5, 18.0] },
  passenger: { aisCode: 60, speedRange: [17.0, 22.5], lenRange: [210, 362], beamRange: [32, 48], draughtRange: [7.5, 9.5] },
  fishing:   { aisCode: 30, speedRange: [6.0, 11.5],  lenRange: [38, 95],   beamRange: [9, 18],  draughtRange: [3.5, 6.5] },
  special:   { aisCode: 52, speedRange: [9.0, 15.5],  lenRange: [65, 145],  beamRange: [14, 26], draughtRange: [4.5, 8.5] },
};

const FLAG_MIDS = ['440', '441', '563', '351', '636', '538', '412', '431', '219', '211', '235', '366', '257', '244', '226', '247', '477', '416'];

// Deterministic PRNG (Mulberry32) so tests and initial distribution are clean & reproducible
function createRng(seed = 20261121) {
  let a = seed >>> 0;
  return function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Precompute cumulative distances for a corridor's waypoint polyline.
 */
function buildRouteMetrics(waypoints) {
  const segLengths = [];
  let totalNm = 0;
  for (let i = 0; i < waypoints.length - 1; i++) {
    const [lat1, lon1] = waypoints[i];
    const [lat2, lon2] = waypoints[i + 1];
    const d = haversineNm(lat1, lon1, lat2, lon2);
    segLengths.push(d);
    totalNm += d;
  }
  return { segLengths, totalNm };
}

/**
 * Evaluate lat/lon/cog at distance `distNm` along a route (forward or reversed).
 */
function sampleRoute(waypoints, metrics, distNm, reverse, lateralOffsetDeg) {
  const total = metrics.totalNm;
  let d = ((distNm % total) + total) % total;
  if (reverse) d = total - d;

  let acc = 0;
  let segIdx = 0;
  for (let i = 0; i < metrics.segLengths.length; i++) {
    if (acc + metrics.segLengths[i] >= d || i === metrics.segLengths.length - 1) {
      segIdx = i;
      break;
    }
    acc += metrics.segLengths[i];
  }

  const segLen = Math.max(0.001, metrics.segLengths[segIdx]);
  const t = Math.max(0, Math.min(1, (d - acc) / segLen));
  const [lat1, lon1] = waypoints[segIdx];
  const [lat2, lon2] = waypoints[segIdx + 1];

  const pos = slerpLatLon(lat1, lon1, lat2, lon2, t);
  const cog = reverse
    ? initialBearing(lat2, lon2, lat1, lon1)
    : initialBearing(lat1, lon1, lat2, lon2);

  // Apply gentle perpendicular corridor spread so ships form realistic traffic lanes
  const perpRad = ((cog + 90) * Math.PI) / 180;
  const latSpread = Math.cos(perpRad) * lateralOffsetDeg;
  const lonSpread =
    (Math.sin(perpRad) * lateralOffsetDeg) / Math.max(0.25, Math.cos((pos.lat * Math.PI) / 180));

  return {
    lat: Math.max(-85, Math.min(85, pos.lat + latSpread)),
    lon: ((pos.lon + lonSpread + 540) % 360) - 180,
    cog: Math.round(cog) % 360,
  };
}

export class GlobalAisSimulator {
  constructor(seed = 20261121) {
    this.rng = createRng(seed);
    this.vessels = [];
    this.corridorMetrics = new Map();
    this.speedMultiplier = 120; // Visual default multiplier; client or server can adjust
    this.lastTickMs = Date.now();
    this._initFleet();
  }

  _initFleet() {
    let idx = 1;
    for (const corridor of SHIPPING_CORRIDORS) {
      const metrics = buildRouteMetrics(corridor.waypoints);
      this.corridorMetrics.set(corridor.id, metrics);

      for (let i = 0; i < corridor.vesselCount; i++) {
        const type = corridor.types[i % corridor.types.length];
        const spec = TYPE_SPECS[type];
        const reverse = i % 2 === 1;
        const mid = FLAG_MIDS[Math.floor(this.rng() * FLAG_MIDS.length)];
        const mmsi = `${mid}${String(100000 + Math.floor(this.rng() * 899999))}`;
        const flag = flagFromMmsi(mmsi);
        const imo = `9${String(100000 + Math.floor(this.rng() * 899999))}`;

        const prefixes = VESSEL_PREFIXES[type];
        const prefix = prefixes[Math.floor(this.rng() * prefixes.length)];
        const suffix = VESSEL_SUFFIXES[Math.floor(this.rng() * VESSEL_SUFFIXES.length)];
        const name = `${prefix} ${suffix}${idx % 5 === 0 ? ' ' + ((idx % 9) + 1) : ''}`;

        const sog = Number(
          (spec.speedRange[0] + this.rng() * (spec.speedRange[1] - spec.speedRange[0])).toFixed(1)
        );
        const length = Math.round(
          spec.lenRange[0] + this.rng() * (spec.lenRange[1] - spec.lenRange[0])
        );
        const beam = Math.round(
          spec.beamRange[0] + this.rng() * (spec.beamRange[1] - spec.beamRange[0])
        );
        const draught = Number(
          (spec.draughtRange[0] + this.rng() * (spec.draughtRange[1] - spec.draughtRange[0])).toFixed(1)
        );

        const distNm = this.rng() * metrics.totalNm;
        // Narrower spread near straits, slightly broader in open ocean
        const lateralOffsetDeg = (this.rng() - 0.5) * 0.45;
        const sample = sampleRoute(corridor.waypoints, metrics, distNm, reverse, lateralOffsetDeg);

        // Pre-seed short wake trail behind vessel
        const trail = [];
        for (let step = 8; step >= 1; step--) {
          const pastDist = distNm - step * 35;
          const p = sampleRoute(corridor.waypoints, metrics, pastDist, reverse, lateralOffsetDeg);
          trail.push([Number(p.lat.toFixed(4)), Number(p.lon.toFixed(4))]);
        }
        trail.push([Number(sample.lat.toFixed(4)), Number(sample.lon.toFixed(4))]);

        const remainingNm = Math.max(20, metrics.totalNm - distNm);
        const etaHours = Math.round(remainingNm / Math.max(4, sog));
        const etaDate = new Date(Date.now() + etaHours * 3600 * 1000);
        const etaStr = `${String(etaDate.getUTCMonth() + 1).padStart(2, '0')}-${String(
          etaDate.getUTCDate()
        ).padStart(2, '0')} ${String(etaDate.getUTCHours()).padStart(2, '0')}:00 UTC`;

        const callChars = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
        const callsign =
          flag.code +
          callChars[Math.floor(this.rng() * callChars.length)] +
          callChars[Math.floor(this.rng() * callChars.length)] +
          Math.floor(10 + this.rng() * 89);

        this.vessels.push({
          mmsi,
          imo,
          name,
          callsign,
          flagCode: flag.code,
          flagName: flag.name,
          type,
          aisTypeCode: spec.aisCode,
          lat: Number(sample.lat.toFixed(4)),
          lon: Number(sample.lon.toFixed(4)),
          sog,
          cog: sample.cog,
          heading: (sample.cog + Math.round((this.rng() - 0.5) * 4) + 360) % 360,
          navStatus: type === 'fishing' ? '어로 작업 중' : '항해 중 (엔진)',
          draught,
          length,
          beam,
          origin: reverse ? corridor.destination : corridor.origin,
          destination: reverse ? corridor.origin : corridor.destination,
          corridorId: corridor.id,
          corridorName: corridor.name,
          eta: etaStr,
          source: 'simulator',
          updatedAt: Date.now(),
          trail,
          // Internal kinematics state
          _distNm: distNm,
          _reverse: reverse,
          _lateralOffsetDeg: lateralOffsetDeg,
          _waypoints: corridor.waypoints,
          _metrics: metrics,
          _trailAccumNm: 0,
        });
        idx++;
      }
    }
  }

  /**
   * Advance all simulated ships by `dtSeconds` (scaled by `timeScale`).
   */
  step(dtSeconds, timeScale = 1) {
    if (dtSeconds <= 0 || timeScale <= 0) return;
    const now = Date.now();
    const hours = (dtSeconds * timeScale) / 3600;

    for (const v of this.vessels) {
      const deltaNm = v.sog * hours;
      v._distNm = (v._distNm + deltaNm) % v._metrics.totalNm;
      v._trailAccumNm += deltaNm;

      const sample = sampleRoute(
        v._waypoints,
        v._metrics,
        v._distNm,
        v._reverse,
        v._lateralOffsetDeg
      );
      v.lat = Number(sample.lat.toFixed(4));
      v.lon = Number(sample.lon.toFixed(4));
      v.cog = sample.cog;
      v.heading = sample.cog;
      v.updatedAt = now;

      if (v._trailAccumNm >= 25) {
        v._trailAccumNm = 0;
        v.trail.push([v.lat, v.lon]);
        if (v.trail.length > 14) v.trail.shift();
      }
    }
  }

  /**
   * Return clean serializable snapshot of all vessels (without internal _ fields).
   */
  getSnapshot() {
    return this.vessels.map((v) => ({
      mmsi: v.mmsi,
      imo: v.imo,
      name: v.name,
      callsign: v.callsign,
      flagCode: v.flagCode,
      flagName: v.flagName,
      type: v.type,
      aisTypeCode: v.aisTypeCode,
      lat: v.lat,
      lon: v.lon,
      sog: v.sog,
      cog: v.cog,
      heading: v.heading,
      navStatus: v.navStatus,
      draught: v.draught,
      length: v.length,
      beam: v.beam,
      origin: v.origin,
      destination: v.destination,
      corridorName: v.corridorName,
      eta: v.eta,
      source: v.source,
      updatedAt: v.updatedAt,
      trail: v.trail,
    }));
  }
}
