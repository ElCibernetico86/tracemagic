// Dump intermediate SVGs for one image: npx tsx bench/debug-stages.ts <image> [layerHex]
// With OUT=<prefix>, also writes <prefix>-<layer>-<stage>.svg for each layer.
import fs from 'fs';
import { parseTraceOptions, traceImage } from '../trace-pipeline.js';

async function main() {
  const [file, only] = process.argv.slice(2);
  const opts = parseTraceOptions(JSON.parse(process.env.SETTINGS || '{}'));
  await traceImage(fs.readFileSync(file), opts, (stage, svg, layer) => {
    if (only && layer.toLowerCase() !== only.toLowerCase()) return;
    if (process.env.OUT) fs.writeFileSync(`${process.env.OUT}-${layer}-${stage}.svg`, svg);
    const paths = svg.match(/<path\b[^>]*>/g) ?? [];
    for (const p of paths) console.log(`[${stage} ${layer}] ${p.slice(0, Number(process.env.CHARS || 400))}`);
  });
}
main();
