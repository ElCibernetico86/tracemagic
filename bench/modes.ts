// Smoke-test every mode/option combination: npx tsx bench/modes.ts
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { parseTraceOptions, traceImage } from '../trace-pipeline.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

async function main() {
  const badge = fs.readFileSync(path.join(OUT, 'badge.png'));
  // Transparent logo: knock out the white background.
  const { data, info } = await sharp(badge).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const white = Math.min(data[i], data[i + 1], data[i + 2]);
    if (white > 240) data[i + 3] = 0;
  }
  const transparent = await sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
  // Large noisy photo-like image (gradient + shapes) for timing.
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#88aacc' } })
    .composite([{ input: Buffer.from(`<svg width="3000" height="2000"><defs><linearGradient id="g"><stop offset="0" stop-color="#f00"/><stop offset="1" stop-color="#00f"/></linearGradient></defs><rect width="3000" height="2000" fill="url(#g)"/><circle cx="1500" cy="1000" r="600" fill="#fff"/></svg>`) }])
    .jpeg({ quality: 80 }).toBuffer();

  const cases: [string, Buffer, Record<string, string>][] = [
    ['polygon', badge, { curveMode: 'polygon' }],
    ['pixel', badge, { curveMode: 'pixel' }],
    ['bw', badge, { mode: 'bw' }],
    ['grayscale', badge, { mode: 'grayscale' }],
    ['cutout-grouped', badge, { stacking: 'cutout', groupByColor: 'true' }],
    ['maxcolors-3', badge, { maxColors: '3' }],
    ['transparent', transparent, {}],
    ['big-gradient', big, { maxColors: '12' }],
  ];
  for (const [name, buf, body] of cases) {
    try {
      const { svg, stats } = await traceImage(buf, parseTraceOptions(body));
      fs.writeFileSync(path.join(OUT, `mode-${name}.svg`), svg);
      const png = await sharp(Buffer.from(svg)).resize(600).flatten({ background: '#cccccc' }).png().toBuffer();
      fs.writeFileSync(path.join(OUT, `mode-${name}.png`), png);
      console.log(`${name.padEnd(16)} ok  ${stats.width}x${stats.height} paths=${stats.paths} colors=${stats.colors} ${Math.round(stats.bytes / 1024)}KB ${stats.durationMs}ms`);
    } catch (e: any) {
      console.log(`${name.padEnd(16)} FAIL ${e.message}`);
    }
  }
}
main();
