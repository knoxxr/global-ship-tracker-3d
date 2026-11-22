/**
 * Unified real-time AIS parser & normalizer.
 * Supports 100% real AIS feeds only (zero synthetic/simulated data):
 *  - Open Waters AIS WebSocket /v1/stream native events
 *  - Open Waters AIS REST /v1/vessels & /v1/vessels/{mmsi} GeoJSON features
 *  - Open Waters AIS /v1/vessels/{mmsi}/track GeoJSON LineStrings
 *  - Fintraffic Digitraffic Marine REST /api/ais/v1/locations + /vessels
 *  - AISStream.io WebSocket /v0/stream messages
 */

export const MID_FLAGS = {
  '201': { code: 'AL', name: '알바니아' },
  '205': { code: 'BE', name: '벨기에' },
  '209': { code: 'CY', name: '키프로스' },
  '210': { code: 'CY', name: '키프로스' },
  '211': { code: 'DE', name: '독일' },
  '212': { code: 'CY', name: '키프로스' },
  '215': { code: 'MT', name: '몰타' },
  '218': { code: 'DE', name: '독일' },
  '219': { code: 'DK', name: '덴마크' },
  '220': { code: 'DK', name: '덴마크' },
  '224': { code: 'ES', name: '스페인' },
  '225': { code: 'ES', name: '스페인' },
  '226': { code: 'FR', name: '프랑스' },
  '227': { code: 'FR', name: '프랑스' },
  '228': { code: 'FR', name: '프랑스' },
  '229': { code: 'MT', name: '몰타' },
  '230': { code: 'FI', name: '핀란드' },
  '232': { code: 'GB', name: '영국' },
  '233': { code: 'GB', name: '영국' },
  '234': { code: 'GB', name: '영국' },
  '235': { code: 'GB', name: '영국' },
  '236': { code: 'GI', name: '지브롤터' },
  '237': { code: 'GR', name: '그리스' },
  '239': { code: 'GR', name: '그리스' },
  '240': { code: 'GR', name: '그리스' },
  '241': { code: 'GR', name: '그리스' },
  '244': { code: 'NL', name: '네덜란드' },
  '245': { code: 'NL', name: '네덜란드' },
  '246': { code: 'NL', name: '네덜란드' },
  '247': { code: 'IT', name: '이탈리아' },
  '248': { code: 'MT', name: '몰타' },
  '249': { code: 'MT', name: '몰타' },
  '250': { code: 'IE', name: '아일랜드' },
  '255': { code: 'PT', name: '포르투갈' },
  '256': { code: 'MT', name: '몰타' },
  '257': { code: 'NO', name: '노르웨이' },
  '258': { code: 'NO', name: '노르웨이' },
  '259': { code: 'NO', name: '노르웨이' },
  '261': { code: 'PL', name: '폴란드' },
  '265': { code: 'SE', name: '스웨덴' },
  '266': { code: 'SE', name: '스웨덴' },
  '271': { code: 'TR', name: '튀르키예' },
  '273': { code: 'RU', name: '러시아' },
  '276': { code: 'EE', name: '에스토니아' },
  '277': { code: 'LT', name: '리투아니아' },
  '303': { code: 'US', name: '미국' },
  '304': { code: 'AG', name: '앤티가바부다' },
  '305': { code: 'AG', name: '앤티가바부다' },
  '308': { code: 'BS', name: '바하마' },
  '309': { code: 'BS', name: '바하마' },
  '311': { code: 'BS', name: '바하마' },
  '316': { code: 'CA', name: '캐나다' },
  '319': { code: 'KY', name: '케이맨제도' },
  '338': { code: 'US', name: '미국' },
  '351': { code: 'PA', name: '파나마' },
  '352': { code: 'PA', name: '파나마' },
  '353': { code: 'PA', name: '파나마' },
  '354': { code: 'PA', name: '파나마' },
  '355': { code: 'PA', name: '파나마' },
  '356': { code: 'PA', name: '파나마' },
  '357': { code: 'PA', name: '파나마' },
  '366': { code: 'US', name: '미국' },
  '367': { code: 'US', name: '미국' },
  '368': { code: 'US', name: '미국' },
  '369': { code: 'US', name: '미국' },
  '370': { code: 'PA', name: '파나마' },
  '371': { code: 'PA', name: '파나마' },
  '372': { code: 'PA', name: '파나마' },
  '373': { code: 'PA', name: '파나마' },
  '374': { code: 'PA', name: '파나마' },
  '412': { code: 'CN', name: '중국' },
  '413': { code: 'CN', name: '중국' },
  '414': { code: 'CN', name: '중국' },
  '416': { code: 'TW', name: '대만' },
  '419': { code: 'IN', name: '인도' },
  '431': { code: 'JP', name: '일본' },
  '432': { code: 'JP', name: '일본' },
  '440': { code: 'KR', name: '대한민국' },
  '441': { code: 'KR', name: '대한민국' },
  '470': { code: 'AE', name: '아랍에미리트' },
  '477': { code: 'HK', name: '홍콩' },
  '503': { code: 'AU', name: '호주' },
  '512': { code: 'NZ', name: '뉴질랜드' },
  '525': { code: 'ID', name: '인도네시아' },
  '533': { code: 'MY', name: '말레이시아' },
  '538': { code: 'MH', name: '마셜제도' },
  '548': { code: 'PH', name: '필리핀' },
  '563': { code: 'SG', name: '싱가포르' },
  '564': { code: 'SG', name: '싱가포르' },
  '565': { code: 'SG', name: '싱가포르' },
  '566': { code: 'SG', name: '싱가포르' },
  '567': { code: 'TH', name: '태국' },
  '574': { code: 'VN', name: '베트남' },
  '636': { code: 'LR', name: '라이베리아' },
  '637': { code: 'LR', name: '라이베리아' },
  '710': { code: 'BR', name: '브라질' },
};

