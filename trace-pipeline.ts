import sharp from 'sharp';
import {
  ColorMode,
  Hierarchical,
  OptimizePreset,
  PathSimplifyMode,
  optimize,
  vectorizeRaw,
} from '@neplex/vectorizer';
import { refineTracedSvg } from './trace-postprocess.js';
import { quantizeForTrace, smoothRegionBoundaries, type RGB } from './quantize.js';

// Inputs larger than this are downscaled first; logos gain nothing beyond it.
const MAX_SOURCE_DIMENSION = 2000;
// Tracing happens on a smooth upscale (up to 4×) so edges land at sub-pixel
// positions; the output is scaled back to the source size.
const TRACE_TARGET_DIMENSION = 2000;
const MAX_TRACE_SCALE = 4;
// Boundary smoothing radius, in source pixels.
const EDGE_SMOOTHING = 0.6;

type TraceMode = 'color' | 'grayscale' | 'bw';
type CurveMode = 'spline' | 'polygon' | 'pixel';
type ShapeStacking = 'stacked' | 'cutout';

export const SUPPORTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export interface TraceOptions {
  mode: TraceMode;
  /** null means automatic palette detection (no pre-quantization) */
  maxColors: number | null;
  /** 0–100, higher keeps smaller features */
  detail: number;
  /** 0–100, higher merges corners into smoother curves */
  smoothness: number;
  curveMode: CurveMode;
  stacking: ShapeStacking;
  groupByColor: boolean;
  /** Snap straight edges within 2° of level/plumb exactly onto it. */
  snapAxes: boolean;
  /** Fixed palette chosen by the user (color reduction); null = detect. */
  palette: RGB[] | null;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** "#RRGGBB,#RRGGBB" or a JSON array of hex strings → RGB list (max 64), or null. */
function parsePalette(value: unknown): RGB[] | null {
  let items: unknown[] = [];
  if (Array.isArray(value)) items = value;
  else if (typeof value === 'string' && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      items = Array.isArray(parsed) ? parsed : [];
    } catch {
      items = value.split(',');
    }
  }
  const colors = items
    .map((v) => String(v).trim().replace(/^#/, ''))
    .filter((hex) => /^[0-9a-fA-F]{6}$/.test(hex))
    .slice(0, 64)
    .map((hex) => [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB);
  return colors.length > 0 ? colors : null;
}

export function parseTraceOptions(body: Record<string, unknown>): TraceOptions {
  const mode: TraceMode = body.mode === 'grayscale' || body.mode === 'bw' ? body.mode : 'color';
  const curveMode: CurveMode =
    body.curveMode === 'polygon' || body.curveMode === 'pixel' ? body.curveMode : 'spline';

  const rawColors = Number(body.maxColors);
  const maxColors =
    Number.isFinite(rawColors) && rawColors > 0 ? Math.round(clamp(rawColors, 2, 64)) : null;

  const detail = Number.isFinite(Number(body.detail)) ? clamp(Number(body.detail), 0, 100) : 80;
  const smoothness = Number.isFinite(Number(body.smoothness))
    ? clamp(Number(body.smoothness), 0, 100)
    : 50;

  // Default on: every color becomes its own named group in the SVG.
  const groupByColor = !(body.groupByColor === 'false' || body.groupByColor === false);
  const stacking: ShapeStacking = body.stacking === 'cutout' ? 'cutout' : 'stacked';

  const snapAxes = !(body.snapAxes === 'false' || body.snapAxes === false);
  return { mode, maxColors, detail, smoothness, curveMode, stacking, groupByColor, snapAxes, palette: parsePalette(body.palette) };
}

function buildVectorizerConfig(options: TraceOptions, scale: number) {
  // Smooth curves are fitted by our own pass from the exact pixel outline;
  // VTracer's own spline smoothing rounds off corners we then can't recover.
  const pathSimplifyMode =
    options.curveMode === 'polygon' ? PathSimplifyMode.Polygon : PathSimplifyMode.None;

  const speckle = 1 + ((100 - options.detail) / 100) * 15;
  return {
    // Layers are traced one at a time as black-on-white masks (see traceImage).
    colorMode: ColorMode.Binary,
    colorPrecision: 8,
    filterSpeckle: Math.max(1, Math.round(speckle * scale)),
    spliceThreshold: 45,
    cornerThreshold: 60,
    // Stacking is built from the per-color layer masks, not by VTracer.
    hierarchical: Hierarchical.Cutout,
    mode: pathSimplifyMode,
    // Inputs are already reduced to an exact palette, so every color is its own layer.
    layerDifference: 1,
    lengthThreshold: 4,
    maxIterations: 10,
    pathPrecision: 2,
  };
}

/** In-place luminance gray for an RGBA buffer. */
function toGray(data: Buffer) {
  for (let i = 0; i < data.length; i += 4) {
    const y = Math.round(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]);
    data[i] = data[i + 1] = data[i + 2] = y;
  }
}

/** Otsu's threshold over the opaque pixels of a gray RGBA buffer. */
function otsuThreshold(data: Buffer) {
  const hist = new Float64Array(256);
  let total = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    hist[data[i]]++;
    total++;
  }
  if (total === 0) return 128;
  let sumAll = 0;
  for (let v = 0; v < 256; v++) sumAll += v * hist[v];
  let sumB = 0, wB = 0, best = 128, bestVar = -1;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > bestVar) { bestVar = between; best = t + 1; }
  }
  return best;
}

