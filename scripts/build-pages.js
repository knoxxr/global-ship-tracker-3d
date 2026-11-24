/**
 * Syncs shared 100% live AIS ES modules, styles, icons, and PWA assets from src/ into docs/ for GitHub Pages.
 * Automatically stamps deterministic content-hash cache versions into docs/index.html, docs/pages-app.js, and docs/sw.js.
 */
import crypto from 'node:crypto';
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
  ['src/public/api-guard.js', 'api-guard.js'],
  ['src/public/i18n.js', 'i18n.js'],
  ['src/public/world-geo-lite.js', 'world-geo-lite.js'],
  ['src/public/world-geo.js', 'world-geo.js'],
  ['src/public/world-data.js', 'world-data.js'],
  ['src/public/globe-engine.js', 'globe-engine.js'],
  ['src/public/telemetry-ui.js', 'telemetry-ui.js'],
  ['src/public/ui-controller.js', 'ui-controller.js'],
  ['src/public/styles.css', 'styles.css'],
  ['src/public/sw.js', 'sw.js'],
];

await fs.mkdir(docsDir, { recursive: true });
await fs.writeFile(path.join(docsDir, '.nojekyll'), '');

const hasher = crypto.createHash('sha256');
for (const [srcRel, dstName] of FILES_TO_COPY) {
  const buf = await fs.readFile(path.join(root, srcRel));
  await fs.writeFile(path.join(docsDir, dstName), buf);
  if (dstName !== 'sw.js') hasher.update(buf);
}

// Include docs/pages-app.js (stripped of query hashes) in the deterministic build hash
const pagesAppPath = path.join(docsDir, 'pages-app.js');
const pagesAppRaw = await fs.readFile(pagesAppPath, 'utf8');
hasher.update(pagesAppRaw.replace(/\?v=[a-zA-Z0-9_-]+/g, ''));

const ver = hasher.digest('hex').slice(0, 8);

// Stamp ?v=<hash> into docs/index.html
const docsIndexPath = path.join(docsDir, 'index.html');
const docsIndex = await fs.readFile(docsIndexPath, 'utf8');
const stampedIndex = docsIndex
  .replace(/\.\/styles\.css(?:\?v=[a-zA-Z0-9_-]+)?/, `./styles.css?v=${ver}`)
  .replace(/\.\/pages-app\.js(?:\?v=[a-zA-Z0-9_-]+)?/, `./pages-app.js?v=${ver}`);
if (stampedIndex !== docsIndex) {
  await fs.writeFile(docsIndexPath, stampedIndex);
}

// Stamp ?v=<hash> into docs/pages-app.js local module imports
const stampedPagesApp = pagesAppRaw.replace(
  /from '\.\/(globe-engine|ais-parser|telemetry-ui|ui-controller|api-guard|i18n)\.js(?:\?v=[a-zA-Z0-9_-]+)?'/g,
  `from './$1.js?v=${ver}'`
);
if (stampedPagesApp !== pagesAppRaw) {
  await fs.writeFile(pagesAppPath, stampedPagesApp);
}

// Stamp cache name into docs/sw.js so returning PWA users automatically pick up new builds
const docsSwPath = path.join(docsDir, 'sw.js');
const docsSw = await fs.readFile(docsSwPath, 'utf8');
const stampedSw = docsSw.replace(/marineglobe-shell-[a-zA-Z0-9_-]+/, `marineglobe-shell-${ver}`);
if (stampedSw !== docsSw) {
  await fs.writeFile(docsSwPath, stampedSw);
}

// App icons + PWA manifest
await fs.cp(path.join(root, 'src/public/icons'), path.join(docsDir, 'icons'), { recursive: true });
await fs.copyFile(path.join(root, 'src/public/manifest.webmanifest'), path.join(docsDir, 'manifest.webmanifest'));
await fs.copyFile(path.join(root, 'src/public/icons/favicon-32.png'), path.join(docsDir, 'favicon.ico'));

console.log(`[build-pages] Synced ${FILES_TO_COPY.length} files + icons to docs/ (build v=${ver})`);
