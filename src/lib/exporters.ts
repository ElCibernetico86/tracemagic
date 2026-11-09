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

/** iOS Safari refuses canvases larger than this many pixels (4096 × 4096). */
const MAX_CANVAS_PIXELS = 16_777_216;

async function renderPngOnServer(svg: string, width: number): Promise<Blob> {
  const res = await fetch('/api/render-png', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ svg, width }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `PNG export failed (${res.status}).`);
  }
  return res.blob();
}

/**
 * Render the SVG at `targetWidth` pixels wide (height keeps the aspect ratio),
 * transparent background. Sizes beyond the iPad's canvas limit — or any
 * canvas failure — are rendered on the server instead.
 */
export async function svgToPng(svg: string, targetWidth: number): Promise<Blob> {
  const { width, height } = svgSize(svg);
  const outW = Math.max(1, Math.round(targetWidth));
  const outH = Math.max(1, Math.round((targetWidth * height) / width));
  if (outW * outH > MAX_CANVAS_PIXELS) return renderPngOnServer(svg, outW);
  try {
    return await svgToPngInBrowser(svg, width, height, outW, outH);
  } catch {
    return renderPngOnServer(svg, outW);
  }
}

async function svgToPngInBrowser(svg: string, width: number, height: number, outW: number, outH: number): Promise<Blob> {
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

/** Fill or stroke of an element, inherited from ancestor <g> when not set on the path. */
function resolveColorAndStyle(el: Element): { color: string; isStroke: boolean; strokeWidth: number } {
  let color = '#000000';
  let fillAttr: string | null = null;
  let strokeAttr: string | null = null;
  let strokeWidth = 1;

  for (let node: Element | null = el; node; node = node.parentElement) {
    if (fillAttr === null) {
      const f = node.getAttribute('fill') ?? node.getAttribute('style')?.match(/fill:\s*([^;]+)/)?.[1]?.trim();
      if (f) fillAttr = f;
    }
    if (strokeAttr === null) {
      const s = node.getAttribute('stroke') ?? node.getAttribute('style')?.match(/stroke:\s*([^;]+)/)?.[1]?.trim();
      if (s) strokeAttr = s;
    }
    const sw = node.getAttribute('stroke-width');
    if (sw && Number.isFinite( parseFloat(sw))) strokeWidth = parseFloat(sw);
  }

  const isStroke = fillAttr === 'none' && !!strokeAttr && strokeAttr !== 'none';
  if (isStroke && strokeAttr) {
    color = strokeAttr;
  } else if (fillAttr && fillAttr !== 'none') {
    color = fillAttr;
  } else if (strokeAttr && strokeAttr !== 'none') {
    color = strokeAttr;
  }
  return { color, isStroke, strokeWidth };
}

function resolveFill(el: Element): string {
  const { color, isStroke } = resolveColorAndStyle(el);
  if (!isStroke && el.getAttribute('fill') === 'none' && !el.closest('[stroke]')) return 'none';
  return color;
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

// ---------- Vector EPS & PDF Exporters ----------

interface CubicCmd {
  type: 'M' | 'L' | 'C' | 'Z';
  args: number[];
}

/**
 * Convert an SVG path `d` attribute into pure M / L / C / Z commands with
 * Y flipped (`height - y`) for PostScript and PDF coordinate systems.
 * Circular/elliptical arcs (`A`) and quadratics (`Q`/`T`) are converted cleanly.
 */
function pathToPostScriptCmds(d: string, height: number): CubicCmd[] {
  const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
  const cmds: CubicCmd[] = [];
  let cur: Pt = [0, 0];
  let start: Pt = [0, 0];
  let prevCubic: Pt | null = null;
  let prevQuad: Pt | null = null;
  let cmd = '';
  let i = 0;

  const r = (n: number) => Math.round(n * 100) / 100;
  const fy = (y: number) => r(height - y);
  const fx = (x: number) => r(x);

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      cmd = tokens[i++];
      if (cmd === 'Z' || cmd === 'z') {
        cur = start;
        cmds.push({ type: 'Z', args: [] });
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
        cur = abs(a[0], a[1]);
        start = cur;
        cmds.push({ type: 'M', args: [fx(cur[0]), fy(cur[1])] });
        prevCubic = prevQuad = null;
        break;
      case 'L':
        cur = abs(a[0], a[1]);
        cmds.push({ type: 'L', args: [fx(cur[0]), fy(cur[1])] });
        prevCubic = prevQuad = null;
        break;
      case 'H':
        cur = [rel ? cur[0] + a[0] : a[0], cur[1]];
        cmds.push({ type: 'L', args: [fx(cur[0]), fy(cur[1])] });
        prevCubic = prevQuad = null;
        break;
      case 'V':
        cur = [cur[0], rel ? cur[1] + a[0] : a[0]];
        cmds.push({ type: 'L', args: [fx(cur[0]), fy(cur[1])] });
        prevCubic = prevQuad = null;
        break;
      case 'C': {
        const c1 = abs(a[0], a[1]);
        const c2 = abs(a[2], a[3]);
        const p = abs(a[4], a[5]);
        cmds.push({ type: 'C', args: [fx(c1[0]), fy(c1[1]), fx(c2[0]), fy(c2[1]), fx(p[0]), fy(p[1])] });
        prevCubic = c2;
        prevQuad = null;
        cur = p;
        break;
      }
      case 'S': {
        const c1: Pt = prevCubic ? [2 * cur[0] - prevCubic[0], 2 * cur[1] - prevCubic[1]] : cur;
        const c2 = abs(a[0], a[1]);
        const p = abs(a[2], a[3]);
        cmds.push({ type: 'C', args: [fx(c1[0]), fy(c1[1]), fx(c2[0]), fy(c2[1]), fx(p[0]), fy(p[1])] });
        prevCubic = c2;
        prevQuad = null;
        cur = p;
        break;
      }
      case 'Q': {
        const c = abs(a[0], a[1]);
        const p = abs(a[2], a[3]);
        const c1: Pt = [cur[0] + (2 / 3) * (c[0] - cur[0]), cur[1] + (2 / 3) * (c[1] - cur[1])];
        const c2: Pt = [p[0] + (2 / 3) * (c[0] - p[0]), p[1] + (2 / 3) * (c[1] - p[1])];
        cmds.push({ type: 'C', args: [fx(c1[0]), fy(c1[1]), fx(c2[0]), fy(c2[1]), fx(p[0]), fy(p[1])] });
        prevQuad = c;
        prevCubic = null;
        cur = p;
        break;
      }
      case 'T': {
        const c: Pt = prevQuad ? [2 * cur[0] - prevQuad[0], 2 * cur[1] - prevQuad[1]] : cur;
        const p = abs(a[0], a[1]);
        const c1: Pt = [cur[0] + (2 / 3) * (c[0] - cur[0]), cur[1] + (2 / 3) * (c[1] - cur[1])];
        const c2: Pt = [p[0] + (2 / 3) * (c[0] - p[0]), p[1] + (2 / 3) * (c[1] - p[1])];
        cmds.push({ type: 'C', args: [fx(c1[0]), fy(c1[1]), fx(c2[0]), fy(c2[1]), fx(p[0]), fy(p[1])] });
        prevQuad = c;
        prevCubic = null;
        cur = p;
        break;
      }
      case 'A': {
        const p = abs(a[5], a[6]);
        const pts: Pt[] = [];
        arcPoints(cur, a[0], a[1], a[2], a[3], a[4], p, 0.75, pts);
        for (const pt of pts) {
          cmds.push({ type: 'L', args: [fx(pt[0]), fy(pt[1])] });
        }
        prevCubic = prevQuad = null;
        cur = p;
        break;
      }
    }
  }
  return cmds;
}

/**
 * Convert a traced SVG into an Encapsulated PostScript (EPS) vector file,
 * compatible with Adobe Illustrator, Affinity Designer, CorelDRAW, and print RIPs.
 */
export function svgToEps(svg: string): string {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const { width, height } = svgSize(svg);
  const w = Math.ceil(width);
  const h = Math.ceil(height);

  const out: string[] = [
    '%!PS-Adobe-3.0 EPSF-3.0',
    `%%BoundingBox: 0 0 ${w} ${h}`,
    `%%HiResBoundingBox: 0.0 0.0 ${width.toFixed(2)} ${height.toFixed(2)}`,
    '%%Creator: TraceMagic Vector Engine',
    '%%LanguageLevel: 2',
    '%%Pages: 1',
    '%%EndComments',
    '%%BeginProlog',
    '/M { moveto } bind def',
    '/L { lineto } bind def',
    '/C { curveto } bind def',
    '/Z { closepath } bind def',
    '/RGB { setrgbcolor } bind def',
    '%%EndProlog',
    '%%Page: 1 1',
    'gsave',
    '1 setlinejoin 1 setlinecap',
  ];

  for (const path of Array.from(doc.querySelectorAll('path'))) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const { color, isStroke, strokeWidth } = resolveColorAndStyle(path);
    if (color === 'none') continue;
    const [r, g, b] = parseHex(color.startsWith('#') ? color : '#000000').map(
      (v) => Math.round((v / 255) * 1000) / 1000,
    );
    const cmds = pathToPostScriptCmds(d, height);
    if (cmds.length === 0) continue;

    out.push(`${r} ${g} ${b} RGB`);
    out.push('newpath');
    for (const c of cmds) {
      out.push(c.args.length ? `${c.args.join(' ')} ${c.type}` : c.type);
    }
    if (isStroke) {
      out.push(`${strokeWidth} setlinewidth stroke`);
    } else {
      out.push('eofill');
    }
  }

  out.push('grestore', 'showpage', '%%EOF');
  return out.join('\n') + '\n';
}

