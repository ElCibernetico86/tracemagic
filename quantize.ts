/**
 * Logo-grade color quantization.
 *
 * The goal is the behaviour of commercial vectorizers on flat art: every pixel
 * ends up as one of a small set of exact palette colors, and anti-aliased /
 * JPEG-noisy edge pixels never become colors of their own.
 *
 *  1. Palette discovery runs on the source image, skipping "blend" pixels
 *     (pixels whose color lies between two neighbors — anti-aliasing) so the
 *     palette only contains colors that actually fill areas.
 *  2. Each source pixel gets a candidate set: the palette colors present among
 *     non-blend pixels nearby. An edge pixel between yellow and navy can only
 *     become yellow or navy, never a third color that happens to be closer.
 *  3. Labels are assigned on a smoothly *upscaled* copy of the image. The
 *     interpolated edge ramps put each color boundary at its sub-pixel
 *     position, which is where the extra edge precision comes from.
 */

export type RGB = [number, number, number];

interface RawImage {
  data: Buffer;
  width: number;
  height: number;
}

export interface QuantizeOptions {
  /** Hard cap on palette size; null picks automatically. */
  maxColors: number | null;
  /** Use exactly these colors (the user's chosen palette) instead of detecting one. */
  palette?: RGB[] | null;
}

export interface QuantizeResult {
  /** RGBA at the upscaled size, every opaque pixel exactly a palette color. */
  data: Buffer;
  palette: RGB[];
}

const MAX_PALETTE = 64;
/** ΔE below which two detected colors are treated as the same ink. */
const MERGE_DELTA_E = 9;
/** ΔE within which a much smaller color is absorbed as a tint of a big one. */
const SATELLITE_DELTA_E = 20;
const OPAQUE = 128;

// ---------- color space ----------

const SRGB_TO_LINEAR = new Float64Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  SRGB_TO_LINEAR[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function labF(t: number) {
  return t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
}

/** sRGB (0–255) → CIELAB (D65), written into out[o..o+2]. */
function rgbToLab(r: number, g: number, b: number, out: Float64Array, o: number) {
  const lr = SRGB_TO_LINEAR[r];
  const lg = SRGB_TO_LINEAR[g];
  const lb = SRGB_TO_LINEAR[b];
  const x = labF((lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047);
  const y = labF(lr * 0.2126 + lg * 0.7152 + lb * 0.0722);
  const z = labF((lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883);
  out[o] = 116 * y - 16;
  out[o + 1] = 500 * (x - y);
  out[o + 2] = 200 * (y - z);
}

// ---------- step 1: blend detection ----------

/**
 * A pixel is a blend when, along some direction, it sits between two
 * distinctly different neighbors (|a-c| + |c-b| ≈ |a-b|). Thin lines are not
 * blends — they differ from both neighbors in the same direction.
 */
function findBlendPixels(img: RawImage): Uint8Array {
  const { data, width: w, height: h } = img;
  const blend = new Uint8Array(w * h);
  const dirs = [
    [1, 0], [0, 1], [1, 1], [1, -1],
    [2, 0], [0, 2], [2, 2], [2, -2],
  ];
  const d3 = (i: number, j: number) => {
    const dr = data[i] - data[j];
    const dg = data[i + 1] - data[j + 1];
    const db = data[i + 2] - data[j + 2];
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      const ci = p * 4;
      if (data[ci + 3] < OPAQUE) continue;
      for (const [dx, dy] of dirs) {
        const ax = x - dx, ay = y - dy, bx = x + dx, by = y + dy;
        if (ax < 0 || ay < 0 || ay >= h || bx >= w || by < 0 || by >= h || ax >= w || bx < 0) continue;
        const ai = (ay * w + ax) * 4;
        const bi = (by * w + bx) * 4;
        if (data[ai + 3] < OPAQUE || data[bi + 3] < OPAQUE) continue;
        const ab = d3(ai, bi);
        if (ab < 40) continue;
        const ac = d3(ai, ci);
        const cb = d3(ci, bi);
        if (ac > 12 && cb > 12 && ac + cb <= ab * 1.12) {
          blend[p] = 1;
          break;
        }
      }
    }
  }
  return blend;
}

/**
 * Interior pixels: all 8 neighbors are (nearly) the same color. Every real
 * ink in a logo has some; JPEG ringing and edge halos have none.
 */
function findInteriorPixels(img: RawImage): Uint8Array {
  const { data, width: w, height: h } = img;
  const interior = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const ci = (y * w + x) * 4;
      if (data[ci + 3] < OPAQUE) continue;
      let flat = true;
      for (let dy = -1; dy <= 1 && flat; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const ni = ((y + dy) * w + x + dx) * 4;
          if (
            Math.abs(data[ni] - data[ci]) > 18 ||
            Math.abs(data[ni + 1] - data[ci + 1]) > 18 ||
            Math.abs(data[ni + 2] - data[ci + 2]) > 18 ||
            data[ni + 3] < OPAQUE
          ) {
            flat = false;
            break;
          }
        }
      }
      if (flat) interior[y * w + x] = 1;
    }
  }
  return interior;
}

