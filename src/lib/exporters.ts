/**
 * Client-side exports for a traced SVG: high-resolution PNG and DXF.
 */

// ---------- PNG ----------

function svgSize(svg: string): { width: number; height: number } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = doc.documentElement;
  const vb = root.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
  if (vb && vb.length === 4 && vb.every(Number.isFinite)) return { width: vb[2], height: vb[3] };
  return {
    width: parseFloat(root.getAttribute('width') || '0') || 1000,
    height: parseFloat(root.getAttribute('height') || '0') || 1000,
  };
}

/** Render the SVG at `targetWidth` pixels wide (height keeps the aspect ratio), transparent background. */
export async function svgToPng(svg: string, targetWidth: number): Promise<Blob> {
  const { width, height } = svgSize(svg);
  const outW = Math.max(1, Math.round(targetWidth));
  const outH = Math.max(1, Math.round((targetWidth * height) / width));

  // Pin the intrinsic size so the browser rasterizes the vector at full
  // resolution instead of scaling up a small bitmap.
  const sized = svg.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    const cleaned = attrs.replace(/\s(width|height)="[^"]*"/g, '');
    const withViewBox = /viewBox=/.test(cleaned) ? cleaned : `${cleaned} viewBox="0 0 ${width} ${height}"`;
    return `<svg${withViewBox} width="${outW}" height="${outH}">`;
  });

  const url = URL.createObjectURL(new Blob([sized], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error('Could not render the SVG.'));
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas is not available.');
    ctx.drawImage(img, 0, 0, outW, outH);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG encoding failed (image too large?).'))), 'image/png'),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- SVG path flattening ----------

type Pt = [number, number];
interface Polyline {
  points: Pt[];
  closed: boolean;
}

const ARG_COUNTS: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Segments per curve: about one per `tol` units of control-polygon length. */
function segmentsFor(len: number, tol: number) {
  return Math.min(256, Math.max(4, Math.ceil(len / tol)));
}

function cubicPoints(p0: Pt, c1: Pt, c2: Pt, p1: Pt, tol: number, out: Pt[]) {
  const len = Math.hypot(c1[0] - p0[0], c1[1] - p0[1]) + Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) + Math.hypot(p1[0] - c2[0], p1[1] - c2[1]);
  const n = segmentsFor(len, tol);
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ]);
  }
}

function quadPoints(p0: Pt, c: Pt, p1: Pt, tol: number, out: Pt[]) {
  cubicPoints(
    p0,
    [p0[0] + (2 / 3) * (c[0] - p0[0]), p0[1] + (2 / 3) * (c[1] - p0[1])],
    [p1[0] + (2 / 3) * (c[0] - p1[0]), p1[1] + (2 / 3) * (c[1] - p1[1])],
    p1,
    tol,
    out,
  );
}

