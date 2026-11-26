/**
 * Fetches latest real NOAA/WMO Voluntary Observing Ships (VOS) open-ocean reports
 * and writes docs/vos-latest.json for zero-CORS GitHub Pages static deployment.
 * Falls back gracefully if NOAA NDBC is temporarily unreachable during CI builds.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLiveVosShips } from '../src/vos-parser.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outPath = path.join(root, 'docs/vos-latest.json');

try {
  const data = await fetchLiveVosShips(6);
  if (data.count > 0) {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(outPath, JSON.stringify(data), 'utf8');
    const kb = (Buffer.byteLength(JSON.stringify(data), 'utf8') / 1024).toFixed(1);
    console.log(
      `[fetch-vos] Wrote docs/vos-latest.json (${data.count} unique ocean ships from ${data.totalObservations} obs, ${kb} KB)`
    );
  } else {
    console.warn('[fetch-vos] NOAA returned 0 parsed ships; preserving existing file if present.');
  }
} catch (err) {
  console.warn(`[fetch-vos] Warning: could not refresh NOAA VOS (${err.message})`);
  try {
    await fs.access(outPath);
    console.warn('[fetch-vos] Keeping existing docs/vos-latest.json');
  } catch {
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await fs.writeFile(
      outPath,
      JSON.stringify({
        updatedAt: Date.now(),
        source: 'NOAA/WMO VOS',
        windowHours: 6,
        totalObservations: 0,
        count: 0,
        ships: [],
      }),
      'utf8'
    );
  }
}
