/**
 * Global real-time AIS coverage zones.
 * Each bounding box [minLat, minLon, maxLat, maxLon] is sized <= 90 sq degrees
 * so anonymous Open Waters AIS subscriptions (100 sq deg cap) work with zero API key.
 */

export const LIVE_ZONES = [
  {
    id: 'korea-strait',
    label: '한반도·대한해협',
    center: { lat: 35.1, lon: 129.0, zoom: 3.4 },
    bbox: [32.0, 125.0, 38.0, 134.5], // 57 sq deg
  },
  {
    id: 'singapore-malacca',
    label: '말라카·싱가포르',
    center: { lat: 2.2, lon: 103.5, zoom: 3.5 },
    bbox: [-0.5, 100.0, 5.5, 106.5], // 39 sq deg
  },
  {
    id: 'north-sea',
    label: '유럽·로테르담/영국해협',
    center: { lat: 51.6, lon: 2.5, zoom: 3.3 },
    bbox: [49.0, -3.0, 54.0, 7.5], // 52.5 sq deg
  },
  {
    id: 'nordic-norway',
    label: '북유럽·노르웨이/북해',
    center: { lat: 60.0, lon: 8.5, zoom: 3.2 },
    bbox: [57.5, 4.0, 63.0, 13.0], // 49.5 sq deg
  },
  {
    id: 'baltic-finland',
    label: '발트해·핀란드만',
    center: { lat: 60.1, lon: 23.5, zoom: 3.4 },
    bbox: [58.0, 18.5, 62.5, 29.0], // 47.25 sq deg
  },
  {
    id: 'mediterranean',
    label: '지중해·그리스/이탈리아',
    center: { lat: 37.8, lon: 19.5, zoom: 3.1 },
    bbox: [35.0, 13.5, 41.0, 26.0], // 75 sq deg
  },
  {
    id: 'us-east',
    label: '미동부·뉴욕/보스턴',
    center: { lat: 40.8, lon: -72.5, zoom: 3.3 },
    bbox: [38.0, -76.0, 43.5, -69.0], // 38.5 sq deg
  },
  {
    id: 'us-west',
    label: '미서부·LA/샌프란시스코',
    center: { lat: 34.8, lon: -120.2, zoom: 3.3 },
    bbox: [32.0, -124.0, 38.5, -117.0], // 45.5 sq deg
  },
  {
    id: 'japan-tokyo',
    label: '일본·도쿄만/세토내해',
    center: { lat: 34.8, lon: 138.0, zoom: 3.4 },
    bbox: [32.5, 134.0, 37.5, 142.0], // 40 sq deg
  },
];

/**
 * Clamp a custom [minLat, minLon, maxLat, maxLon] bounding box around a center
 * so its total area does not exceed `maxAreaDeg2` (default 90 sq degrees).
 */
export function buildBboxAround(lat, lon, maxAreaDeg2 = 90) {
  const halfSpan = Math.min(8, Math.sqrt(maxAreaDeg2) / 2);
  const minLat = Math.max(-85, Number((lat - halfSpan).toFixed(2)));
  const maxLat = Math.min(85, Number((lat + halfSpan).toFixed(2)));
  const minLon = Math.max(-180, Number((lon - halfSpan).toFixed(2)));
  const maxLon = Math.min(180, Number((lon + halfSpan).toFixed(2)));
  return [minLat, minLon, maxLat, maxLon];
}
