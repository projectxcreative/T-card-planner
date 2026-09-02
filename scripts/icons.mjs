/**
 * Regenerates the app icons from `public/logo.svg`.
 *
 *   npm i -D sharp && node scripts/icons.mjs
 *
 * The logo is the only drawn asset in the repo — the favicon is the SVG
 * itself, and everything else here is that same file rendered onto a tile,
 * so swapping `public/logo.svg` and re-running this is the whole job.
 *
 * sharp isn't a dependency of the app: icons change about once a year, and a
 * 30MB native module in everyone's install for that is a poor trade.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('This needs sharp:  npm i -D sharp && node scripts/icons.mjs');
  process.exit(1);
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const logo = await readFile(join(root, 'public/logo.svg'));

/** The mark, rendered on its own at `size` px. */
const mark = (size) => sharp(logo, { density: 400 }).resize(size, size).png().toBuffer();

/**
 * One icon: the mark centred on a white tile.
 *
 * `inset` is how much of the tile the mark is allowed — a maskable icon has
 * its corners cropped by whatever shape the launcher fancies, so it keeps to
 * the safe circle in the middle and the others can sit closer to the edge.
 */
async function tile(size, { inset, radius }) {
  const art = Math.round(size * inset);
  const offset = Math.round((size - art) / 2);
  const background = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect width="${size}" height="${size}" rx="${Math.round(size * radius)}" fill="#ffffff"/>` +
      `</svg>`,
  );
  return sharp(background)
    .composite([{ input: await mark(art), top: offset, left: offset }])
    .png()
    .toBuffer();
}

const icons = [
  ['public/pwa-192.png', await tile(192, { inset: 0.74, radius: 0.22 })],
  ['public/pwa-512.png', await tile(512, { inset: 0.74, radius: 0.22 })],
  // Full bleed and well inside the safe zone: the launcher supplies the shape.
  ['public/pwa-maskable-512.png', await tile(512, { inset: 0.56, radius: 0 })],
  // iOS rounds the corners itself and composites transparency onto black.
  ['public/apple-touch-icon.png', await tile(180, { inset: 0.78, radius: 0 })],
];

for (const [path, data] of icons) {
  await writeFile(join(root, path), data);
  console.log(`wrote ${path}`);
}
