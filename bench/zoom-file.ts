// Zoomed crop of an input image next to traced SVG(s): npx tsx bench/zoom-file.ts <image> <out.png> <x> <y> <w> <h> <zoom> <svg> [svg...]
import fs from 'fs';
import sharp from 'sharp';

async function main() {
  const [image, out, xs, ys, ws, hs, zs, ...svgs] = process.argv.slice(2);
  const [x, y, w, h, Z] = [xs, ys, ws, hs, zs].map(Number);
  const tiles = [await sharp(image).extract({ left: x, top: y, width: w, height: h }).resize(w * Z, h * Z, { kernel: 'nearest' }).png().toBuffer()];
  for (const f of svgs) {
    tiles.push(await sharp(fs.readFileSync(f), { density: 72 * Z }).extract({ left: x * Z, top: y * Z, width: w * Z, height: h * Z }).flatten({ background: '#f0f' }).png().toBuffer());
  }
  const sheet = await sharp({ create: { width: w * Z, height: tiles.length * (h * Z + 6), channels: 3, background: '#f0f' } })
    .composite(tiles.map((input, i) => ({ input, left: 0, top: i * (h * Z + 6) }))).png().toBuffer();
  await sharp(sheet).resize({ width: Math.min(1600, w * Z) }).png().toFile(out);
}
main();
