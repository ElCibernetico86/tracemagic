// Does AI upscaling before tracing help? npx tsx bench/upscale-vs-direct.ts
// Traces small blurry logos directly vs after a 4× Real-ESRGAN pass; scores against the true logo.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-web';
import { LOGOS } from './logos.js';
import { parseTraceOptions, traceImage } from '../trace-pipeline.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function upscale(session: ort.InferenceSession, img: Buffer) {
  const { data, info } = await sharp(img).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const input = new Float32Array(3 * w * h);
  for (let p = 0; p < w * h; p++) for (let c = 0; c < 3; c++) input[c * w * h + p] = data[p * 3 + c] / 255;
  const out = (await session.run({ input: new ort.Tensor('float32', input, [1, 3, h, w]) })).output;
  const W = w * 4, H = h * 4, o = out.data as Float32Array;
  const rgb = Buffer.alloc(W * H * 3);
  for (let p = 0; p < W * H; p++) for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.max(0, Math.min(255, Math.round(o[c * W * H + p] * 255)));
  return sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
}

async function score(truth: string, traced: string, w: number, h: number) {
  const r = (svg: string) => sharp(Buffer.from(svg), { density: 288 }).resize(w * 4, h * 4, { fit: 'fill' }).flatten({ background: '#fff' }).removeAlpha().raw().toBuffer();
  const [a, b] = await Promise.all([r(truth), r(traced)]);
  let bad = 0;
  for (let i = 0; i < a.length; i += 3) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 90) bad++;
  return ((bad / (a.length / 3)) * 100).toFixed(2);
}

async function main() {
  ort.env.wasm.numThreads = 1;
  const session = await ort.InferenceSession.create(fs.readFileSync(path.join(HERE, '../public/models/realesr-general-x4v3.onnx')), { executionProviders: ['wasm'] });
  const opts = parseTraceOptions({});
  for (const [name, svg] of Object.entries(LOGOS)) {
    const w = +svg.match(/width="(\d+)"/)![1], h = +svg.match(/height="(\d+)"/)![1];
    const small = await sharp(Buffer.from(svg)).resize(Math.round(w * 0.4)).blur(0.5).flatten({ background: '#fff' }).jpeg({ quality: 70 }).toBuffer();
    const direct = await traceImage(small, opts);
    const up = await upscale(session, small);
    const viaAi = await traceImage(up, opts);
    // Traced SVGs carry the input's pixel size; normalize to the truth's canvas for scoring.
    const fit = (s: string) => s.replace(/<svg([^>]*)\swidth="[^"]*"\sheight="[^"]*"/, `<svg$1 width="${w}" height="${h}"`);
    console.log(`${name.padEnd(10)} direct: err=${await score(svg, fit(direct.svg), w, h)}% colors=${direct.stats.colors}   via AI 4x: err=${await score(svg, fit(viaAi.svg), w, h)}% colors=${viaAi.stats.colors}`);
  }
}
main();
