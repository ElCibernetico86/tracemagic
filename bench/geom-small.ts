// Geometry pass on tiny shapes (2px strokes) in isolation:
// npx tsx bench/geom-small.ts  → prints refined paths, writes bench/out/geom-small.png
import fs from 'fs';
import sharp from 'sharp';
import { refineTracedSvg } from '../trace-postprocess.js';

// Pixel-staircase outlines at 4× (as VTracer emits them), source units = trace/4.
const S = 4;
const rect = (x: number, y: number, w: number, h: number) =>
  `M${x * S},${y * S} L${(x + w) * S},${y * S} L${(x + w) * S},${(y + h) * S} L${x * S},${(y + h) * S} Z`;
const shapes = {
  stem: rect(5, 3, 2, 13),
  // "L"-like: 2px stem with a 2px foot
  ell: `M${10 * S},${3 * S} L${12 * S},${3 * S} L${12 * S},${14 * S} L${17 * S},${14 * S} L${17 * S},${16 * S} L${10 * S},${16 * S} Z`,
  // ring with a small rectangular counter (like the bowl of a P)
  bowl: `${rect(20, 3, 7, 7)} M${22 * S},${5 * S} L${22 * S},${8 * S} L${25 * S},${8 * S} L${25 * S},${5 * S} Z`,
};

async function main() {
  const body = Object.values(shapes).map((d) => `<path d="${d}" fill="#000000" transform="translate(0,0)"/>`).join('');
  const raw = `<svg xmlns="http://www.w3.org/2000/svg" width="${30 * S}" height="${20 * S}">${body}</svg>`;
  const out = refineTracedSvg(raw, { smoothness: 50, scale: S, width: 30, height: 20, curves: true, staircase: true });
  for (const d of out.match(/ d="[^"]+"/g) ?? []) console.log(d);
  const Z = 20;
  const truth = `<svg xmlns="http://www.w3.org/2000/svg" width="30" height="20" viewBox="0 0 30 20">${body.replace(/translate\(0,0\)/g, `scale(${1 / S})`)}</svg>`;
  const r = (svg: string) => sharp(Buffer.from(svg), { density: 72 * Z }).flatten({ background: '#fff' }).png().toBuffer();
  await sharp({ create: { width: 30 * Z, height: 40 * Z + 4, channels: 3, background: '#f0f' } })
    .composite([{ input: await r(truth), left: 0, top: 0 }, { input: await r(out), left: 0, top: 20 * Z + 4 }])
    .png().toFile('bench/out/geom-small.png');
}
main();
