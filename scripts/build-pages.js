/**
 * Syncs shared 100% live AIS ES modules and styles from src/ into docs/ for GitHub Pages.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(root, 'docs');

const FILES_TO_COPY = [
  ['src/geo-math.js', 'geo-math.js'],
  ['src/live-zones.js', 'live-zones.js'],
  ['src/ais-parser.js', 'ais-parser.js'],
  ['src/public/world-data.js', 'world-data.js'],
  ['src/public/globe-engine.js', 'globe-engine.js'],
  ['src/public/telemetry-ui.js', 'telemetry-ui.js'],
  ['src/public/styles.css', 'styles.css'],
];

await fs.mkdir(docsDir, { recursive: true });
await fs.writeFile(path.join(docsDir, '.nojekyll'), '');

for (const [srcRel, dstName] of FILES_TO_COPY) {
  await fs.copyFile(path.join(root, srcRel), path.join(docsDir, dstName));
}

console.log(`[build-pages] Synced ${FILES_TO_COPY.length} live-only files to docs/`);