export const NAV_STATUS_MAP = {
  0: '항해 중 (엔진)',
  1: '정박 중 (투묘)',
  2: '조종 불능',
  3: '조종 성능 제한',
  4: '흘수 제약',
  5: '계류 중 (Moored)',
  6: '좌초',
  7: '어로 작업 중',
  8: '범주 항해 중',
  11: '선미 예인 중',
  12: '추진/측면 예인 중',
  14: 'AIS-SART 활성',
  15: '미지정',
};

export function flagFromMmsi(mmsi) {
  const s = String(mmsi || '').padStart(9, '0');
  const mid = s.slice(0, 3);
  return MID_FLAGS[mid] || { code: 'INT', name: '국제선' };
}

export function classifyAisShipType(typeCode) {
  const code = Number(typeCode);
  if (!Number.isFinite(code) || code <= 0) return 'bulk';
  if (code >= 80 && code <= 89) return 'tanker';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code === 30) return 'fishing';
  if (code >= 71 && code <= 74) return 'container';
  if (code >= 70 && code <= 79) return 'bulk';
  if ((code >= 31 && code <= 59) || code >= 90) return 'special';
  return 'bulk';
}

export function describeAisShipType(typeCode) {
  const code = Number(typeCode);
  if (!Number.isFinite(code) || code <= 0) return '미보고 (AIS Type 0)';
  if (code === 30) return '30 · 어선 (Fishing)';
  if (code === 36) return '36 · 범선 (Sailing)';
  if (code === 37) return '37 · 레저/요트 (Pleasure Craft)';
  if (code === 50) return '50 · 도선선 (Pilot Vessel)';
  if (code === 51) return '51 · 수색구조선 (SAR)';
  if (code === 52) return '52 · 예인선 (Tug)';
  if (code === 55) return '55 · 법집행/경비정 (Law Enforcement)';
  if (code >= 60 && code <= 69) return `${code} · 여객/크루즈선 (Passenger)`;
  if (code === 71) return '71 · 화물/컨테이너선 (Cargo Haz A)';
  if (code >= 70 && code <= 79) return `${code} · 화물선 (Cargo)`;
  if (code === 84) return '84 · 액화가스/LNG 운반선 (Tanker)';
  if (code >= 80 && code <= 89) return `${code} · 유조선/탱커 (Tanker)`;
  if (code >= 31 && code <= 59) return `${code} · 특수목적선 (Special)`;
  return `${code} · 기타 선박`;
}