// ---------- step 2: palette discovery ----------

interface Cluster {
  lab: [number, number, number];
  rgbSum: [number, number, number];
  weight: number;
  /** How many of the cluster's pixels are interior (solid-area) pixels. */
  interior: number;
}

function deltaE(a: ArrayLike<number>, b: ArrayLike<number>) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** Lightness-weighted color distance used to spot compression tints. */
function tintDistance(a: ArrayLike<number>, b: ArrayLike<number>) {
  const dl = a[0] - b[0];
  const da = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(4 * dl * dl + 0.4 * (da * da + db * db));
}

function discoverPalette(img: RawImage, blend: Uint8Array, interior: Uint8Array, maxColors: number | null): RGB[] {
  const { data, width: w, height: h } = img;

  // Histogram of non-blend opaque pixels in 5-bit RGB bins.
  const bins = new Map<number, { count: number; interior: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (data[i + 3] < OPAQUE || blend[p]) continue;
    const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
    let bin = bins.get(key);
    if (!bin) bins.set(key, (bin = { count: 0, interior: 0, r: 0, g: 0, b: 0 }));
    bin.count++;
    bin.interior += interior[p];
    bin.r += data[i];
    bin.g += data[i + 1];
    bin.b += data[i + 2];
    total++;
  }
  if (total === 0) return [];

  const entries = [...bins.values()]
    .sort((a, b) => b.count - a.count)
    .map((bin) => {
      const rgb: RGB = [bin.r / bin.count, bin.g / bin.count, bin.b / bin.count];
      const lab = new Float64Array(3);
      rgbToLab(Math.round(rgb[0]), Math.round(rgb[1]), Math.round(rgb[2]), lab, 0);
      return { rgb, lab, count: bin.count, interior: bin.interior };
    });

  // Greedy seeding: most common colors first, each new color must be distinct.
  let clusters: Cluster[] = [];
  for (const e of entries) {
    let best: Cluster | null = null;
    let bestD = Infinity;
    for (const c of clusters) {
      const d = deltaE(e.lab, c.lab);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best && bestD < MERGE_DELTA_E) continue;
    if (clusters.length >= 256) continue;
    clusters.push({ lab: [e.lab[0], e.lab[1], e.lab[2]], rgbSum: [0, 0, 0], weight: 0, interior: 0 });
  }

  // A few k-means passes over the bins to center each cluster on its ink.
  for (let iter = 0; iter < 4; iter++) {
    for (const c of clusters) { c.rgbSum = [0, 0, 0]; c.weight = 0; c.interior = 0; }
    const labSums = clusters.map(() => [0, 0, 0]);
    for (const e of entries) {
      let bi = 0;
      let bd = Infinity;
      for (let k = 0; k < clusters.length; k++) {
        const d = deltaE(e.lab, clusters[k].lab);
        if (d < bd) { bd = d; bi = k; }
      }
      const c = clusters[bi];
      c.weight += e.count;
      c.interior += e.interior;
      c.rgbSum[0] += e.rgb[0] * e.count;
      c.rgbSum[1] += e.rgb[1] * e.count;
      c.rgbSum[2] += e.rgb[2] * e.count;
      labSums[bi][0] += e.lab[0] * e.count;
      labSums[bi][1] += e.lab[1] * e.count;
      labSums[bi][2] += e.lab[2] * e.count;
    }
    clusters.forEach((c, k) => {
      if (c.weight > 0) c.lab = [labSums[k][0] / c.weight, labSums[k][1] / c.weight, labSums[k][2] / c.weight];
    });
    clusters = clusters.filter((c) => c.weight > 0);
  }

  /**
   * Absorb `small` into `big`. The output color always stays big's exact
   * color — merging never invents an in-between shade. 'pool' still moves
   * big's comparison point (lab) toward the merged pixels, which keeps later
   * tint detection working; 'absorb' (tints) leaves it untouched.
   */
  const mergeInto = (big: Cluster, small: Cluster, mode: 'pool' | 'absorb') => {
    const wsum = big.weight + small.weight;
    if (mode === 'pool') {
      big.lab = [
        (big.lab[0] * big.weight + small.lab[0] * small.weight) / wsum,
        (big.lab[1] * big.weight + small.lab[1] * small.weight) / wsum,
        (big.lab[2] * big.weight + small.lab[2] * small.weight) / wsum,
      ];
    }
    const f = wsum / big.weight;
    big.rgbSum = [big.rgbSum[0] * f, big.rgbSum[1] * f, big.rgbSum[2] * f];
    big.weight = wsum;
    big.interior += small.interior;
    clusters = clusters.filter((c) => c !== small);
  };

  const closestPair = () => {
    let best: [Cluster, Cluster] | null = null;
    let bestD = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const d = deltaE(clusters[i].lab, clusters[j].lab);
        if (d < bestD) { bestD = d; best = [clusters[i], clusters[j]]; }
      }
    }
    return { pair: best, d: bestD };
  };

  // 1. Colors closer than the merge distance are the same ink. Merges keep
  //    the larger color exactly (never an average), so no new shade appears
  //    that isn't in the image.
  for (;;) {
    const { pair, d } = closestPair();
    if (!pair || d >= MERGE_DELTA_E) break;
    const [a, b] = pair[0].weight >= pair[1].weight ? pair : [pair[1], pair[0]];
    mergeInto(a, b, 'pool');
  }

  // 2. Satellites: a small color near a much larger one is a compression tint
  //    of it (JPEG stores color at half resolution, so tints bleed past edges).
  //    Tints keep the host's lightness and drift in hue, so the comparison
  //    weights lightness up and chroma down.
  for (const small of [...clusters].sort((a, b) => a.weight - b.weight)) {
    let host: Cluster | null = null;
    let hostD = Infinity;
    for (const c of clusters) {
      if (c === small || c.weight < small.weight * 12) continue;
      const d = tintDistance(c.lab, small.lab);
      if (d < hostD) { hostD = d; host = c; }
    }
    if (host && hostD < SATELLITE_DELTA_E) mergeInto(host, small, 'absorb');
  }

  // 3. Drop colors that don't fill any solid area (JPEG ringing, edge halos,
  //    specks). Colors without solid interior still count if there's enough of
  //    them: thin lines and small text never have interior pixels.
  const minInterior = Math.max(4, total * 0.0002);
  const minWeight = Math.max(8, total * 0.0004);
  const keep = clusters.filter(
    (c) => c.weight >= minWeight && (c.interior >= minInterior || c.weight >= total * 0.0015),
  );
  clusters = keep.length > 0 ? keep : clusters;

  // 4. Respect the color limit: merge the cheapest pair (Ward-style cost, so
  //    absorbing a small area beats merging two big ones).
  const limit = Math.min(MAX_PALETTE, maxColors ?? MAX_PALETTE);
  while (clusters.length > limit) {
    let best: [Cluster, Cluster] | null = null;
    let bestCost = Infinity;
    for (let i = 0; i < clusters.length; i++) {
      for (let j = i + 1; j < clusters.length; j++) {
        const a = clusters[i], b = clusters[j];
        const d = deltaE(a.lab, b.lab);
        const cost = ((a.weight * b.weight) / (a.weight + b.weight)) * d * d;
        if (cost < bestCost) { bestCost = cost; best = [a, b]; }
      }
    }
    if (!best) break;
    const [a, b] = best[0].weight >= best[1].weight ? best : [best[1], best[0]];
    mergeInto(a, b, 'pool');
  }

  return clusters
    .sort((a, b) => b.weight - a.weight)
    .map((c) => [
      Math.round(c.rgbSum[0] / c.weight),
      Math.round(c.rgbSum[1] / c.weight),
      Math.round(c.rgbSum[2] / c.weight),
    ] as RGB);
}

