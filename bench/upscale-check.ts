// Run the upscaler model in Node (onnxruntime-web, WASM) on a small blurry test image:
// npx tsx bench/upscale-check.ts → bench/out/upscale-check.png (bicubic vs model)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import * as ort from 'onnxruntime-web';
import { LOGOS } from './logos.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  ort.env.wasm.numThreads = 1;
  const model = fs.readFileSync(path.join(HERE, '../public/models/realesr-general-x4v3.onnx'));
  const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
  console.log('inputs', session.inputNames, 'outputs', session.outputNames);

  // A small, blurry, JPEG-compressed version of the badge: the upscaler's job.
  const w = 100, h = 100;
  const small = await sharp(Buffer.from(LOGOS.badge)).resize(w, h).blur(0.6).jpeg({ quality: 60 }).toBuffer();
  const { data } = await sharp(small).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const input = new Float32Array(3 * w * h);
  for (let p = 0; p < w * h; p++) for (let c = 0; c < 3; c++) input[c * w * h + p] = data[p * 3 + c] / 255;
  const t0 = Date.now();
  const result = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, h, w]) });
  const out = result[session.outputNames[0]];
  console.log('output dims', out.dims, `${Date.now() - t0}ms`);
  const [, , H, W] = out.dims as number[];
  const o = out.data as Float32Array;
  const rgb = Buffer.alloc(W * H * 3);
  for (let p = 0; p < W * H; p++) for (let c = 0; c < 3; c++) rgb[p * 3 + c] = Math.max(0, Math.min(255, Math.round(o[c * W * H + p] * 255)));
  const ai = await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).png().toBuffer();
  const bicubic = await sharp(small).resize(W, H, { kernel: 'cubic' }).png().toBuffer();
  await sharp({ create: { width: W * 2 + 8, height: H, channels: 3, background: '#f0f' } })
    .composite([{ input: bicubic, left: 0, top: 0 }, { input: ai, left: W + 8, top: 0 }])
    .png().toFile(path.join(HERE, 'out/upscale-check.png'));
}
main();
