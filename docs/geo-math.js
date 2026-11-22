/**
 * Spherical geometry and nautical kinematics utilities for global AIS tracking.
 * Uses WGS84 mean Earth radius and great-circle math for accurate vessel routing.
 */

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;
export const EARTH_RADIUS_NM = 3440.065; // Earth radius in nautical miles
export const EARTH_RADIUS_KM = 6371.0088;

/**
 * Normalize longitude to [-180, 180].
 */
export function normalizeLon(lon) {
  let l = ((lon + 180) % 360 + 360) % 360 - 180;
  return l === -180 ? 180 : l;
}

/**
 * Clamp latitude to [-90, 90].
 */
export function clampLat(lat) {
  return Math.max(-90, Math.min(90, lat));
}

/**
 * Compute great-circle distance between two (lat, lon) points in nautical miles.
 */
export function haversineNm(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * DEG2RAD;
  const phi2 = lat2 * DEG2RAD;
  const dPhi = (lat2 - lat1) * DEG2RAD;
  const dLambda = (lon2 - lon1) * DEG2RAD;

  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
  return EARTH_RADIUS_NM * c;
}

/**
 * Compute initial true bearing (Course Over Ground in degrees 0..360)
 * from (lat1, lon1) to (lat2, lon2).
 */
export function initialBearing(lat1, lon1, lat2, lon2) {
  const phi1 = lat1 * DEG2RAD;
  const phi2 = lat2 * DEG2RAD;
  const dLambda = (lon2 - lon1) * DEG2RAD;

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  const theta = Math.atan2(y, x);
  return (theta * RAD2DEG + 360) % 360;
}

/**
 * Spherical linear interpolation (SLERP) between two geographic coordinates.
 * @param {number} lat1
 * @param {number} lon1
 * @param {number} lat2
 * @param {number} lon2
 * @param {number} t Interpolation factor in [0, 1]
 * @returns {{lat: number, lon: number}}
 */
export function slerpLatLon(lat1, lon1, lat2, lon2, t) {
  if (t <= 0) return { lat: lat1, lon: lon1 };
  if (t >= 1) return { lat: lat2, lon: lon2 };

  const phi1 = lat1 * DEG2RAD;
  const lam1 = lon1 * DEG2RAD;
  const phi2 = lat2 * DEG2RAD;
  const lam2 = lon2 * DEG2RAD;

  const x1 = Math.cos(phi1) * Math.cos(lam1);
  const y1 = Math.cos(phi1) * Math.sin(lam1);
  const z1 = Math.sin(phi1);

  const x2 = Math.cos(phi2) * Math.cos(lam2);
  const y2 = Math.cos(phi2) * Math.sin(lam2);
  const z2 = Math.sin(phi2);

  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2));
  const omega = Math.acos(dot);

  if (omega < 1e-6) {
    return {
      lat: lat1 + (lat2 - lat1) * t,
      lon: normalizeLon(lon1 + (lon2 - lon1) * t),
    };
  }

  const sinOmega = Math.sin(omega);
  const w1 = Math.sin((1 - t) * omega) / sinOmega;
  const w2 = Math.sin(t * omega) / sinOmega;

  const x = w1 * x1 + w2 * x2;
  const y = w1 * y1 + w2 * y2;
  const z = w1 * z1 + w2 * z2;

  const lat = Math.atan2(z, Math.sqrt(x * x + y * y)) * RAD2DEG;
  const lon = Math.atan2(y, x) * RAD2DEG;
  return { lat: clampLat(lat), lon: normalizeLon(lon) };
}

/**
 * Compute approximate subsolar point (lat, lon) for a given Date
 * to render realistic day/night lighting on the 3D Earth.
 */
export function getSubsolarPoint(date = new Date()) {
  const startOfYear = Date.UTC(date.getUTCFullYear(), 0, 1);
  const dayOfYear = (date.getTime() - startOfYear) / 86400000;
  // Approximate solar declination in degrees
  const declination = -23.44 * Math.cos(((2 * Math.PI) / 365.25) * (dayOfYear + 10));
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  const subsolarLon = normalizeLon((12 - utcHours) * 15);
  return { lat: declination, lon: subsolarLon };
}

/**
 * Format latitude/longitude in classic nautical degrees/minutes notation.
 */
export function formatCoord(value, isLat) {
  const hemi = isLat ? (value >= 0 ? 'N' : 'S') : (value >= 0 ? 'E' : 'W');
  const abs = Math.abs(value);
  const deg = Math.floor(abs);
  const min = ((abs - deg) * 60).toFixed(2);
  return `${deg}°${min.padStart(5, '0')}'${hemi}`;
}