function isValidLatLon(lat, lon) {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180 &&
    !(Math.abs(lat) > 89.9 && Math.abs(lon) > 179.9) &&
    !(lat === 0 && lon === 0)
  );
}

function createEmptyVessel(mmsi, source = 'live') {
  const flag = flagFromMmsi(mmsi);
  return {
    mmsi: String(mmsi),
    imo: '',
    name: `MMSI ${mmsi}`,
    callsign: '',
    flagCode: flag.code,
    flagName: flag.name,
    aisClass: 'Class A',
    type: 'bulk',
    aisTypeCode: 0,
    aisTypeDesc: describeAisShipType(0),
    lat: null,
    lon: null,
    sog: 0,
    cog: 0,
    heading: null,
    rot: null,
    navStatusCode: 15,
    navStatus: NAV_STATUS_MAP[15],
    draught: null,
    length: null,
    beam: null,
    dimA: null,
    dimB: null,
    dimC: null,
    dimD: null,
    dwt: null,
    grossTonnage: null,
    builtYear: null,
    destination: '',
    eta: '',
    source,
    station: '',
    channel: '',
    attribution: '',
    particulars: null,
    updatedAt: Date.now(),
    trail: [],
  };
}

function appendTrail(trail, lat, lon, maxLen = 40) {
  const prev = trail[trail.length - 1];
  if (!prev || Math.abs(prev[0] - lat) + Math.abs(prev[1] - lon) > 0.004) {
    return [...trail.slice(-(maxLen - 1)), [Number(lat.toFixed(5)), Number(lon.toFixed(5))]];
  }
  return trail;
}

function formatAisEtaObj(eta) {
  if (!eta || typeof eta !== 'object') return '';
  if (!eta.Month || !eta.Day) return '';
  const m = String(eta.Month).padStart(2, '0');
  const d = String(eta.Day).padStart(2, '0');
  const h = String(eta.Hour ?? 0).padStart(2, '0');
  const min = String(eta.Minute ?? 0).padStart(2, '0');
  return `${m}-${d} ${h}:${min} UTC`;
}

/**
 * Parse Open Waters AIS native /v1/stream WebSocket event frame.
 */