/**
 * Convert a traced SVG into a standalone, lossless Vector PDF 1.4 document.
 */
export function svgToPdf(svg: string): Blob {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const { width, height } = svgSize(svg);
  const w = Math.round(width * 100) / 100;
  const h = Math.round(height * 100) / 100;

  const streamLines: string[] = ['1 j 1 J'];

  for (const path of Array.from(doc.querySelectorAll('path'))) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const { color, isStroke, strokeWidth } = resolveColorAndStyle(path);
    if (color === 'none') continue;
    const [r, g, b] = parseHex(color.startsWith('#') ? color : '#000000').map(
      (v) => Math.round((v / 255) * 1000) / 1000,
    );
    const cmds = pathToPostScriptCmds(d, height);
    if (cmds.length === 0) continue;

    if (isStroke) {
      streamLines.push(`${r} ${g} ${b} RG ${strokeWidth} w`);
    } else {
      streamLines.push(`${r} ${g} ${b} rg`);
    }

    for (const c of cmds) {
      if (c.type === 'M') streamLines.push(`${c.args.join(' ')} m`);
      else if (c.type === 'L') streamLines.push(`${c.args.join(' ')} l`);
      else if (c.type === 'C') streamLines.push(`${c.args.join(' ')} c`);
      else if (c.type === 'Z') streamLines.push('h');
    }
    streamLines.push(isStroke ? 'S' : 'f*');
  }

  const streamContent = streamLines.join('\n');
  const encoder = new TextEncoder();
  const streamBytes = encoder.encode(streamContent).byteLength;

  const objects = [
    '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj',
    '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj',
    `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Contents 4 0 R >>\nendobj`,
    `4 0 obj\n<< /Length ${streamBytes} >>\nstream\n${streamContent}\nendstream\nendobj`,
  ];

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (const obj of objects) {
    offsets.push(encoder.encode(pdf).byteLength);
    pdf += obj + '\n';
  }
  const xrefOffset = encoder.encode(pdf).byteLength;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;

  return new Blob([pdf], { type: 'application/pdf' });
}