// ---------- step 3: candidate sets + sub-pixel assignment ----------

/**
 * Lightness is weighted above chroma when assigning pixels: JPEG keeps
 * lightness at full resolution but chroma at half, so edges located by
 * lightness are sharper and less blocky.
 */
const L_WEIGHT = 2;

/**
 * Near-ties between a locally dominant color and a minority color go to the
 * minority (its squared distance is scaled by this). Thin lines antialiased
 * across two pixels sit at ~50% and would otherwise break into dashes.
 */
const MINORITY_FAVOR = 0.6;

function nearestLabel(lab: Float64Array, paletteLab: Float64Array, lo: number, hi: number, majority = -1) {
  // lo/hi: 32-bit candidate masks for labels 0–31 / 32–63.
  let best = -1;
  let bestD = Infinity;
  const n = paletteLab.length / 3;
  for (let k = 0; k < n; k++) {
    const bit = k < 32 ? (lo >>> k) & 1 : (hi >>> (k - 32)) & 1;
    if (!bit) continue;
    const dl = lab[0] - paletteLab[k * 3];
    const da = lab[1] - paletteLab[k * 3 + 1];
    const db = lab[2] - paletteLab[k * 3 + 2];
    let d = L_WEIGHT * dl * dl + da * da + db * db;
    if (majority >= 0 && k !== majority) d *= MINORITY_FAVOR;
    if (d < bestD) { bestD = d; best = k; }
  }
  return best;
}