export function parseOpenWatersEvent(ev, existing = null) {
  if (!ev || ev.type !== 'event') return null;
  const mmsi = String(ev.mmsi || ev.message?.UserID || '').trim();
  if (!mmsi) return null;

  const base = existing ? { ...existing } : createEmptyVessel(mmsi, ev.source || 'openwaters');
  if (ev.source) base.source = ev.source;
  if (ev.station) base.station = ev.station;
  if (ev.channel) base.channel = ev.channel;

  const ts = ev.time ? Date.parse(ev.time) : Date.now();
  base.updatedAt = Number.isFinite(ts) ? ts : Date.now();

  const msg = ev.message || {};
  const msgType = ev.msg_type || '';

  // Coordinates from top-level event or decoded payload
  const lat = Number(msg.Latitude ?? ev.lat);
  const lon = Number(msg.Longitude ?? ev.lon);
  if (isValidLatLon(lat, lon)) {
    base.lat = Number(lat.toFixed(5));
    base.lon = Number(lon.toFixed(5));
    base.trail = appendTrail(base.trail, base.lat, base.lon);
  }

  // Position reports (Class A & Class B)
  if (
    msgType === 'PositionReport' ||
    msgType === 'StandardClassBPositionReport' ||
    msgType === 'ExtendedClassBPositionReport' ||
    msgType === 'LongRangeAisBroadcastMessage'
  ) {
    base.aisClass = msgType.includes('ClassB') ? 'Class B' : 'Class A';
    const rawSog = Number(msg.Sog);
    if (Number.isFinite(rawSog) && rawSog >= 0 && rawSog < 102) {
      base.sog = Number(rawSog.toFixed(1));
    }
    const rawCog = Number(msg.Cog);
    if (Number.isFinite(rawCog) && rawCog >= 0 && rawCog < 360) {
      base.cog = Math.round(rawCog);
    }
    const rawHdg = Number(msg.TrueHeading);
    if (Number.isFinite(rawHdg) && rawHdg >= 0 && rawHdg < 360) {
      base.heading = Math.round(rawHdg);
    }
    const rawRot = Number(msg.RateOfTurn);
    if (Number.isFinite(rawRot) && Math.abs(rawRot) < 127) {
      base.rot = Number((rawRot / 10).toFixed(1));
    }
    if (msg.NavigationalStatus !== undefined && msg.NavigationalStatus !== null) {
      base.navStatusCode = Number(msg.NavigationalStatus);
      base.navStatus = NAV_STATUS_MAP[base.navStatusCode] || base.navStatus;
    }
  }

  // Static data (Type 5 & Type 24)
  if (msgType === 'ShipStaticData' || msgType === 'StaticDataReport') {
    const name = (msg.Name || msg.ReportA?.Name || '').trim();
    if (name) base.name = name;
    if (msg.ImoNumber && Number(msg.ImoNumber) > 0) base.imo = String(msg.ImoNumber);
    const callsign = (msg.CallSign || msg.ReportB?.CallSign || '').trim();
    if (callsign) base.callsign = callsign;
    const dest = (msg.Destination || '').trim();
    if (dest) base.destination = dest;

    const shipType = Number(msg.Type ?? msg.ReportB?.ShipType);
    if (Number.isFinite(shipType) && shipType > 0) {
      base.aisTypeCode = shipType;
      base.type = classifyAisShipType(shipType);
      base.aisTypeDesc = describeAisShipType(shipType);
    }
    if (Number.isFinite(Number(msg.MaximumStaticDraught)) && Number(msg.MaximumStaticDraught) > 0) {
      base.draught = Number(msg.MaximumStaticDraught);
    }
    const dim = msg.Dimension || msg.ReportB?.Dimension;
    if (dim) {
      const a = Number(dim.A) || 0;
      const b = Number(dim.B) || 0;
      const c = Number(dim.C) || 0;
      const d = Number(dim.D) || 0;
      if (a + b > 0) {
        base.length = a + b;
        base.dimA = a;
        base.dimB = b;
      }
      if (c + d > 0) {
        base.beam = c + d;
        base.dimC = c;
        base.dimD = d;
      }
    }
    const etaStr = formatAisEtaObj(msg.Eta);
    if (etaStr) base.eta = etaStr;
  }

  return base.lat !== null && base.lon !== null ? base : null;
}

/**
 * Parse Open Waters AIS REST GeoJSON Feature (/v1/vessels or /v1/vessels/{mmsi}).
 */
