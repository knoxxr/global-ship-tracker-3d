/**
 * NOAA / WMO Voluntary Observing Ships (VOS) real-time open-ocean ship report parser.
 * Parses the official NOAA NDBC ship observation feed (https://www.ndbc.noaa.gov/ship_obs.php?uom=M&time=6)
 * into clean, deduplicated open-ocean vessel positions with ship-measured meteorological telemetry.
 *
 * 100% real data — no simulated or interpolated vessels.
 * Note: Per WMO/NOAA security policy, ship callsigns are anonymized as "SHIP" and coordinates
 * are reported at 0.1° (~11 km) resolution.
 */

export const NDBC_VOS_BASE_URL = 'https://www.ndbc.noaa.gov/ship_obs.php';

function parseOptionalNum(token) {
  if (!token || token === '-' || token === 'MM' || token === '----' || token === '-----') {
    return null;
  }
  const n = Number(token);
  return Number.isFinite(n) ? n : null;
}

/**
 * Extracts the window end timestamp from the NDBC header, e.g.:
 * "2409 observations from 11/26/2026 0400 GMT to 11/26/2026 1027 GMT"
 */
function parseHeaderWindowEndMs(html, fallbackMs) {
  const m = html.match(
    /to\s+(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2})(\d{2})\s+GMT/i
  );
  if (!m) return fallbackMs;
  const [, mo, da, yr, hh, mm] = m;
  const ts = Date.UTC(Number(yr), Number(mo) - 1, Number(da), Number(hh), Number(mm), 0);
  return Number.isFinite(ts) ? ts : fallbackMs;
}

/**
 * Resolves a 2-digit GMT observation hour ("00"–"23") relative to the feed window end timestamp.
 */
function resolveObservedAtMs(hourUtc, refMs) {
  const ref = new Date(refMs);
  const candidate = Date.UTC(
    ref.getUTCFullYear(),
    ref.getUTCMonth(),
    ref.getUTCDate(),
    hourUtc,
    0,
    0
  );
  // If candidate hour is ahead of reference time by > 1 hour, it occurred on the previous UTC day.
  if (candidate - refMs > 60 * 60 * 1000) {
    return candidate - 24 * 60 * 60 * 1000;
  }
  return candidate;
}

function metricScore(ship) {
  let s = 0;
  if (ship.windMs !== null) s += 2;
  if (ship.waveM !== null) s += 3;
  if (ship.presHpa !== null) s += 2;
  if (ship.seaTempC !== null) s += 2;
  if (ship.airTempC !== null) s += 1;
  return s;
}

/**
 * Parses NOAA NDBC ship_obs.php HTML (metric units, uom=M) into deduplicated real VOS ships.
 */
export function parseNdBcShipObsHtml(html, nowMs = Date.now(), windowHours = 6) {
  if (!html || typeof html !== 'string') {
    return {
      updatedAt: nowMs,
      source: 'NOAA/WMO VOS',
      windowHours,
      totalObservations: 0,
      count: 0,
      ships: [],
    };
  }

  const refEndMs = parseHeaderWindowEndMs(html, nowMs);
  const byPos = new Map();
  let totalObservations = 0;

  // Columns in uom=M table:
  // 0:ID 1:HOUR 2:LAT 3:LON 4:WDIR 5:WSPD(m/s) 6:GST(m/s) 7:WVHT(m) 8:DPD(s)
  // 9:PRES(mb) 10:PTDY 11:ATMP(C) 12:WTMP(C) 13:DEWP(C) 14:VIS(km) ...
  const lines = html.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (!raw.includes('<span>')) continue;
    const cleaned = raw.replace(/<[^>]+>/g, '').trim();
    if (!cleaned || cleaned.startsWith('SHIP ID') || cleaned.startsWith('---')) continue;

    const cols = cleaned.split(/\s+/);
    if (cols.length < 13) continue;

    const callsign = cols[0];
    if (!/^[A-Z0-9]{3,10}$/i.test(callsign)) continue;
    const hourUtc = Number(cols[1]);
    const lat = Number(cols[2]);
    const lon = Number(cols[3]);

    if (
      !Number.isInteger(hourUtc) ||
      hourUtc < 0 ||
      hourUtc > 23 ||
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      lat < -85 ||
      lat > 85 ||
      lon < -180 ||
      lon > 180 ||
      (lat === 0 && lon === 0)
    ) {
      continue;
    }

    totalObservations++;

    const windDir = parseOptionalNum(cols[4]);
    const windMs = parseOptionalNum(cols[5]);
    const gustMs = parseOptionalNum(cols[6]);
    const waveM = parseOptionalNum(cols[7]);
    const waveSec = parseOptionalNum(cols[8]);
    const presHpa = parseOptionalNum(cols[9]);
    const airTempC = parseOptionalNum(cols[11]);
    const seaTempC = parseOptionalNum(cols[12]);
    const visKm = cols.length > 14 ? parseOptionalNum(cols[14]) : null;
    const observedAt = resolveObservedAtMs(hourUtc, refEndMs);

    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const ship = {
      id: `vos_${lat.toFixed(1)}_${lon.toFixed(1)}`,
      callsign,
      lat: Math.round(lat * 10) / 10,
      lon: Math.round(lon * 10) / 10,
      hourUtc,
      observedAt,
      windDir: windDir !== null ? Math.round(windDir) : null,
      windMs: windMs !== null ? Math.round(windMs * 10) / 10 : null,
      windKn: windMs !== null ? Math.round(windMs * 1.94384 * 10) / 10 : null,
      gustMs: gustMs !== null ? Math.round(gustMs * 10) / 10 : null,
      waveM: waveM !== null ? Math.round(waveM * 10) / 10 : null,
      waveSec: waveSec !== null ? Math.round(waveSec * 10) / 10 : null,
      presHpa: presHpa !== null ? Math.round(presHpa * 10) / 10 : null,
      airTempC: airTempC !== null ? Math.round(airTempC * 10) / 10 : null,
      seaTempC: seaTempC !== null ? Math.round(seaTempC * 10) / 10 : null,
      visKm: visKm !== null ? Math.round(visKm * 10) / 10 : null,
      source: 'NOAA/WMO VOS',
    };

    const prev = byPos.get(key);
    if (
      !prev ||
      ship.observedAt > prev.observedAt ||
      (ship.observedAt === prev.observedAt && metricScore(ship) > metricScore(prev))
    ) {
      byPos.set(key, ship);
    }
  }

  const ships = Array.from(byPos.values()).sort((a, b) => b.observedAt - a.observedAt);
  return {
    updatedAt: refEndMs,
    source: 'NOAA/WMO VOS',
    windowHours,
    totalObservations,
    count: ships.length,
    ships,
  };
}

/**
 * Fetches live NOAA NDBC VOS ship weather reports (free, keyless, official US NWS/WMO feed).
 */
export async function fetchLiveVosShips(hours = 6, fetchImpl = fetch) {
  const safeHours = Math.max(1, Math.min(24, Math.round(Number(hours) || 6)));
  const url = `${NDBC_VOS_BASE_URL}?uom=M&time=${safeHours}`;
  const res = await fetchImpl(url, {
    headers: {
      'User-Agent': 'MarineGlobe3D/1.0 (https://github.com/knoxxr/global-ship-tracker-3d)',
      Accept: 'text/html,text/plain;q=0.9,*/*;q=0.8',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    throw new Error(`NOAA NDBC VOS HTTP ${res.status}`);
  }
  const html = await res.text();
  return parseNdBcShipObsHtml(html, Date.now(), safeHours);
}
