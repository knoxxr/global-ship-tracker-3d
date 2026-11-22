/**
 * High-resolution world map metadata: imports Natural Earth 50m coastlines,
 * 110m country borders, and major lakes from ./world-geo.js, and provides
 * 38 world ports, 22 sea/strait labels, shipping corridors, and vessel type styles.
 */

export { WORLD_POLYGONS, COUNTRY_BORDERS, WORLD_LAKES } from './world-geo.js';

export const VESSEL_TYPES = {
  container: { label: '컨테이너선', short: '컨테이너', color: '#10b981' },
  tanker:    { label: '유조선/LNG', short: '유조선',   color: '#ef4444' },
  bulk:      { label: '벌크/화물선', short: '벌크선',  color: '#38bdf8' },
  passenger: { label: '여객/크루즈', short: '여객선',  color: '#f59e0b' },
  fishing:   { label: '어선',       short: '어선',     color: '#fb923c' },
  special:   { label: '특수/조사선', short: '특수선',  color: '#94a3b8' },
};

export const PORTS_DATA = [
  // Korea
  { code: 'KRPUS', name: '부산', lat: 35.10, lon: 129.04, major: true },
  { code: 'KRINC', name: '인천', lat: 37.45, lon: 126.60, major: false },
  { code: 'KRUSN', name: '울산', lat: 35.50, lon: 129.38, major: false },
  { code: 'KRKAN', name: '광양', lat: 34.91, lon: 127.69, major: false },
  { code: 'KRPTK', name: '평택', lat: 36.96, lon: 126.82, major: false },
  { code: 'KRKPO', name: '포항', lat: 36.04, lon: 129.41, major: false },
  { code: 'KRCHA', name: '제주', lat: 33.52, lon: 126.54, major: false },
  // East & Southeast Asia
  { code: 'CNSHA', name: '상하이', lat: 31.23, lon: 121.47, major: true },
  { code: 'CNNGB', name: '닝보', lat: 29.87, lon: 121.85, major: false },
  { code: 'CNTAO', name: '칭다오', lat: 36.07, lon: 120.32, major: false },
  { code: 'HKHKG', name: '홍콩', lat: 22.30, lon: 114.17, major: true },
  { code: 'TWKHH', name: '가오슝', lat: 22.61, lon: 120.28, major: false },
  { code: 'JPYOK', name: '도쿄·요코하마', lat: 35.44, lon: 139.64, major: true },
  { code: 'JPOSA', name: '오사카·고베', lat: 34.65, lon: 135.42, major: false },
  { code: 'SGSIN', name: '싱가포르', lat: 1.26, lon: 103.82, major: true },
  { code: 'MYPKG', name: '포트클랑', lat: 3.00, lon: 101.39, major: false },
  { code: 'LKCMB', name: '콜롬보', lat: 6.95, lon: 79.85, major: false },
  // Middle East & Africa
  { code: 'AEJEA', name: '두바이', lat: 25.01, lon: 55.06, major: true },
  { code: 'EGPSD', name: '수에즈', lat: 31.26, lon: 32.31, major: true },
  { code: 'ZACPT', name: '케이프타운', lat: -33.91, lon: 18.43, major: true },
  // Europe
  { code: 'NLRTM', name: '로테르담', lat: 51.95, lon: 4.13, major: true },
  { code: 'BEANR', name: '앤트워프', lat: 51.26, lon: 4.38, major: false },
  { code: 'DEHAM', name: '함부르크', lat: 53.54, lon: 9.97, major: false },
  { code: 'GBSOU', name: '사우샘프턴', lat: 50.89, lon: -1.40, major: false },
  { code: 'NOOSL', name: '오슬로', lat: 59.90, lon: 10.74, major: false },
  { code: 'FIHEL', name: '헬싱키', lat: 60.16, lon: 24.95, major: false },
  { code: 'SESTO', name: '스톡홀름', lat: 59.33, lon: 18.10, major: false },
  { code: 'GRPIR', name: '피레우스', lat: 37.94, lon: 23.64, major: true },
  { code: 'ESALG', name: '지브롤터', lat: 36.13, lon: -5.36, major: false },
  { code: 'FRMRS', name: '마르세유', lat: 43.33, lon: 5.34, major: false },
  // Americas & Oceania
  { code: 'USLAX', name: 'LA·롱비치', lat: 33.74, lon: -118.27, major: true },
  { code: 'USSFO', name: '샌프란시스코', lat: 37.80, lon: -122.40, major: false },
  { code: 'USNYC', name: '뉴욕', lat: 40.67, lon: -74.04, major: true },
  { code: 'USHOU', name: '휴스턴', lat: 29.73, lon: -95.27, major: false },
  { code: 'PAPTY', name: '파나마', lat: 8.95, lon: -79.56, major: true },
  { code: 'BRSSZ', name: '산토스', lat: -23.96, lon: -46.30, major: true },
  { code: 'AUSYD', name: '시드니', lat: -33.85, lon: 151.21, major: true },
  { code: 'AUMEL', name: '멜버른', lat: -37.84, lon: 144.92, major: false },
];

