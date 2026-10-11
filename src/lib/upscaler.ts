/**
 * In-browser AI upscaling with Real-ESRGAN (realesr-general-x4v3, BSD-3)
 * via ONNX Runtime Web. Runs on the GPU (WebGPU) when available, otherwise
 * on the CPU (WebAssembly, much slower). Nothing leaves the device.
 *
 * The model is a fixed 4× upscaler; 2× is produced by averaging each 4×
 * tile down. Images are processed in overlapping tiles so memory stays
 * bounded on iPads.
 */

const MODEL_URL = '/models/realesr-general-x4v3.onnx';
const MODEL_SCALE = 4;
/** Input tile size and the context margin around it (input pixels). */
const TILE = 192;
const PAD = 16;
/** Largest output we'll build (pixels); ~6000 × 6000. */
export const MAX_OUTPUT_PIXELS = 36_000_000;

export type Backend = 'webgpu' | 'wasm';

export interface UpscaleProgress {
  done: number;
  total: number;
  backend: Backend;
}

export interface UpscaleResult {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  backend: Backend;
}

type Ort = typeof import('onnxruntime-web/webgpu');
type Session = Awaited<ReturnType<Ort['InferenceSession']['create']>>;

let loading: Promise<{ ort: Ort; session: Session; backend: Backend }> | null = null;

/** Load the runtime and model once; later calls reuse the session. */
export function loadUpscaler() {
  if (!loading) {
    loading = (async () => {
      const ort = await import('onnxruntime-web/webgpu');
      const res = await fetch(MODEL_URL);
      if (!res.ok) throw new Error(`Could not load the AI model (${res.status}).`);
      const model = new Uint8Array(await res.arrayBuffer());

      const gpu = (navigator as any).gpu;
      const adapter = gpu ? await gpu.requestAdapter().catch(() => null) : null;
      if (adapter) {
        try {
          const session = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] });
          return { ort, session, backend: 'webgpu' as const };
        } catch (err) {
          console.warn('WebGPU unavailable for the upscaler, using CPU.', err);
        }
      }
      const session = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
      return { ort, session, backend: 'wasm' as const };
    })();
    loading.catch(() => {
      loading = null;
    });
  }
  return loading;
}

/** Spread opaque colors into fully transparent pixels so edges don't upscale with dark halos. */
function bleedIntoTransparent(rgba: Uint8ClampedArray, w: number, h: number, passes = 8) {
  const known = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) known[p] = rgba[p * 4 + 3] > 0 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = known.slice();
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (known[p]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
          if (q >= 0 && known[q]) {
            r += rgba[q * 4];
            g += rgba[q * 4 + 1];
            b += rgba[q * 4 + 2];
            n++;
          }
        }
        if (n > 0) {
          rgba[p * 4] = r / n;
          rgba[p * 4 + 1] = g / n;
          rgba[p * 4 + 2] = b / n;
          next[p] = 1;
          changed = true;
        }
      }
    }
    known.set(next);
    if (!changed) break;
  }
}

export async function readPixels(file: Blob) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
  return { rgba: data, width: canvas.width, height: canvas.height };
}