async function preprocessImage(buffer: Buffer, options: TraceOptions) {
  let pipeline = sharp(buffer, { failOn: 'error' }).rotate();
  const meta = await pipeline.clone().metadata();
  // .rotate() may swap the axes for EXIF-rotated photos.
  const swap = (meta.orientation ?? 1) >= 5;
  const srcWidth = (swap ? meta.height : meta.width) ?? 0;
  const srcHeight = (swap ? meta.width : meta.height) ?? 0;
  const maxDim = Math.max(srcWidth, srcHeight);
  if (maxDim === 0) throw new Error('Could not read the image dimensions.');

  if (maxDim > MAX_SOURCE_DIMENSION) {
    pipeline = pipeline.resize({
      width: MAX_SOURCE_DIMENSION,
      height: MAX_SOURCE_DIMENSION,
      fit: 'inside',
    });
  }
  const source = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const width = source.info.width;
  const height = source.info.height;
  // Gray conversion done here (not via sharp) so the buffer stays RGBA.
  if (options.mode !== 'color') toGray(source.data);

  // Pixel mode keeps exact pixels, so no upscale there.
  const scale =
    options.curveMode === 'pixel'
      ? 1
      : Math.min(MAX_TRACE_SCALE, Math.max(1, TRACE_TARGET_DIMENSION / Math.max(width, height)));
  const traceWidth = Math.round(width * scale);
  const traceHeight = Math.round(height * scale);

  const upscaled =
    scale === 1
      ? source
      : await sharp(source.data, { raw: { width, height, channels: 4 } })
          .resize(traceWidth, traceHeight, { fit: 'fill', kernel: 'mitchell' })
          .raw()
          .toBuffer({ resolveWithObject: true });

  let data = upscaled.data;
  let palette: RGB[] = [];
  if (options.mode === 'bw') {
    // Black shapes on transparent: the threshold adapts to the image (Otsu),
    // and thresholding the smooth upscale puts edges at sub-pixel positions.
    const threshold = otsuThreshold(source.data);
    data = Buffer.alloc(upscaled.data.length);
    for (let i = 0; i < data.length; i += 4) {
      if (upscaled.data[i + 3] >= 128 && upscaled.data[i] < threshold) data[i + 3] = 255;
    }
    palette = [[0, 0, 0]];
    if (options.curveMode !== 'pixel') {
      data = await smoothRegionBoundaries(
        data,
        upscaled.info.width,
        upscaled.info.height,
        palette,
        EDGE_SMOOTHING * (upscaled.info.width / width),
      );
    }
  } else {
    const quantized = quantizeForTrace(
      { data: source.data, width, height },
      { data: upscaled.data, width: upscaled.info.width, height: upscaled.info.height },
      { maxColors: options.maxColors, palette: options.palette },
    );
    palette = quantized.palette;
    // Iron out sub-pixel edge jitter (about half a source pixel); pixel mode
    // wants the exact pixels, so it skips this.
    data =
      options.curveMode === 'pixel'
        ? quantized.data
        : await smoothRegionBoundaries(
            quantized.data,
            upscaled.info.width,
            upscaled.info.height,
            palette,
            EDGE_SMOOTHING * (upscaled.info.width / width),
          );
  }

  return {
    data,
    traceWidth: upscaled.info.width,
    traceHeight: upscaled.info.height,
    width,
    height,
    scale: upscaled.info.width / width,
    palette,
  };
}

