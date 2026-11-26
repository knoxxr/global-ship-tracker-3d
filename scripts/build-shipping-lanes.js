/**
 * Generates src/public/shipping-lanes.js from the CC BY 4.0 Global Shipping Lanes dataset
 * (Benden, P., 2022, Zenodo https://doi.org/10.5281/zenodo.6361763).
 *
 * Applies antimeridian splitting + Douglas-Peucker simplification so the bundled ESM file
 * stays compact (~40–70 KB) while preserving crisp Major / Middle / Minor ocean corridors.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL =
  'https://raw.githubusercontent.com/newzealandpaul/Shipping-Lanes/main/data/Shipping_Lanes_v1.geojson';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'src/public/shipping-lanes.js');

function perpDistSq(p, a, b) {
  let x = a[0];
  let y = a[1];
  const dx = b[0] - x;
  const dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    let t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = b[0];
      y = b[1];
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  const ex = p[0] - x;
  const ey = p[1] - y;
  return ex * ex + ey * ey;
}

function simplifyDP(points, tol) {
  if (points.length <= 2) return points;
  const tolSq = tol * tol;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [first, last] = stack.pop();
    let maxDist = 0;
    let idx = -1;
    for (let i = first + 1; i < last; i++) {
      const d = perpDistSq(points[i], points[first], points[last]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > tolSq && idx !== -1) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }

  const out = [];
  for (let i = 0; i < points.length; i++) {
    if (keep[i]) out.push(points[i]);
  }
  return out;
}

function splitAntimeridian(line) {
  const segs = [];
  let cur = [];
  for (let i = 0; i < line.length; i++) {
    const [lon, lat] = line[i];
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (cur.length > 0 && Math.abs(lon - cur[cur.length - 1][0]) > 180) {
      if (cur.length >= 2) segs.push(cur);
      cur = [[lon, lat]];
    } else {
      cur.push([lon, lat]);
    }
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}

function roundCoord(v) {
  return Math.round(v * 100) / 100;
}

const res = await fetch(SOURCE_URL, { signal: AbortSignal.timeout(20000) });
if (!res.ok) throw new Error(`HTTP ${res.status} downloading Shipping Lanes GeoJSON`);
const gj = await res.json();

const TOLS = { major: 0.08, middle: 0.14, minor: 0.22 };
const result = { major: [], middle: [], minor: [] };
let rawCount = 0;
let keptCount = 0;

for (const feat of gj.features || []) {
  const tier = String(feat.properties?.Type || '').toLowerCase();
  if (!(tier in result)) continue;
  const tol = TOLS[tier];
  const lines =
    feat.geometry?.type === 'MultiLineString'
      ? feat.geometry.coordinates
      : feat.geometry?.type === 'LineString'
        ? [feat.geometry.coordinates]
        : [];

  for (const rawLine of lines) {
    rawCount += rawLine.length;
    for (const seg of splitAntimeridian(rawLine)) {
      const simp = simplifyDP(seg, tol);
      if (simp.length < 2) continue;
      const flat = [];
      for (let i = 0; i < simp.length; i++) {
        const lon = roundCoord(simp[i][0]);
        const lat = roundCoord(simp[i][1]);
        if (flat.length >= 2 && flat[flat.length - 2] === lon && flat[flat.length - 1] === lat) continue;
        flat.push(lon, lat);
      }
      if (flat.length >= 4) {
        result[tier].push(flat);
        keptCount += flat.length / 2;
      }
    }
  }
}

const code = `/**
 * Global Commercial Shipping Lanes (Major / Middle / Minor maritime trade corridors).
 * Source: Benden, P. (2022) Global Shipping Lanes [Dataset], Zenodo (doi:10.5281/zenodo.6361763), CC BY 4.0.
 * Simplified with antimeridian splitting for 60 FPS 3D globe rendering.
 * Each polyline is encoded as a flat [lon0, lat0, lon1, lat1, ...] array (degrees).
 */
export const SHIPPING_LANES_META = {
  attribution: 'Global Shipping Lanes (Benden, 2022 · Zenodo · CC BY 4.0)',
  majorCount: ${result.major.length},
  middleCount: ${result.middle.length},
  minorCount: ${result.minor.length},
};

export const SHIPPING_LANES = ${JSON.stringify(result)};
`;

await fs.writeFile(outFile, code, 'utf8');
const stat = await fs.stat(outFile);
console.log(
  `[build-shipping-lanes] Wrote ${outFile} (${(stat.size / 1024).toFixed(1)} KB): ` +
    `major=${result.major.length}, middle=${result.middle.length}, minor=${result.minor.length}, ` +
    `pts ${rawCount} -> ${keptCount}`
);