export const SEA_LABELS = [
  { name: '북태평양', lat: 30, lon: -165, minZoom: 0.8, maxZoom: 2.4 },
  { name: '남태평양', lat: -25, lon: -135, minZoom: 0.8, maxZoom: 2.4 },
  { name: '북대서양', lat: 32, lon: -42, minZoom: 0.8, maxZoom: 2.4 },
  { name: '남대서양', lat: -22, lon: -16, minZoom: 0.8, maxZoom: 2.4 },
  { name: '인도양', lat: -15, lon: 78, minZoom: 0.8, maxZoom: 2.4 },
  { name: '동해 (East Sea)', lat: 38.2, lon: 133.2, minZoom: 2.0, maxZoom: 18 },
  { name: '황해 (Yellow Sea)', lat: 35.4, lon: 123.6, minZoom: 2.2, maxZoom: 18 },
  { name: '대한해협', lat: 34.4, lon: 129.3, minZoom: 3.4, maxZoom: 18 },
  { name: '동중국해', lat: 28.5, lon: 125.0, minZoom: 2.0, maxZoom: 18 },
  { name: '남중국해', lat: 14.5, lon: 113.5, minZoom: 1.6, maxZoom: 18 },
  { name: '말라카 해협', lat: 3.2, lon: 100.3, minZoom: 2.6, maxZoom: 18 },
  { name: '페르시아만', lat: 26.8, lon: 51.8, minZoom: 2.4, maxZoom: 18 },
  { name: '호르무즈 해협', lat: 26.5, lon: 56.4, minZoom: 3.2, maxZoom: 18 },
  { name: '홍해', lat: 20.5, lon: 38.5, minZoom: 2.0, maxZoom: 18 },
  { name: '지중해', lat: 35.8, lon: 18.0, minZoom: 1.8, maxZoom: 18 },
  { name: '북해 (North Sea)', lat: 55.8, lon: 3.2, minZoom: 2.0, maxZoom: 18 },
  { name: '도버 해협', lat: 51.0, lon: 1.5, minZoom: 3.8, maxZoom: 18 },
  { name: '발트해', lat: 58.2, lon: 20.2, minZoom: 2.2, maxZoom: 18 },
  { name: '카리브해', lat: 15.5, lon: -74.5, minZoom: 1.8, maxZoom: 18 },
  { name: '멕시코만', lat: 25.0, lon: -90.0, minZoom: 1.8, maxZoom: 18 },
];

export const CORRIDOR_LINES = [
  [[35.0, 129.1], [33.5, 134.5], [34.8, 141.5], [39.5, 155.0], [43.0, 172.0], [43.5, -170.0], [41.5, -150.0], [37.5, -132.0], [33.7, -118.3]],
  [[31.1, 122.2], [25.5, 121.0], [20.5, 115.0], [11.0, 110.5], [2.0, 104.8], [1.2, 103.6], [4.5, 99.2], [6.2, 94.0], [5.8, 80.2], [9.5, 67.0], [12.3, 52.0], [12.7, 43.3], [21.0, 38.2], [29.8, 32.5], [31.5, 32.3], [35.2, 23.0], [36.8, 13.5], [36.0, -5.5], [37.0, -9.5], [43.5, -9.8], [49.5, -4.5], [51.1, 1.5], [52.0, 4.0]],
  [[52.0, 4.0], [50.8, 1.2], [49.4, -5.5], [48.5, -18.0], [46.5, -35.0], [43.5, -52.0], [41.2, -66.0], [40.5, -73.9]],
  [[34.9, 129.2], [32.0, 138.0], [28.0, 158.0], [23.0, 178.0], [18.5, -158.0], [14.0, -130.0], [10.5, -102.0], [8.5, -80.2], [9.4, -79.9], [16.5, -78.0], [22.5, -74.5], [29.5, -76.5], [36.5, -74.0], [40.5, -73.9]],
  [[25.2, 55.1], [26.4, 56.4], [24.0, 59.5], [16.0, 67.0], [7.0, 77.5], [5.8, 81.2], [5.9, 95.0], [2.5, 101.8], [1.3, 104.2], [10.0, 111.0], [21.5, 117.0], [28.5, 124.0], [34.9, 129.1]],
  [[51.9, 3.8], [49.4, -5.2], [43.0, -10.5], [32.0, -14.0], [16.0, -19.5], [0.0, -11.0], [-18.0, 4.0], [-34.5, 18.0], [-35.5, 22.0], [-29.0, 40.0], [-18.0, 62.0], [-6.0, 86.0], [1.2, 103.5]],
  [[-24.2, -46.2], [-18.0, -37.5], [-6.0, -33.5], [8.0, -27.5], [22.0, -21.0], [36.0, -12.5], [44.0, -9.8], [49.5, -4.5], [51.9, 3.8]],
  [[-33.8, 151.6], [-26.0, 154.5], [-16.0, 153.5], [-6.0, 152.0], [4.0, 148.0], [16.0, 144.0], [27.5, 141.0], [35.2, 139.8]],
];
