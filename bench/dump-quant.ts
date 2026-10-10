// Save the quantized trace-resolution image: npx tsx bench/dump-quant.ts <image> <out.png>
import fs from 'fs';
import sharp from 'sharp';
import { quantizeForTrace } from '../quantize.js';

async function main() {
  const [file, out] = process.argv.slice(2);
  const src = await sharp(fs.readFileSync(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height } = src.info;
  const s = 4;
  const up = await sharp(src.data, { raw: { width, height, channels: 4 } })
    .resize(width * s, height * s, { fit: 'fill', kernel: 'mitchell' }).raw().toBuffer({ resolveWithObject: true });
  const q = quantizeForTrace({ data: src.data, width, height }, { data: up.data, width: up.info.width, height: up.info.height }, { maxColors: null });
  await sharp(q.data, { raw: { width: up.info.width, height: up.info.height, channels: 4 } }).png().toFile(out);
  console.log('palette', q.palette);
}
main();
