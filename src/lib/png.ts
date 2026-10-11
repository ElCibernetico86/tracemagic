/**
 * Minimal streaming PNG encoder (RGBA, 8-bit) built on the browser's
 * CompressionStream. Exists because iPad Safari can't create canvases over
 * ~16.7M pixels, so canvas.toBlob can't save large upscaled images.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(chunks: Uint8Array[]) {
  let c = 0xffffffff;
  for (const bytes of chunks) {
    for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  const typeBytes = new TextEncoder().encode(type);
  out.set(typeBytes, 4);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32([typeBytes, data]));
  return out;
}

export async function encodePng(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  header.set([8, 6, 0, 0, 0], 8); // 8-bit, RGBA, deflate, standard filters, no interlace

  // Filter each row with "Sub" (good for smooth images) and stream it through
  // zlib ('deflate' in CompressionStream is the zlib format PNG needs).
  const stream = new CompressionStream('deflate');
  const writer = stream.writable.getWriter();
  const compressed: Uint8Array[] = [];
  const reading = (async () => {
    const reader = stream.readable.getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      compressed.push(value);
    }
  })();

  const rowBytes = width * 4;
  const ROWS_PER_WRITE = 64;
  for (let y0 = 0; y0 < height; y0 += ROWS_PER_WRITE) {
    const rows = Math.min(ROWS_PER_WRITE, height - y0);
    const block = new Uint8Array(rows * (rowBytes + 1));
    for (let r = 0; r < rows; r++) {
      const src = (y0 + r) * rowBytes;
      const dst = r * (rowBytes + 1);
      block[dst] = 1; // Sub filter
      for (let i = 0; i < rowBytes; i++) {
        const left = i >= 4 ? rgba[src + i - 4] : 0;
        block[dst + 1 + i] = (rgba[src + i] - left) & 0xff;
      }
    }
    await writer.write(block);
  }
  await writer.close();
  await reading;

  const idatLength = compressed.reduce((sum, c) => sum + c.length, 0);
  const idat = new Uint8Array(idatLength);
  let offset = 0;
  for (const c of compressed) {
    idat.set(c, offset);
    offset += c.length;
  }

  const signature = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob([signature, chunk('IHDR', header), chunk('IDAT', idat), chunk('IEND', new Uint8Array(0))], {
    type: 'image/png',
  });
}
