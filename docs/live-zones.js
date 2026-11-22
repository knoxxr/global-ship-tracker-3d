/**
 * 16 verified global real-time AIS maritime zones.
 * Each bounding box [minLat, minLon, maxLat, maxLon] is <= 100 sq degrees
 * so Open Waters AIS works globally with zero API key (20,000+ live vessels).
 */

export const LIVE_ZONES = [
  {
    id: 'korea-strait',
    label: '한반도·대한해협',
    center: { lat: 35.1, lon: 129.0, zoom: 3.4 },
    bbox: [32.0, 125.0, 38.0, 134.5], // 57 sq deg
  },
  {
    id: 'shanghai-taiwan',
    label: '상하이·대만·홍콩',
    center: { lat: 27.5, lon: 119.5, zoom: 3.0 },
    bbox: [22.0, 113.0, 32.0, 122.5], // 95 sq deg
  },
  {
    id: 'japan-tokyo',
    label: '일본·도쿄만',
    center: { lat: 34.8, lon: 138.0, zoom: 3.4 },
    bbox: [32.5, 134.0, 37.5, 142.0], // 40 sq deg
  },
  {
    id: 'singapore-malacca',
    label: '말라카·싱가포르',
    center: { lat: 2.2, lon: 103.5, zoom: 3.5 },
    bbox: [-0.5, 100.0, 5.5, 106.5], // 39 sq deg
  },
  {
    id: 'north-sea',
    label: '유럽·북해',
    center: { lat: 51.6, lon: 2.5, zoom: 3.2 },
    bbox: [49.0, -3.0, 54.0, 7.5], // 52.5 sq deg
  },
  {
    id: 'nordic-norway',
    label: '노르웨이',
    center: { lat: 60.0, lon: 8.5, zoom: 3.2 },
    bbox: [57.5, 4.0, 63.0, 13.0], // 49.5 sq deg
  },
  {
    id: 'baltic-finland',
    label: '발트해',
    center: { lat: 60.1, lon: 23.5, zoom: 3.3 },
    bbox: [58.0, 18.5, 62.5, 29.0], // 47.25 sq deg
  },
  {
    id: 'mediterranean',
    label: '지중해',
    center: { lat: 37.8, lon: 19.5, zoom: 3.0 },
    bbox: [35.0, 13.5, 41.0, 26.0], // 75 sq deg
  },
  {
    id: 'suez-redsea',
    label: '수에즈·홍해',
    center: { lat: 30.2, lon: 33.0, zoom: 3.5 },
    bbox: [27.0, 31.0, 33.5, 36.5], // 35.75 sq deg
  },
  {
    id: 'hormuz-dubai',
    label: '두바이·호르무즈',
    center: { lat: 25.2, lon: 55.5, zoom: 3.4 },
    bbox: [22.5, 51.5, 27.5, 59.5], // 40 sq deg
  },
  {
    id: 'us-east',
    label: '미동부·뉴욕',
    center: { lat: 40.8, lon: -72.5, zoom: 3.2 },
    bbox: [38.0, -76.0, 43.5, -69.0], // 38.5 sq deg
  },
  {
    id: 'us-west',
    label: '미서부·LA',
    center: { lat: 34.8, lon: -120.2, zoom: 3.2 },
    bbox: [32.0, -124.0, 38.5, -117.0], // 45.5 sq deg
  },
  {
    id: 'panama',
    label: '파나마 운하',
    center: { lat: 9.0, lon: -79.6, zoom: 3.8 },
    bbox: [6.5, -82.5, 11.5, -77.0], // 27.5 sq deg
  },
  {
    id: 'santos-br',
    label: '브라질·산토스',
    center: { lat: -23.5, lon: -45.0, zoom: 3.2 },
    bbox: [-26.0, -49.0, -21.0, -41.0], // 40 sq deg
  },
  {
    id: 'capetown-za',
    label: '케이프타운',
    center: { lat: -33.9, lon: 18.5, zoom: 3.4 },
    bbox: [-36.0, 16.0, -31.5, 22.0], // 27 sq deg
  },
  {
    id: 'sydney-au',
    label: '호주·시드니',
    center: { lat: -33.5, lon: 151.5, zoom: 3.3 },
    bbox: [-36.5, 149.0, -30.0, 155.0], // 39 sq deg
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