/** SVG elliptical arc (endpoint form) → points, per the SVG spec's center conversion. */
function arcPoints(p0: Pt, rx: number, ry: number, rotDeg: number, large: number, sweep: number, p1: Pt, tol: number, out: Pt[]) {
  if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) {
    out.push(p1);
    return;
  }
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (rotDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) coef = -coef;
  const cxp = (coef * rx * y1) / ry;
  const cyp = (-coef * ry * x1) / rx;
  const cx = cos * cxp - sin * cyp + (p0[0] + p1[0]) / 2;
  const cy = sin * cxp + cos * cyp + (p0[1] + p1[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const theta1 = angle(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dtheta = angle((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  if (sweep && dtheta < 0) dtheta += 2 * Math.PI;
  const n = segmentsFor(Math.abs(dtheta) * Math.max(rx, ry), tol);
  for (let i = 1; i <= n; i++) {
    const t = theta1 + (dtheta * i) / n;
    const ex = rx * Math.cos(t);
    const ey = ry * Math.sin(t);
    out.push([cos * ex - sin * ey + cx, sin * ex + cos * ey + cy]);
  }
}

/** Parse a path's d attribute into flattened polylines. */
export function flattenSvgPath(d: string, tol = 0.5): Polyline[] {
  const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const result: Polyline[] = [];
  let pts: Pt[] = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let prevCubic: Pt | null = null;
  let prevQuad: Pt | null = null;
  let cmd = '';
  let i = 0;

  const flush = (closed: boolean) => {
    if (pts.length > 1) result.push({ points: pts, closed });
    pts = [];
  };

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === 'Z' || cmd === 'z') {
        cur = start;
        flush(true);
        prevCubic = prevQuad = null;
        continue;
      }
    } else if (cmd === 'M') {
      cmd = 'L';
    } else if (cmd === 'm') {
      cmd = 'l';
    }
    const upper = cmd.toUpperCase();
    const need = ARG_COUNTS[upper];
    if (need === undefined || i + need > tokens.length) break;
    const a = tokens.slice(i, i + need).map(Number);
    i += need;
    const rel = cmd !== upper;
    const abs = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);

    switch (upper) {
      case 'M':
        flush(false);
        cur = abs(a[0], a[1]);
        start = cur;
        pts.push(cur);
        prevCubic = prevQuad = null;
        break;
      case 'L':
        cur = abs(a[0], a[1]);
        pts.push(cur);
        prevCubic = prevQuad = null;
        break;
      case 'H':
        cur = [rel ? cur[0] + a[0] : a[0], cur[1]];
        pts.push(cur);
        prevCubic = prevQuad = null;
        break;
      case 'V':
        cur = [cur[0], rel ? cur[1] + a[0] : a[0]];
        pts.push(cur);
        prevCubic = prevQuad = null;
        break;
      case 'C': {
        const c1 = abs(a[0], a[1]);
        const c2 = abs(a[2], a[3]);
        const p = abs(a[4], a[5]);
        cubicPoints(cur, c1, c2, p, tol, pts);
        prevCubic = c2;
        prevQuad = null;
        cur = p;
        break;
      }
      case 'S': {
        const c1: Pt = prevCubic ? [2 * cur[0] - prevCubic[0], 2 * cur[1] - prevCubic[1]] : cur;
        const c2 = abs(a[0], a[1]);
        const p = abs(a[2], a[3]);
        cubicPoints(cur, c1, c2, p, tol, pts);
        prevCubic = c2;
        prevQuad = null;
        cur = p;
        break;
      }
      case 'Q': {
        const c = abs(a[0], a[1]);
        const p = abs(a[2], a[3]);
        quadPoints(cur, c, p, tol, pts);
        prevQuad = c;
        prevCubic = null;
        cur = p;
        break;
      }
      case 'T': {
        const c: Pt = prevQuad ? [2 * cur[0] - prevQuad[0], 2 * cur[1] - prevQuad[1]] : cur;
        const p = abs(a[0], a[1]);
        quadPoints(cur, c, p, tol, pts);
        prevQuad = c;
        prevCubic = null;
        cur = p;
        break;
      }
      case 'A': {
        const p = abs(a[5], a[6]);
        arcPoints(cur, a[0], a[1], a[2], a[3], a[4], p, tol, pts);
        prevCubic = prevQuad = null;
        cur = p;
        break;
      }
    }
  }
  flush(false);
  return result;
}

// ---------- DXF ----------

/** AutoCAD Color Index entries 1–9 (the ones every DXF reader agrees on). */
const ACI: [number, number, number, number][] = [
  [1, 255, 0, 0],
  [2, 255, 255, 0],
  [3, 0, 255, 0],
  [4, 0, 255, 255],
  [5, 0, 0, 255],
  [6, 255, 0, 255],
  [7, 0, 0, 0],
  [8, 128, 128, 128],
  [9, 192, 192, 192],
];

function nearestAci(hex: string) {
  const [r, g, b] = parseHex(hex);
  let best = 7;
  let bestD = Infinity;
  for (const [idx, ar, ag, ab] of ACI) {
    const d = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2;
    if (d < bestD) {
      bestD = d;
      best = idx;
    }
  }
  return best;
}

