/**
 * Normalizes raw AISStream.io WebSocket messages into unified Vessel objects.
 * Supports MessageTypes:
 *  - PositionReport (Class A)
 *  - StandardClassBPositionReport (Class B)
 *  - ExtendedClassBPositionReport (Class B Extended)
 *  - ShipStaticData (Message Type 5)
 *  - StaticDataReport (Message Type 24)
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
  '226': { code: 'FR', name: '프랑스' },
  '227': { code: 'FR', name: '프랑스' },
  '228': { code: 'FR', name: '프랑스' },
  '229': { code: 'MT', name: '몰타' },
  '230': { code: 'FI', name: '핀란드' },
  '232': { code: 'GB', name: '영국' },
  '233': { code: 'GB', name: '영국' },
  '234': { code: 'GB', name: '영국' },
  '235': { code: 'GB', name: '영국' },
  '237': { code: 'GR', name: '그리스' },
  '239': { code: 'GR', name: '그리스' },
  '240': { code: 'GR', name: '그리스' },
  '244': { code: 'NL', name: '네덜란드' },
  '245': { code: 'NL', name: '네덜란드' },
  '246': { code: 'NL', name: '네덜란드' },
  '247': { code: 'IT', name: '이탈리아' },
  '248': { code: 'MT', name: '몰타' },
  '249': { code: 'MT', name: '몰타' },
  '255': { code: 'PT', name: '포르투갈' },
  '256': { code: 'MT', name: '몰타' },
  '257': { code: 'NO', name: '노르웨이' },
  '258': { code: 'NO', name: '노르웨이' },
  '259': { code: 'NO', name: '노르웨이' },
  '265': { code: 'SE', name: '스웨덴' },
  '266': { code: 'SE', name: '스웨덴' },
  '271': { code: 'TR', name: '튀르키예' },
  '273': { code: 'RU', name: '러시아' },
  '303': { code: 'US', name: '미국' },
  '308': { code: 'BS', name: '바하마' },
  '309': { code: 'BS', name: '바하마' },
  '311': { code: 'BS', name: '바하마' },
  '316': { code: 'CA', name: '캐나다' },
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
  5: '계류 중',
  6: '좌초',
  7: '어로 작업 중',
  8: '범주 항해 중',
  15: '미지정',
};

/**
 * Derive flag info from 9-digit MMSI (first 3 digits = Maritime Identification Digits).
 */
export function flagFromMmsi(mmsi) {
  const s = String(mmsi || '').padStart(9, '0');
  const mid = s.slice(0, 3);
  return MID_FLAGS[mid] || { code: 'INT', name: '국제선' };
}

/**
 * Map numeric AIS ship & cargo type code (0..99) to UI vessel category.
 */
export function classifyAisShipType(typeCode) {
  const code = Number(typeCode);
  if (!Number.isFinite(code)) return 'bulk';
  if (code >= 80 && code <= 89) return 'tanker';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code === 30) return 'fishing';
  if (code >= 71 && code <= 74) return 'container';
  if (code >= 70 && code <= 79) return 'bulk';
  if ((code >= 31 && code <= 59) || code >= 90) return 'special';
  return 'bulk';
}

/**
 * Parse an incoming AISStream.io JSON message and merge into an existing vessel record.
 * Returns updated vessel patch or null if invalid coordinates/message.
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

  const flag = flagFromMmsi(mmsi);
  const now = Date.now();
  const base = existing
    ? { ...existing }
    : {
        mmsi,
        imo: '',
        name: (meta.ShipName || `VESSEL ${mmsi}`).trim(),
        callsign: '',
        flagCode: flag.code,
        flagName: flag.name,
        type: 'bulk',
        aisTypeCode: 70,
        lat: null,
        lon: null,
        sog: 0,
        cog: 0,
        heading: 0,
        navStatus: '항해 중 (엔진)',
        draught: null,
        length: null,
        beam: null,
        origin: 'LIVE AIS',
        destination: '미지정',
        eta: '-',
        source: 'aisstream',
        updatedAt: now,
        trail: [],
      };

  if (meta.ShipName && meta.ShipName.trim()) {
    base.name = meta.ShipName.trim();
  }

  // Position messages
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

    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -90 ||
      lat > 90 ||
      lon < -180 ||
      lon > 180 ||
      (Math.abs(lat) > 89.9 && Math.abs(lon) > 179.9)
    ) {
      return null;
    }

    const sog = Number.isFinite(Number(report.Sog))
      ? Math.min(60, Math.max(0, Number(report.Sog)))
      : base.sog;
    const cog = Number.isFinite(Number(report.Cog))
      ? ((Number(report.Cog) % 360) + 360) % 360
      : base.cog;
    const rawHdg = Number(report.TrueHeading);
    const heading =
      Number.isFinite(rawHdg) && rawHdg >= 0 && rawHdg < 360 ? rawHdg : cog;

    base.lat = lat;
    base.lon = lon;
    base.sog = Number(sog.toFixed(1));
    base.cog = Math.round(cog);
    base.heading = Math.round(heading);
    if (report.NavigationalStatus !== undefined) {
      base.navStatus = NAV_STATUS_MAP[report.NavigationalStatus] || base.navStatus;
    }
    base.updatedAt = now;

    // Append to wake trail if moved noticeably
    const prev = base.trail[base.trail.length - 1];
    if (!prev || Math.abs(prev[0] - lat) + Math.abs(prev[1] - lon) > 0.02) {
      base.trail = [...base.trail.slice(-17), [lat, lon]];
    }
    return base;
  }

  // Static vessel metadata messages
  if (msgType === 'ShipStaticData' && payload.ShipStaticData) {
    const st = payload.ShipStaticData;
    if (st.Name && st.Name.trim()) base.name = st.Name.trim();
    if (st.ImoNumber) base.imo = String(st.ImoNumber);
    if (st.CallSign && st.CallSign.trim()) base.callsign = st.CallSign.trim();
    if (st.Destination && st.Destination.trim()) {
      base.destination = st.Destination.trim();
    }
    if (Number.isFinite(Number(st.Type))) {
      base.aisTypeCode = Number(st.Type);
      base.type = classifyAisShipType(st.Type);
    }
    if (Number.isFinite(Number(st.MaximumStaticDraught))) {
      base.draught = Number(st.MaximumStaticDraught);
    }
    if (st.Dimension) {
      const len = (st.Dimension.A || 0) + (st.Dimension.B || 0);
      const beam = (st.Dimension.C || 0) + (st.Dimension.D || 0);
      if (len > 0) base.length = len;
      if (beam > 0) base.beam = beam;
    }
    if (st.Eta && st.Eta.Month && st.Eta.Day) {
      const m = String(st.Eta.Month).padStart(2, '0');
      const d = String(st.Eta.Day).padStart(2, '0');
      const h = String(st.Eta.Hour ?? 0).padStart(2, '0');
      const min = String(st.Eta.Minute ?? 0).padStart(2, '0');
      base.eta = `${m}-${d} ${h}:${min} UTC`;
    }
    base.updatedAt = now;
    return base.lat !== null ? base : null;
  }

  return null;
}