export function parseOpenWatersFeature(feature, existing = null) {
  if (!feature || feature.type !== 'Feature') return null;
  const props = feature.properties || {};
  const mmsi = String(props.mmsi || feature.id || '').trim();
  if (!mmsi) return null;

  const coords = feature.geometry?.coordinates;
  const lon = Array.isArray(coords) ? Number(coords[0]) : NaN;
  const lat = Array.isArray(coords) ? Number(coords[1]) : NaN;

  const base = existing ? { ...existing } : createEmptyVessel(mmsi, props.source || 'openwaters');

  if (isValidLatLon(lat, lon)) {
    base.lat = Number(lat.toFixed(5));
    base.lon = Number(lon.toFixed(5));
    base.trail = appendTrail(base.trail, base.lat, base.lon);
  } else if (base.lat === null || base.lon === null) {
    return null;
  }

  if (props.name && String(props.name).trim()) base.name = String(props.name).trim();
  if (props.imo && Number(props.imo) > 0) base.imo = String(props.imo);
  if (props.callsign && String(props.callsign).trim()) base.callsign = String(props.callsign).trim();
  if (props.call_sign && String(props.call_sign).trim()) base.callsign = String(props.call_sign).trim();
  if (props.class) base.aisClass = props.class === 'B' ? 'Class B' : 'Class A';
  if (props.flag && String(props.flag).trim()) base.flagCode = String(props.flag).trim();

  const shipType = Number(props.type ?? props.ship_type);
  if (Number.isFinite(shipType) && shipType > 0) {
    base.aisTypeCode = shipType;
    base.type = classifyAisShipType(shipType);
    base.aisTypeDesc = describeAisShipType(shipType);
  }

  if (Number.isFinite(Number(props.sog)) && Number(props.sog) < 102) {
    base.sog = Number(Number(props.sog).toFixed(1));
  }
  if (Number.isFinite(Number(props.cog)) && Number(props.cog) < 360) {
    base.cog = Math.round(Number(props.cog));
  }
  if (Number.isFinite(Number(props.heading)) && Number(props.heading) < 360) {
    base.heading = Math.round(Number(props.heading));
  }
  if (Number.isFinite(Number(props.rot)) && Math.abs(Number(props.rot)) < 127) {
    base.rot = Number(Number(props.rot).toFixed(1));
  }
  if (props.nav_status !== undefined && props.nav_status !== null) {
    base.navStatusCode = Number(props.nav_status);
    base.navStatus = NAV_STATUS_MAP[base.navStatusCode] || base.navStatus;
  }

  if (Number.isFinite(Number(props.length)) && Number(props.length) > 0) base.length = Math.round(Number(props.length));
  if (Number.isFinite(Number(props.beam)) && Number(props.beam) > 0) base.beam = Math.round(Number(props.beam));
  if (Number.isFinite(Number(props.to_bow))) base.dimA = Number(props.to_bow);
  if (Number.isFinite(Number(props.to_stern))) base.dimB = Number(props.to_stern);
  if (Number.isFinite(Number(props.to_port))) base.dimC = Number(props.to_port);
  if (Number.isFinite(Number(props.to_starboard))) base.dimD = Number(props.to_starboard);
  if (Number.isFinite(Number(props.draught)) && Number(props.draught) > 0) base.draught = Number(props.draught);
  if (props.destination && String(props.destination).trim()) base.destination = String(props.destination).trim();
  if (props.eta && typeof props.eta === 'string') base.eta = props.eta;
  if (props.near && String(props.near).trim()) base.near = String(props.near).trim();
  if (props.first_seen && typeof props.first_seen === 'string') base.firstSeen = props.first_seen;

  if (props.source) base.source = String(props.source);
  if (props.station) base.station = String(props.station);
  if (typeof props.attribution === 'string' && props.attribution) {
    base.attribution = props.attribution;
  } else if (feature.attribution && typeof feature.attribution === 'object') {
    base.attribution = Object.values(feature.attribution).filter(Boolean).join(' · ');
  }

  // Merge registered particulars when returned by /v1/vessels/{mmsi}
  if (props.particulars && typeof props.particulars === 'object') {
    base.particulars = props.particulars;
    const p = props.particulars;
    if (!base.imo && p.imo) base.imo = String(p.imo);
    if (!base.length && Number(p.length) > 0) base.length = Math.round(Number(p.length));
    if (!base.beam && Number(p.beam) > 0) base.beam = Math.round(Number(p.beam));
    if (Number(p.deadweight ?? p.dwt) > 0) base.dwt = Math.round(Number(p.deadweight ?? p.dwt));
    if (Number(p.gross_tonnage ?? p.gt) > 0) base.grossTonnage = Math.round(Number(p.gross_tonnage ?? p.gt));
    if (Number(p.year_built ?? p.built) > 0) base.builtYear = Number(p.year_built ?? p.built);
  }

  const seenTs = props.seen ? Date.parse(props.seen) : Date.now();
  base.updatedAt = Number.isFinite(seenTs) ? seenTs : Date.now();
  return base;
}

