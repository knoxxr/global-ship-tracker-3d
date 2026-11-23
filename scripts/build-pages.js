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
  ['src/mvt-decoder.js', 'mvt-decoder.js'],
  ['src/ais-parser.js', 'ais-parser.js'],
  ['src/public/world-geo.js', 'world-geo.js'],
  ['src/public/world-data.js', 'world-data.js'],
  ['src/public/globe-engine.js', 'globe-engine.js'],
  ['src/public/telemetry-ui.js', 'telemetry-ui.js'],
  ['src/public/styles.css', 'styles.css'],
  ['src/public/sw.js', 'sw.js'],
];

await fs.mkdir(docsDir, { recursive: true });
await fs.writeFile(path.join(docsDir, '.nojekyll'), '');

for (const [srcRel, dstName] of FILES_TO_COPY) {
  await fs.copyFile(path.join(root, srcRel), path.join(docsDir, dstName));
}

// App icons + PWA manifest
await fs.cp(path.join(root, 'src/public/icons'), path.join(docsDir, 'icons'), { recursive: true });
await fs.copyFile(path.join(root, 'src/public/manifest.webmanifest'), path.join(docsDir, 'manifest.webmanifest'));
await fs.copyFile(path.join(root, 'src/public/icons/favicon-32.png'), path.join(docsDir, 'favicon.ico'));

console.log(`[build-pages] Synced ${FILES_TO_COPY.length} live-only files + icons to docs/`);