function svgStats(svg: string) {
  const paths = (svg.match(/<path[\s>]/g) || []).length;
  const fills = new Set<string>();
  for (const match of svg.matchAll(/fill="([^"]+)"/g)) {
    if (match[1] !== 'none') fills.add(match[1].toLowerCase());
  }
  return { paths, colors: fills.size, bytes: Buffer.byteLength(svg, 'utf8') };
}

export interface PaletteEntry {
  /** "#RRGGBB" */
  color: string;
  /** Share of the image's (opaque) area, 0–1. */
  area: number;
}

export interface TraceResult {
  svg: string;
  /** Colors in the result, largest area first. */
  palette: PaletteEntry[];
  stats: { paths: number; colors: number; bytes: number; width: number; height: number; durationMs: number };
}

/** Full raster → SVG pipeline. */
/**
 * How far (source px) a stacked layer's hidden extension stays inside the
 * shapes above it. Larger than the curve-fitting error, so a lower color
 * never peeks out around the edge of an upper shape.
 */
const STACK_INSET = 1.5;

function cutoutLayerMask(labels: Int16Array, rank: Int16Array, r: number): Uint8Array {
  const mask = new Uint8Array(labels.length);
  for (let p = 0; p < labels.length; p++) if (labels[p] >= 0 && rank[labels[p]] === r) mask[p] = 1;
  return mask;
}

/** Box dilation of a 0/1 mask by `radius` pixels (separable running sums). */
function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  if (radius <= 0) return mask;
  const tmp = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let count = 0;
    for (let x = 0; x <= Math.min(radius, w - 1); x++) count += mask[row + x];
    for (let x = 0; x < w; x++) {
      tmp[row + x] = count > 0 ? 1 : 0;
      const add = x + radius + 1;
      const drop = x - radius;
      if (add < w) count += mask[row + add];
      if (drop >= 0) count -= mask[row + drop];
    }
  }
  const out = new Uint8Array(w * h);
  for (let x = 0; x < w; x++) {
    let count = 0;
    for (let y = 0; y <= Math.min(radius, h - 1); y++) count += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = count > 0 ? 1 : 0;
      const add = y + radius + 1;
      const drop = y - radius;
      if (add < h) count += tmp[add * w + x];
      if (drop >= 0) count -= tmp[drop * w + x];
    }
  }
  return out;
}

/**
 * Stacked layer r: its own pixels, extended under the colors above it — but
 * only under shapes that touch it, and kept `inset` pixels away from any
 * lower color so the hidden part can't peek out. E.g. a navy bar with yellow
 * text becomes a solid bar; unrelated shapes elsewhere aren't copied in.
 */
function stackedLayerMask(labels: Int16Array, rank: Int16Array, r: number, w: number, h: number, inset: number) {
  const n = labels.length;
  const below = new Uint8Array(n);
  for (let p = 0; p < n; p++) if (labels[p] < 0 || rank[labels[p]] < r) below[p] = 1;
  const nearBelow = dilate(below, w, h, inset);

  // Flood from the layer's own pixels through allowed upper pixels (4-connected).
  const mask = new Uint8Array(n);
  const stack = new Int32Array(n);
  let top = 0;
  for (let p = 0; p < n; p++) {
    if (labels[p] >= 0 && rank[labels[p]] === r) {
      mask[p] = 1;
      stack[top++] = p;
    }
  }
  const allowed = (q: number) => !mask[q] && labels[q] >= 0 && rank[labels[q]] > r && !nearBelow[q];
  while (top > 0) {
    const p = stack[--top];
    const x = p % w;
    for (const q of [p - w, p + w, x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1]) {
      if (q >= 0 && q < n && allowed(q)) {
        mask[q] = 1;
        stack[top++] = q;
      }
    }
  }
  return mask;
}

/** Palette index of every pixel in the exact-color trace image; -1 = transparent. */
function labelPixels(data: Buffer, palette: RGB[]): Int16Array {
  const index = new Map<number, number>();
  palette.forEach(([r, g, b], k) => index.set((r << 16) | (g << 8) | b, k));
  const labels = new Int16Array(data.length / 4).fill(-1);
  for (let p = 0; p < labels.length; p++) {
    const i = p * 4;
    if (data[i + 3] < 128) continue;
    labels[p] = index.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]) ?? -1;
  }
  return labels;
}