export async function upscaleImage(
  file: Blob,
  factor: 2 | 4,
  onProgress?: (p: UpscaleProgress) => void,
  signal?: AbortSignal,
): Promise<UpscaleResult> {
  const { ort, session, backend } = await loadUpscaler();
  const src = await readPixels(file);
  const { width: w, height: h } = src;
  const W = w * factor;
  const H = h * factor;
  if (W * H > MAX_OUTPUT_PIXELS) {
    throw new Error(`That would be ${W} × ${H} px — too large. Try 2× or a smaller image.`);
  }
  // The model always makes 4×; for 2× each tile is averaged down as it's copied.
  const step = MODEL_SCALE / factor;

  let hasAlpha = false;
  for (let p = 3; p < src.rgba.length; p += 4) {
    if (src.rgba[p] < 255) {
      hasAlpha = true;
      break;
    }
  }
  const color = new Uint8ClampedArray(src.rgba);
  if (hasAlpha) bleedIntoTransparent(color, w, h);

  const out = new Uint8ClampedArray(W * H * 4);
  if (!hasAlpha) for (let i = 3; i < out.length; i += 4) out[i] = 255;

  const S = TILE + 2 * PAD; // fixed tile shape keeps the GPU from recompiling
  const OS = S * MODEL_SCALE;
  const input = new Float32Array(3 * S * S);
  const tilesX = Math.ceil(w / TILE);
  const tilesY = Math.ceil(h / TILE);
  const total = tilesX * tilesY * (hasAlpha ? 2 : 1);
  let done = 0;

  const runTile = async (tx: number, ty: number, channel: 'color' | 'alpha') => {
    // Fill the padded tile, clamping coordinates at the image edges.
    for (let y = 0; y < S; y++) {
      const sy = Math.min(h - 1, Math.max(0, ty - PAD + y));
      for (let x = 0; x < S; x++) {
        const sx = Math.min(w - 1, Math.max(0, tx - PAD + x));
        const i = (sy * w + sx) * 4;
        const t = y * S + x;
        if (channel === 'color') {
          input[t] = color[i] / 255;
          input[S * S + t] = color[i + 1] / 255;
          input[2 * S * S + t] = color[i + 2] / 255;
        } else {
          const a = src.rgba[i + 3] / 255;
          input[t] = input[S * S + t] = input[2 * S * S + t] = a;
        }
      }
    }
    const feeds = { [session.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, S, S]) };
    const result = await session.run(feeds);
    const tensor = result[session.outputNames[0]];
    const o = (await tensor.getData()) as Float32Array;
    tensor.dispose?.();

    // Copy the tile's valid (unpadded) region into the output.
    const vw = Math.min(TILE, w - tx) * factor;
    const vh = Math.min(TILE, h - ty) * factor;
    const off = PAD * MODEL_SCALE;
    const norm = 255 / (step * step);
    for (let y = 0; y < vh; y++) {
      const oy = ty * factor + y;
      for (let x = 0; x < vw; x++) {
        let r = 0, g = 0, b = 0;
        for (let sy = 0; sy < step; sy++) {
          for (let sx = 0; sx < step; sx++) {
            const t = (off + y * step + sy) * OS + off + x * step + sx;
            r += o[t];
            g += o[OS * OS + t];
            b += o[2 * OS * OS + t];
          }
        }
        const d = (oy * W + tx * factor + x) * 4;
        if (channel === 'color') {
          out[d] = r * norm;
          out[d + 1] = g * norm;
          out[d + 2] = b * norm;
        } else {
          out[d + 3] = ((r + g + b) / 3) * norm;
        }
      }
    }
    done++;
    onProgress?.({ done, total, backend });
    // Let the page repaint between tiles.
    await new Promise((r) => setTimeout(r, 0));
  };

  onProgress?.({ done: 0, total, backend });
  for (const channel of hasAlpha ? (['color', 'alpha'] as const) : (['color'] as const)) {
    for (let ty = 0; ty < h; ty += TILE) {
      for (let tx = 0; tx < w; tx += TILE) {
        if (signal?.aborted) throw new DOMException('Upscale canceled.', 'AbortError');
        await runTile(tx, ty, channel);
      }
    }
  }

  return { rgba: out, width: W, height: H, backend };
}

/** Downsampled copy for on-screen display (keeps iPad canvases small). */
export function previewCanvas(rgba: Uint8ClampedArray, width: number, height: number, maxSide = 1600) {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const pw = Math.max(1, Math.round(width * scale));
  const ph = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  const img = ctx.createImageData(pw, ph);
  // Box-average sampling so the preview isn't aliased.
  const step = 1 / scale;
  for (let y = 0; y < ph; y++) {
    const y0 = Math.floor(y * step);
    const y1 = Math.min(height, Math.max(y0 + 1, Math.floor((y + 1) * step)));
    for (let x = 0; x < pw; x++) {
      const x0 = Math.floor(x * step);
      const x1 = Math.min(width, Math.max(x0 + 1, Math.floor((x + 1) * step)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * width + xx) * 4;
          r += rgba[i];
          g += rgba[i + 1];
          b += rgba[i + 2];
          a += rgba[i + 3];
          n++;
        }
      }
      const o = (y * pw + x) * 4;
      img.data[o] = r / n;
      img.data[o + 1] = g / n;
      img.data[o + 2] = b / n;
      img.data[o + 3] = a / n;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** A 1:1 crop of the output (for the "100%" comparison view). */
export function cropCanvas(rgba: Uint8ClampedArray, width: number, height: number, cx: number, cy: number, cw: number, ch: number) {
  const x0 = Math.max(0, Math.min(width - cw, Math.round(cx - cw / 2)));
  const y0 = Math.max(0, Math.min(height - ch, Math.round(cy - ch / 2)));
  const w = Math.min(cw, width);
  const h = Math.min(ch, height);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const s = ((y0 + y) * width + x0) * 4;
    img.data.set(rgba.subarray(s, s + w * 4), y * w * 4);
  }
  ctx.putImageData(img, 0, 0);
  return { canvas, x0, y0 };
}