/**
 * Parse a decoded Open Waters MVT vector tile point (/v1/vessels/tiles/{z}/{x}/{y}).
 */
export function parseOpenWatersTilePoint(pt, existing = null) {
  if (!pt || !isValidLatLon(pt.lat, pt.lon)) return null;
  const props = pt.properties || {};
  const mmsi = String(props.mmsi || pt.id || '').trim();
  if (!mmsi) return null;

  // Skip non-vessel markers if present
  if (props.kind && props.kind !== 'vessel') return null;

  const base = existing ? { ...existing } : createEmptyVessel(mmsi, props.source || 'openwaters');
  base.lat = Number(pt.lat.toFixed(5));
  base.lon = Number(pt.lon.toFixed(5));
  if (base.trail.length === 0) {
    base.trail = [[base.lat, base.lon]];
  }

  if (props.name && String(props.name).trim()) base.name = String(props.name).trim();
  if (props.class) base.aisClass = props.class === 'B' ? 'Class B' : 'Class A';
  if (props.flag && String(props.flag).trim()) base.flagCode = String(props.flag).trim();

  const shipType = Number(props.type);
  if (Number.isFinite(shipType) && shipType > 0) {
    base.aisTypeCode = shipType;
    base.type = classifyAisShipType(shipType);
    base.aisTypeDesc = describeAisShipType(shipType);
  }

  if (Number.isFinite(Number(props.sog)) && Number(props.sog) < 102) {
    base.sog = Number(Number(props.sog).toFixed(1));
  }
  const cogVal = props.cog ?? props.hdg;
  if (Number.isFinite(Number(cogVal)) && Number(cogVal) < 360) {
    base.cog = Math.round(Number(cogVal));
  }
  if (Number.isFinite(Number(props.heading)) && Number(props.heading) < 360) {
    base.heading = Math.round(Number(props.heading));
  }
  if (props.nav_status !== undefined && props.nav_status !== null) {
    base.navStatusCode = Number(props.nav_status);
    base.navStatus = NAV_STATUS_MAP[base.navStatusCode] || base.navStatus;
  }

  if (Number.isFinite(Number(props.length)) && Number(props.length) > 0) base.length = Math.round(Number(props.length));
  if (Number.isFinite(Number(props.beam)) && Number(props.beam) > 0) base.beam = Math.round(Number(props.beam));
  if (Number.isFinite(Number(props.to_bow))) base.dimA = Number(props.to_bow);
  if (Number.isFinite(Number(props.to_stern))) base.dimB = Number(props.to_stern);
  if (Number.isFinite(Number(props.to_port))) base.dimC = Number(props.to_port);
  if (Number.isFinite(Number(props.to_starboard))) base.dimD = Number(props.to_starboard);
  if (props.source) base.source = String(props.source);
  if (props.station) base.station = String(props.station);

  if (Number.isFinite(Number(props.age_s))) {
    base.updatedAt = Date.now() - Math.max(0, Number(props.age_s)) * 1000;
  }
  return base;
}

/**
 * Parse Open Waters AIS /v1/vessels/{mmsi}/track GeoJSON Feature into [[lat, lon], ...].
 */