const toHex = ([r, g, b]: RGB) =>
  [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('').toUpperCase();

/**
 * Full raster → SVG pipeline.
 *
 * Every palette color is traced as its own layer, bottom (largest area) to
 * top. In stacked mode a layer also covers the area of every layer above it,
 * so there are no hairline gaps between colors; in cut-out mode each layer is
 * exactly its own pixels. Either way the output can be grouped by color
 * without changing how it looks.
 */
export async function traceImage(
  buffer: Buffer,
  options: TraceOptions,
  /** Optional hook to inspect intermediate SVGs (used by bench/). */
  debug?: (stage: 'raw' | 'refined', svg: string, layer: string) => void,
): Promise<TraceResult> {
  const startedAt = Date.now();
  const pre = await preprocessImage(buffer, options);
  const { traceWidth, traceHeight, palette } = pre;
  const pixelCount = traceWidth * traceHeight;
  const labels = labelPixels(pre.data, palette);

  const area = new Array<number>(palette.length).fill(0);
  for (const l of labels) if (l >= 0) area[l]++;
  const order = palette.map((_, k) => k).filter((k) => area[k] > 0).sort((a, b) => area[b] - area[a]);
  const rank = new Int16Array(palette.length).fill(-1);
  order.forEach((k, r) => (rank[k] = r));

  const config = buildVectorizerConfig(options, pre.scale);
  const layers: { hex: string; paths: string[] }[] = [];

  for (let r = 0; r < order.length; r++) {
    const color = palette[order[r]];
    // Each layer is traced as a black-on-white mask in VTracer's binary mode,
    // which outputs only the black shapes; the real color is applied below.
    // (Tracing the layer's colors directly, VTracer sometimes gave the
    // surrounding region the layer's color, and transparent surroundings
    // were several times slower.)
    const mask =
      options.stacking === 'stacked'
        ? stackedLayerMask(labels, rank, r, traceWidth, traceHeight, Math.round(STACK_INSET * pre.scale))
        : cutoutLayerMask(labels, rank, r);
    const img = Buffer.alloc(pixelCount * 4, 255);
    for (let p = 0; p < pixelCount; p++) {
      if (mask[p]) img[p * 4] = img[p * 4 + 1] = img[p * 4 + 2] = 0;
    }

    let svg = await vectorizeRaw(img, { width: traceWidth, height: traceHeight }, config);
    debug?.('raw', svg, toHex(color));

    // Geometry pass: bake offsets, scale back to the source size, and (in
    // curve mode) fit lines, curves, corners and perfect circles.
    svg = refineTracedSvg(svg, {
      smoothness: options.smoothness,
      scale: pre.scale,
      width: pre.width,
      height: pre.height,
      curves: options.curveMode === 'spline',
      staircase: options.curveMode === 'spline',
      snapAxes: options.snapAxes,
    });
    debug?.('refined', svg, toHex(color));

    svg = await optimize(svg, { preset: OptimizePreset.Safe, multipass: true, multipassIterations: 2 });
    const paths = (svg.match(/<path\b[^>]*?\/>/g) ?? []).map((path) => path.replace(/\sfill="[^"]*"/, ''));
    if (paths.length > 0) layers.push({ hex: toHex(color), paths });
  }

  const body = layers
    .map(({ hex, paths }) =>
      options.groupByColor
        ? `<g id="color-${hex}" fill="#${hex}">${paths.join('')}</g>`
        : paths.map((path) => path.replace('<path', `<path fill="#${hex}"`)).join(''),
    )
    .join('');
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pre.width}" height="${pre.height}" ` +
    `viewBox="0 0 ${pre.width} ${pre.height}">${body}</svg>`;

  const opaque = area.reduce((sum, a) => sum + a, 0) || 1;
  return {
    svg,
    palette: order.map((k) => ({ color: `#${toHex(palette[k])}`, area: area[k] / opaque })),
    stats: {
      ...svgStats(svg),
      width: pre.width,
      height: pre.height,
      durationMs: Date.now() - startedAt,
    },
  };
}

/**
 * Rasterize an SVG to PNG at `width` pixels wide (height keeps the aspect
 * ratio). Server-side because iPad Safari can't make canvases above ~16.7M
 * pixels, so a 4500px print PNG can't be drawn in the browser there.
 */
export async function renderPng(svg: string, width: number): Promise<Buffer> {
  const input = Buffer.from(svg);
  const { width: baseWidth } = await sharp(input).metadata();
  // Render at the density that produces the target width directly, so the
  // vector is rasterized at full resolution rather than upscaled.
  const density = Math.min(100000, 72 * (width / (baseWidth || width)));
  return sharp(input, { density }).resize({ width }).png({ compressionLevel: 9 }).toBuffer();
}
