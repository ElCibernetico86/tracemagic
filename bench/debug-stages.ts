// Dump intermediate SVGs for one image: npx tsx bench/debug-stages.ts <image> [fillFilter]
import fs from 'fs';
import { parseTraceOptions, traceImage } from '../trace-pipeline.js';

async function main() {
  const [file, fill] = process.argv.slice(2);
  const opts = parseTraceOptions(JSON.parse(process.env.SETTINGS || '{}'));
  await traceImage(fs.readFileSync(file), opts, (stage, svg) => {
    const paths = svg.match(/<path\b[^>]*>/g) ?? [];
    for (const p of paths) {
      if (fill && !p.toLowerCase().includes(fill.toLowerCase())) continue;
      console.log(`[${stage}] ${p.slice(0, Number(process.env.CHARS || 400))}`);
    }
  });
}
main();