function parseHex(color: string): [number, number, number] {
  let h = color.trim().replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  return Number.isFinite(n) ? [(n >> 16) & 255, (n >> 8) & 255, n & 255] : [0, 0, 0];
}

/** Fill of an element, inherited from ancestor <g fill> when not set on the path. */
function resolveFill(el: Element): string {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const fill = node.getAttribute('fill');
    if (fill) return fill;
    const style = node.getAttribute('style')?.match(/fill:\s*([^;]+)/);
    if (style) return style[1].trim();
  }
  return '#000000';
}

export interface DxfResult {
  dxf: string;
  layers: number;
  polylines: number;
}

/**
 * Convert the traced SVG to an R12 ASCII DXF: every shape outline becomes a
 * closed POLYLINE on a layer named after its fill color. 1 DXF unit = 1 SVG
 * unit (source pixel); Y is flipped because DXF's Y axis points up.
 */
export function svgToDxf(svg: string, tolerance = 0.25): DxfResult {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const { height } = svgSize(svg);
  const lines: string[] = [];
  const g = (code: number, value: string | number) => lines.push(String(code), typeof value === 'number' ? fmt(value) : value);
  const fmt = (n: number) => (Math.round(n * 1000) / 1000).toString();

  const layerColors = new Map<string, number>();
  const entities: { layer: string; poly: Polyline }[] = [];
  let maxX = 0;
  let maxY = 0;

  for (const path of Array.from(doc.querySelectorAll('path'))) {
    const fill = resolveFill(path);
    if (fill === 'none') continue;
    const d = path.getAttribute('d');
    if (!d) continue;
    // Normalize (#fff → FFFFFF) so each color maps to exactly one layer name.
    const hex = parseHex(fill.startsWith('#') ? fill : '#000000')
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
    const layer = `COLOR_${hex}`;
    if (!layerColors.has(layer)) layerColors.set(layer, nearestAci(`#${hex}`));
    for (const poly of flattenSvgPath(d, tolerance)) {
      entities.push({ layer, poly });
      for (const [x, y] of poly.points) {
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, height - y);
      }
    }
  }

  g(0, 'SECTION'); g(2, 'HEADER');
  g(9, '$ACADVER'); g(1, 'AC1009');
  g(9, '$EXTMIN'); g(10, 0); g(20, 0);
  g(9, '$EXTMAX'); g(10, maxX); g(20, maxY);
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'TABLES');
  g(0, 'TABLE'); g(2, 'LTYPE'); g(70, 1);
  g(0, 'LTYPE'); g(2, 'CONTINUOUS'); g(70, 0); g(3, 'Solid line'); g(72, 65); g(73, 0); g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE'); g(2, 'LAYER'); g(70, layerColors.size);
  for (const [name, aci] of layerColors) {
    g(0, 'LAYER'); g(2, name); g(70, 0); g(62, aci); g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  g(0, 'SECTION'); g(2, 'ENTITIES');
  for (const { layer, poly } of entities) {
    const pts = poly.points;
    // Drop a duplicated closing vertex; the closed flag joins the ends.
    const last = pts[pts.length - 1];
    const n = poly.closed && pts.length > 2 && Math.hypot(last[0] - pts[0][0], last[1] - pts[0][1]) < 1e-6 ? pts.length - 1 : pts.length;
    g(0, 'POLYLINE'); g(8, layer); g(66, 1); g(70, poly.closed ? 1 : 0); g(10, 0); g(20, 0); g(30, 0);
    for (let k = 0; k < n; k++) {
      g(0, 'VERTEX'); g(8, layer); g(10, pts[k][0]); g(20, height - pts[k][1]); g(30, 0);
    }
    g(0, 'SEQEND'); g(8, layer);
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');

  return { dxf: lines.join('\n') + '\n', layers: layerColors.size, polylines: entities.length };
}