export function parseOpenWatersTrack(geo) {
  if (!geo || !geo.geometry) return [];
  const g = geo.geometry;
  if (g.type === 'LineString' && Array.isArray(g.coordinates)) {
    return g.coordinates
      .filter((c) => Array.isArray(c) && isValidLatLon(Number(c[1]), Number(c[0])))
      .map((c) => [Number(Number(c[1]).toFixed(5)), Number(Number(c[0]).toFixed(5))]);
  }
  if (g.type === 'Point' && Array.isArray(g.coordinates)) {
    const lat = Number(g.coordinates[1]);
    const lon = Number(g.coordinates[0]);
    return isValidLatLon(lat, lon) ? [[lat, lon]] : [];
  }
  return [];
}

/**
 * Parse official Fintraffic Digitraffic Marine REST responses
 * (/api/ais/v1/locations + /api/ais/v1/vessels).
 */
export function parseDigitrafficData(locationsGeoJson, vesselsMetaList = []) {
  const metaByMmsi = new Map();
  if (Array.isArray(vesselsMetaList)) {
    for (const item of vesselsMetaList) {
      if (item && item.mmsi) metaByMmsi.set(String(item.mmsi), item);
    }
  }

  const features = locationsGeoJson?.features;
  if (!Array.isArray(features)) return [];

  const result = [];
  for (const f of features) {
    const mmsi = String(f.mmsi || f.properties?.mmsi || '').trim();
    if (!mmsi) continue;
    const coords = f.geometry?.coordinates;
    if (!Array.isArray(coords)) continue;
    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!isValidLatLon(lat, lon)) continue;

    const p = f.properties || {};
    const m = metaByMmsi.get(mmsi) || {};
    const v = createEmptyVessel(mmsi, 'digitraffic');
    v.attribution = 'Source: Fintraffic / digitraffic.fi (CC BY 4.0)';
    v.lat = Number(lat.toFixed(5));
    v.lon = Number(lon.toFixed(5));
    v.trail = [[v.lat, v.lon]];

    if (Number.isFinite(Number(p.sog)) && Number(p.sog) < 102) v.sog = Number(Number(p.sog).toFixed(1));
    if (Number.isFinite(Number(p.cog)) && Number(p.cog) < 360) v.cog = Math.round(Number(p.cog));
    if (Number.isFinite(Number(p.heading)) && Number(p.heading) < 360) v.heading = Math.round(Number(p.heading));
    if (Number.isFinite(Number(p.rot)) && Math.abs(Number(p.rot)) < 127) v.rot = Number((Number(p.rot) / 10).toFixed(1));
    if (p.navStat !== undefined) {
      v.navStatusCode = Number(p.navStat);
      v.navStatus = NAV_STATUS_MAP[v.navStatusCode] || v.navStatus;
    }
    v.updatedAt = Number(p.timestampExternal) || Date.now();

    if (m.name && String(m.name).trim()) v.name = String(m.name).trim();
    if (m.imo && Number(m.imo) > 0) v.imo = String(m.imo);
    if (m.callSign && String(m.callSign).trim()) v.callsign = String(m.callSign).trim();
    if (m.destination && String(m.destination).trim()) v.destination = String(m.destination).trim();
    if (Number(m.draught) > 0) v.draught = Number((Number(m.draught) / 10).toFixed(1));
    if (Number(m.shipType) > 0) {
      v.aisTypeCode = Number(m.shipType);
      v.type = classifyAisShipType(v.aisTypeCode);
      v.aisTypeDesc = describeAisShipType(v.aisTypeCode);
    }
    const len = (Number(m.referencePointA) || 0) + (Number(m.referencePointB) || 0);
    const beam = (Number(m.referencePointC) || 0) + (Number(m.referencePointD) || 0);
    if (len > 0) v.length = len;
    if (beam > 0) v.beam = beam;

    result.push(v);
  }
  return result;
}

/**
 * Parse AISStream.io / Open Waters /v0/stream JSON message.
 */
