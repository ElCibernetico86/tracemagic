// Trace the local (git-ignored) logo fixtures and score them: npx tsx bench/local-run.ts <tag>
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseTraceOptions, traceImage } from '../trace-pipeline.js';
import { cornerQuality } from './corners.js';
import { smoothness } from './smoothness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const tag = process.argv[2] || 'run';
  const dir = path.join(HERE, 'local');
  if (!fs.existsSync(dir)) return console.log('no bench/local fixtures');
  for (const f of fs.readdirSync(dir).filter((f) => /\.(png|jpe?g|webp)$/i.test(f))) {
    const r = await traceImage(fs.readFileSync(path.join(dir, f)), parseTraceOptions(JSON.parse(process.env.SETTINGS || '{}')));
    const out = path.join(HERE, 'out', `${tag}-${f.replace(/\.[^.]+$/, '')}.svg`);
    fs.writeFileSync(out, r.svg);
    const q = cornerQuality(r.svg), sm = smoothness(r.svg);
    console.log(`${tag} ${f}: nicks=${q.nicks} offAxis=${q.offAxis} lines=${q.lines} curves=${q.curves} wobble=${sm.wobble.toFixed(3)} ${r.stats.bytes}B ${r.stats.durationMs}ms`);
  }
}
main();
