// Zoomed crops of a traced SVG next to the true logo: npx tsx bench/zoom.ts <logo> <tag> <x> <y> <w> <h> [zoom]
// Writes bench/out/zoom-<tag>-<logo>.png (rows: truth, traced PNG, traced JPG).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { LOGOS } from './logos.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

async function main() {
  const [logo, tag, xs, ys, ws, hs, zs] = process.argv.slice(2);
  const [x, y, w, h] = [xs, ys, ws, hs].map(Number);
  const Z = Number(zs || 10);
  const crop = (svg: string) =>
    sharp(Buffer.from(svg), { density: 72 * Z }).extract({ left: x * Z, top: y * Z, width: w * Z, height: h * Z }).flatten({ background: '#fff' }).png().toBuffer();
  const tiles = [await crop(LOGOS[logo])];
  for (const fmt of ['png', 'jpg']) tiles.push(await crop(fs.readFileSync(path.join(OUT, `${tag}-${logo}-${fmt}.svg`), 'utf8')));
  await sharp({ create: { width: w * Z * 3 + 16, height: h * Z, channels: 3, background: '#f0f' } })
    .composite(tiles.map((input, i) => ({ input, left: i * (w * Z + 8), top: 0 })))
    .png().toFile(path.join(OUT, `zoom-${tag}-${logo}.png`));
}
main();