/**
 * Extract anchor points (M, L, C, A endpoints) from an SVG string so the
 * Vector Inspector can overlay control nodes just like Vectorizer.AI.
 */
export function extractSvgNodes(svg: string): Pt[] {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const nodes: Pt[] = [];
  const MAX_NODES = 2500;

  for (const path of Array.from(doc.querySelectorAll('path'))) {
    const d = path.getAttribute('d');
    if (!d) continue;
    const tokens = d.match(/[MLHVCSQTAZmlhvcsqtaz]|[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) ?? [];
    let cur: Pt = [0, 0];
    let start: Pt = [0, 0];
    let cmd = '';
    let i = 0;

    while (i < tokens.length && nodes.length < MAX_NODES) {
      if (/[a-zA-Z]/.test(tokens[i])) {
        cmd = tokens[i++];
        if (cmd === 'Z' || cmd === 'z') {
          cur = start;
          continue;
        }
      } else if (cmd === 'M') cmd = 'L';
      else if (cmd === 'm') cmd = 'l';

      const upper = cmd.toUpperCase();
      const need = ARG_COUNTS[upper];
      if (need === undefined || i + need > tokens.length) break;
      const a = tokens.slice(i, i + need).map(Number);
      i += need;
      const rel = cmd !== upper;
      const abs = (x: number, y: number): Pt => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);

      switch (upper) {
        case 'M':
          cur = abs(a[0], a[1]);
          start = cur;
          nodes.push(cur);
          break;
        case 'L':
          cur = abs(a[0], a[1]);
          nodes.push(cur);
          break;
        case 'H':
          cur = [rel ? cur[0] + a[0] : a[0], cur[1]];
          nodes.push(cur);
          break;
        case 'V':
          cur = [cur[0], rel ? cur[1] + a[0] : a[0]];
          nodes.push(cur);
          break;
        case 'C':
          cur = abs(a[4], a[5]);
          nodes.push(cur);
          break;
        case 'S':
        case 'Q':
          cur = abs(a[2], a[3]);
          nodes.push(cur);
          break;
        case 'T':
          cur = abs(a[0], a[1]);
          nodes.push(cur);
          break;
        case 'A':
          cur = abs(a[5], a[6]);
          nodes.push(cur);
          break;
      }
    }
    if (nodes.length >= MAX_NODES) break;
  }
  return nodes;
}
