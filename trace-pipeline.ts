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
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
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

  const groupByColor = body.groupByColor === 'true' || body.groupByColor === true;
  // Grouping reorders paths by color; only safe when shapes are cut out and never overlap.
  const stacking: ShapeStacking = groupByColor || body.stacking === 'cutout' ? 'cutout' : 'stacked';

  return { mode, maxColors, detail, smoothness, curveMode, stacking, groupByColor };
}

function buildVectorizerConfig(options: TraceOptions, scale: number) {
  // Smooth curves are fitted by our own pass from the exact pixel outline;
  // VTracer's own spline smoothing rounds off corners we then can't recover.
  const pathSimplifyMode =
    options.curveMode === 'polygon' ? PathSimplifyMode.Polygon : PathSimplifyMode.None;

  const speckle = 1 + ((100 - options.detail) / 100) * 15;
  return {
    // B&W is binarized in preprocessing, so VTracer always sees exact colors.
    colorMode: ColorMode.Color,
    colorPrecision: 8,
    filterSpeckle: Math.max(1, Math.round(speckle * scale)),
    spliceThreshold: 45,
    cornerThreshold: 60,
    hierarchical: options.stacking === 'cutout' ? Hierarchical.Cutout : Hierarchical.Stacked,
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
      { maxColors: options.maxColors },
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

/** Snap every path fill to the nearest palette color so the output honors the color limit. */
function snapSvgToPalette(svg: string, palette: [number, number, number][]) {
  if (palette.length === 0) return svg;
  const cache = new Map<string, string>();
  return svg.replace(/fill="#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})"/g, (full, hex: string) => {
    const cached = cache.get(hex);
    if (cached) return cached;
    const expanded =
      hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    const r = parseInt(expanded.slice(0, 2), 16);
    const g = parseInt(expanded.slice(2, 4), 16);
    const b = parseInt(expanded.slice(4, 6), 16);
    let best = palette[0];
    let bestDist = Infinity;
    for (const [pr, pg, pb] of palette) {
      const dist = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2;
      if (dist < bestDist) {
        bestDist = dist;
        best = [pr, pg, pb];
      }
    }
    const toHex = (n: number) => n.toString(16).padStart(2, '0');
    const replacement = `fill="#${toHex(best[0])}${toHex(best[1])}${toHex(best[2])}"`;
    cache.set(hex, replacement);
    return replacement;
  });
}

/**
 * Rewrite a flat list of <path> elements into one <g fill="..."> per color.
 * Callers must ensure shapes don't overlap (cutout stacking), since this reorders paths.
 */
function groupSvgByColor(svg: string) {
  const openMatch = svg.match(/<svg[^>]*>/);
  const closeIdx = svg.lastIndexOf('</svg>');
  if (!openMatch || openMatch.index === undefined || closeIdx === -1) return svg;

  const openTag = openMatch[0];
  const body = svg.slice(openMatch.index + openTag.length, closeIdx);

  const pathRegex = /<path\b[^>]*?(?:\/>|><\/path>)/g;
  const paths = body.match(pathRegex) ?? [];
  const rest = body.replace(pathRegex, '').trim();
  // Anything besides flat paths means an unexpected structure; leave the SVG untouched.
  if (paths.length === 0 || rest.length > 0) return svg;

  const groups = new Map<string, string[]>();
  for (const path of paths) {
    const fillMatch = path.match(/\sfill="([^"]*)"/);
    const fill = fillMatch ? fillMatch[1] : '';
    const cleaned = fillMatch ? path.replace(fillMatch[0], '') : path;
    const bucket = groups.get(fill);
    if (bucket) bucket.push(cleaned);
    else groups.set(fill, [cleaned]);
  }

  const grouped = [...groups.entries()]
    .map(([fill, members]) =>
      fill ? `<g fill="${fill}">${members.join('')}</g>` : members.join(''),
    )
    .join('');

  return svg.slice(0, openMatch.index) + openTag + grouped + '</svg>';
}

function svgStats(svg: string) {
  const paths = (svg.match(/<path[\s>]/g) || []).length;
  const fills = new Set<string>();
  for (const match of svg.matchAll(/fill="([^"]+)"/g)) {
    if (match[1] !== 'none') fills.add(match[1].toLowerCase());
  }
  return { paths, colors: fills.size, bytes: Buffer.byteLength(svg, 'utf8') };
}

function normalizeSvg(svg: string) {
  const trimmed = svg.trim();
  const start = trimmed.indexOf('<svg');
  const end = trimmed.lastIndexOf('</svg>');

  if (start === -1 || end === -1) {
    throw new Error('The vectorizer did not return a valid SVG.');
  }

  let result = trimmed.slice(start, end + '</svg>'.length);

  // Ensure a viewBox so the SVG scales cleanly in previews and editors.
  if (!/viewBox=/.test(result)) {
    const widthMatch = result.match(/<svg[^>]*\swidth="([\d.]+)/);
    const heightMatch = result.match(/<svg[^>]*\sheight="([\d.]+)/);
    if (widthMatch && heightMatch) {
      result = result.replace('<svg', `<svg viewBox="0 0 ${widthMatch[1]} ${heightMatch[1]}"`);
    }
  }

  return result;
}

export interface TraceResult {
  svg: string;
  stats: { paths: number; colors: number; bytes: number; width: number; height: number; durationMs: number };
}

/** Full raster → SVG pipeline. */
export async function traceImage(
  buffer: Buffer,
  options: TraceOptions,
  /** Optional hook to inspect intermediate SVGs (used by bench/). */
  debug?: (stage: 'raw' | 'refined', svg: string) => void,
): Promise<TraceResult> {
  const startedAt = Date.now();
  const pre = await preprocessImage(buffer, options);

  let rawSvg = await vectorizeRaw(
    pre.data,
    { width: pre.traceWidth, height: pre.traceHeight },
    buildVectorizerConfig(options, pre.scale),
  );

  debug?.('raw', rawSvg);

  // Geometry pass: bake offsets, scale back to the source size, and (in
  // curve mode) fit lines, curves, corners and perfect circles.
  rawSvg = refineTracedSvg(rawSvg, {
    smoothness: options.smoothness,
    scale: pre.scale,
    width: pre.width,
    height: pre.height,
    curves: options.curveMode === 'spline',
    staircase: options.curveMode === 'spline',
  });

  debug?.('refined', rawSvg);

  if (pre.palette.length > 0) {
    rawSvg = snapSvgToPalette(rawSvg, pre.palette);
  }

  const optimizedSvg = await optimize(rawSvg, {
    preset: OptimizePreset.Safe,
    multipass: true,
    multipassIterations: 2,
  });

  let svg = normalizeSvg(optimizedSvg || rawSvg);
  if (options.groupByColor) {
    svg = groupSvgByColor(svg);
  }

  return {
    svg,
    stats: {
      ...svgStats(svg),
      width: pre.width,
      height: pre.height,
      durationMs: Date.now() - startedAt,
    },
  };
}