/**
 * @param source  the image at its working resolution (palette + candidates)
 * @param upscaled the same image resized smoothly to the trace resolution
 */
export function quantizeForTrace(source: RawImage, upscaled: RawImage, options: QuantizeOptions): QuantizeResult {
  const { width: w, height: h, data } = source;
  const blend = findBlendPixels(source);
  const interior = findInteriorPixels(source);
  const palette =
    options.palette && options.palette.length > 0
      ? options.palette.slice(0, MAX_PALETTE)
      : discoverPalette(source, blend, interior, options.maxColors);

  const out = Buffer.alloc(upscaled.width * upscaled.height * 4);
  if (palette.length === 0) return { data: out, palette };

  const paletteLab = new Float64Array(palette.length * 3);
  palette.forEach(([r, g, b], k) => rgbToLab(r, g, b, paletteLab, k * 3));
  const allLo = palette.length >= 32 ? 0xffffffff : (2 ** palette.length - 1) >>> 0;
  const allHi = palette.length > 32 ? ((2 ** (palette.length - 32) - 1) >>> 0) : 0;

  // Label every non-blend source pixel, then OR the labels over a 5×5 window.
  const lab = new Float64Array(3);
  const maskLo = new Uint32Array(w * h);
  const maskHi = new Uint32Array(w * h);
  const srcLabel = new Int8Array(w * h).fill(-1);
  for (let p = 0; p < w * h; p++) {
    const i = p * 4;
    if (data[i + 3] < OPAQUE || blend[p]) continue;
    rgbToLab(data[i], data[i + 1], data[i + 2], lab, 0);
    const k = nearestLabel(lab, paletteLab, allLo, allHi);
    srcLabel[p] = k;
    if (k < 32) maskLo[p] = (1 << k) >>> 0;
    else maskHi[p] = (1 << (k - 32)) >>> 0;
  }
  const R = 2;

  // Locally dominant color per source pixel (mode of solid labels in 5×5).
  const majority = new Int8Array(w * h).fill(-1);
  {
    const counts = new Int32Array(palette.length);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        counts.fill(0);
        for (let dy = -R; dy <= R; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -R; dx <= R; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const l = srcLabel[yy * w + xx];
            if (l >= 0) counts[l]++;
          }
        }
        let best = -1, bestCount = 0;
        for (let k = 0; k < counts.length; k++) if (counts[k] > bestCount) { bestCount = counts[k]; best = k; }
        majority[y * w + x] = best;
      }
    }
  }
  const tmpLo = new Uint32Array(w * h);
  const tmpHi = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let lo = 0, hi = 0;
      for (let dx = -R; dx <= R; dx++) {
        const xx = x + dx;
        if (xx < 0 || xx >= w) continue;
        lo |= maskLo[y * w + xx];
        hi |= maskHi[y * w + xx];
      }
      tmpLo[y * w + x] = lo >>> 0;
      tmpHi[y * w + x] = hi >>> 0;
    }
  }
  const candLo = new Uint32Array(w * h);
  const candHi = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let lo = 0, hi = 0;
      for (let dy = -R; dy <= R; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        lo |= tmpLo[yy * w + x];
        hi |= tmpHi[yy * w + x];
      }
      // No solid neighbors at all (e.g. inside a gradient): allow everything.
      if (lo === 0 && hi === 0) { lo = allLo; hi = allHi; }
      candLo[y * w + x] = lo >>> 0;
      candHi[y * w + x] = hi >>> 0;
    }
  }

  // Assign at the upscaled resolution.
  const U = upscaled;
  const sx = w / U.width;
  const sy = h / U.height;
  for (let y = 0; y < U.height; y++) {
    const srcY = Math.min(h - 1, Math.floor((y + 0.5) * sy));
    for (let x = 0; x < U.width; x++) {
      const i = (y * U.width + x) * 4;
      if (U.data[i + 3] < OPAQUE) continue; // stays transparent
      const srcX = Math.min(w - 1, Math.floor((x + 0.5) * sx));
      const sp = srcY * w + srcX;
      rgbToLab(U.data[i], U.data[i + 1], U.data[i + 2], lab, 0);
      let k = nearestLabel(lab, paletteLab, candLo[sp], candHi[sp], majority[sp]);
      if (k < 0) k = nearestLabel(lab, paletteLab, allLo, allHi);
      const [r, g, b] = palette[k];
      out[i] = r;
      out[i + 1] = g;
      out[i + 2] = b;
      out[i + 3] = 255;
    }
  }

  return { data: out, palette };
}