export function parseAisStreamMessage(raw, existing = null) {
  if (!raw || typeof raw !== 'object') return null;

  const meta = raw.MetaData || raw.Metadata || {};
  const msgType = raw.MessageType;
  const payload = raw.Message || {};

  const mmsi = String(
    meta.MMSI ||
      payload.PositionReport?.UserID ||
      payload.StandardClassBPositionReport?.UserID ||
      payload.ExtendedClassBPositionReport?.UserID ||
      payload.ShipStaticData?.UserID ||
      ''
  ).trim();

  if (!mmsi) return null;

  const isClassB =
    msgType === 'StandardClassBPositionReport' ||
    msgType === 'ExtendedClassBPositionReport';

  const base = existing ? { ...existing } : createEmptyVessel(mmsi, 'aisstream');
  if (meta.ShipName && meta.ShipName.trim()) base.name = meta.ShipName.trim();

  if (
    msgType === 'PositionReport' ||
    msgType === 'StandardClassBPositionReport' ||
    msgType === 'ExtendedClassBPositionReport'
  ) {
    const report =
      payload.PositionReport ||
      payload.StandardClassBPositionReport ||
      payload.ExtendedClassBPositionReport ||
      {};

    const lat = Number(report.Latitude ?? meta.latitude);
    const lon = Number(report.Longitude ?? meta.longitude);
    if (!isValidLatLon(lat, lon)) return null;

    base.aisClass = isClassB ? 'Class B' : 'Class A';
    base.lat = Number(lat.toFixed(5));
    base.lon = Number(lon.toFixed(5));
    const rawSog = Number(report.Sog);
    if (Number.isFinite(rawSog) && rawSog >= 0 && rawSog < 102) base.sog = Number(rawSog.toFixed(1));
    const rawCog = Number(report.Cog);
    if (Number.isFinite(rawCog) && rawCog >= 0 && rawCog < 360) base.cog = Math.round(rawCog);
    const rawHdg = Number(report.TrueHeading);
    if (Number.isFinite(rawHdg) && rawHdg >= 0 && rawHdg < 360) base.heading = Math.round(rawHdg);
    const rawRot = Number(report.RateOfTurn);
    if (Number.isFinite(rawRot) && Math.abs(rawRot) < 127) base.rot = Number((rawRot / 10).toFixed(1));
    if (report.NavigationalStatus !== undefined) {
      base.navStatusCode = Number(report.NavigationalStatus);
      base.navStatus = NAV_STATUS_MAP[base.navStatusCode] || base.navStatus;
    }
    base.updatedAt = Date.now();
    base.trail = appendTrail(base.trail, base.lat, base.lon);
    return base;
  }

  if (msgType === 'ShipStaticData' && payload.ShipStaticData) {
    const st = payload.ShipStaticData;
    if (st.Name && st.Name.trim()) base.name = st.Name.trim();
    if (st.ImoNumber) base.imo = String(st.ImoNumber);
    if (st.CallSign && st.CallSign.trim()) base.callsign = st.CallSign.trim();
    if (st.Destination && st.Destination.trim()) base.destination = st.Destination.trim();
    if (Number.isFinite(Number(st.Type))) {
      base.aisTypeCode = Number(st.Type);
      base.type = classifyAisShipType(st.Type);
      base.aisTypeDesc = describeAisShipType(st.Type);
    }
    if (Number.isFinite(Number(st.MaximumStaticDraught))) {
      base.draught = Number(st.MaximumStaticDraught);
    }
    if (st.Dimension) {
      const a = Number(st.Dimension.A) || 0;
      const b = Number(st.Dimension.B) || 0;
      const c = Number(st.Dimension.C) || 0;
      const d = Number(st.Dimension.D) || 0;
      if (a + b > 0) { base.length = a + b; base.dimA = a; base.dimB = b; }
      if (c + d > 0) { base.beam = c + d; base.dimC = c; base.dimD = d; }
    }
    const etaStr = formatAisEtaObj(st.Eta);
    if (etaStr) base.eta = etaStr;
    base.updatedAt = Date.now();
    return base.lat !== null ? base : null;
  }

  return null;
}
