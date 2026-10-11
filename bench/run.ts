// In-process benchmark (no server needed): npx tsx bench/run.ts [tag]
// Renders synthetic logos with known geometry, traces them, scores pixel error at 4x.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { parseTraceOptions, traceImage } from '../trace-pipeline.js';
import { LOGOS } from './logos.js';
import { smoothness } from './smoothness.js';

const OUT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'out');

/** Truth logos use shapes like <circle>; the wobble score only reads <path d>, so this is for reference. */
function svgToPaths(svg: string) {
  return svg;
}

async function render(svg: string, w: number, h: number, s: number) {
  return sharp(Buffer.from(svg), { density: 72 * s })
    .resize(w * s, h * s, { fit: 'fill' })
    .flatten({ background: '#ffffff' })
    .removeAlpha()
    .raw()
    .toBuffer();
}

async function score(truth: string, traced: string, w: number, h: number) {
  const S = 4;
  const [a, b] = await Promise.all([render(truth, w, h, S), render(traced, w, h, S)]);
  let bad = 0;
  for (let i = 0; i < a.length; i += 3) {
    const d = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (d > 90) bad++;
  }
  return (bad / (a.length / 3)) * 100;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const tag = process.argv[2] || 'run';
  const opts = parseTraceOptions(JSON.parse(process.env.SETTINGS || '{}'));
  const only = process.env.ONLY;
  let totalErr = 0, count = 0, totalWobble = 0;
  for (const [name, svg] of Object.entries(LOGOS)) {
    if (only && !name.includes(only)) continue;
    const w = +svg.match(/width="(\d+)"/)![1];
    const h = +svg.match(/height="(\d+)"/)![1];
    for (const fmt of ['png', 'jpg'] as const) {
      const img = fmt === 'png'
        ? await sharp(Buffer.from(svg)).png().toBuffer()
        : await sharp(Buffer.from(svg)).flatten({ background: '#fff' }).jpeg({ quality: 70 }).toBuffer();
      fs.writeFileSync(path.join(OUT, `${name}.${fmt}`), img);
      const { svg: traced, stats } = await traceImage(img, opts);
      fs.writeFileSync(path.join(OUT, `${tag}-${name}-${fmt}.svg`), traced);
      const err = await score(svg, traced, w, h);
      totalErr += err; count++;
      const cmds = (traced.match(/[MLHVCSQTAZ]/gi) || []).length;
      const sm = smoothness(traced);
      const truthSm = smoothness(svgToPaths(svg));
      console.log(`${tag.padEnd(6)} ${name.padEnd(10)} ${fmt}  err=${err.toFixed(2)}%  wobble=${sm.wobble.toFixed(3)} (truth ${truthSm.wobble.toFixed(3)})  paths=${stats.paths} colors=${stats.colors} cmds=${cmds} ${stats.durationMs}ms`);
      totalWobble += sm.wobble;
      const vis = (s: string) => sharp(Buffer.from(s), { density: 144 }).resize(w * 2, h * 2, { fit: 'fill' }).flatten({ background: '#fff' }).png().toBuffer();
      await sharp({ create: { width: w * 4 + 10, height: h * 2, channels: 3, background: '#888' } })
        .composite([{ input: await vis(svg), left: 0, top: 0 }, { input: await vis(traced), left: w * 2 + 10, top: 0 }])
        .png()
        .toFile(path.join(OUT, `${tag}-${name}-${fmt}.png`));
    }
  }
  console.log(`${tag} mean err=${(totalErr / count).toFixed(2)}%  mean wobble=${(totalWobble / count).toFixed(3)}°/px`);
}
main();