// ---------- step 4: boundary smoothing ----------

/**
 * Smooth region boundaries without changing colors: blur each color's mask
 * and give every pixel to the color with the strongest blurred presence.
 * Removes sub-pixel jitter (JPEG noise, staircase) along edges; features
 * thinner than ~sigma get slightly thinner but survive. Corners soften a
 * little — the geometry pass restores them.
 *
 * @param sigma blur radius in trace pixels
 */
export async function smoothRegionBoundaries(
  data: Buffer,
  width: number,
  height: number,
  palette: RGB[],
  sigma: number,
): Promise<Buffer> {
  if (sigma < 0.3 || palette.length === 0) return data;
  const sharp = (await import('sharp')).default;
  const n = width * height;
  const TRANSPARENT = palette.length;

  const index = new Map<number, number>();
  palette.forEach(([r, g, b], k) => index.set((r << 16) | (g << 8) | b, k));
  const labels = new Uint8Array(n);
  const present = new Set<number>();
  for (let p = 0; p < n; p++) {
    const i = p * 4;
    const k = data[i + 3] < OPAQUE ? TRANSPARENT : index.get((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    labels[p] = k ?? TRANSPARENT;
    present.add(labels[p]);
  }
  if (present.size < 2) return data;

  const bestVal = new Uint8Array(n);
  const bestLabel = new Uint8Array(n).fill(255);
  // Blur three label masks per pass, one per RGB channel.
  const ks = [...present];
  const mask = Buffer.alloc(n * 3);
  for (let g = 0; g < ks.length; g += 3) {
    const group = ks.slice(g, g + 3);
    mask.fill(0);
    for (let p = 0; p < n; p++) {
      const c = group.indexOf(labels[p]);
      if (c >= 0) mask[p * 3 + c] = 255;
    }
    const blurred = await sharp(mask, { raw: { width, height, channels: 3 } })
      .blur(sigma)
      .raw()
      .toBuffer();
    group.forEach((k, c) => {
      for (let p = 0; p < n; p++) {
        const v = blurred[p * 3 + c];
        // Ties keep the original label, so flat areas never change.
        if (v > bestVal[p] || (v === bestVal[p] && labels[p] === k)) {
          bestVal[p] = v;
          bestLabel[p] = k;
        }
      }
    });
  }

  const out = Buffer.alloc(n * 4);
  for (let p = 0; p < n; p++) {
    const k = bestLabel[p];
    if (k === TRANSPARENT || k === 255) continue;
    const [r, g, b] = palette[k];
    out[p * 4] = r;
    out[p * 4 + 1] = g;
    out[p * 4 + 2] = b;
    out[p * 4 + 3] = 255;
  }
  return out;
}
