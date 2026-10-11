import { fitCubic } from 'fit-curve';

/**
 * Post-trace quality pass:
 *  - re-fits VTracer's fragmented micro-Bezier output into long smooth curves
 *    (Schneider's algorithm), splitting only at genuine corners
 *  - snaps closed paths that are circles-within-tolerance to perfect circles
 *
 * Operates on the raw VTracer SVG (a flat list of <path> elements with
 * absolute M/L/C/Q commands). Any path it can't confidently handle is left
 * untouched.
 */

interface Point {
  x: number;
  y: number;
}

interface Subpath {
  points: Point[];
  closed: boolean;
}

export interface RefineOptions {
  /** 0–100, same scale as the trace smoothness setting */
  smoothness: number;
  /** Trace resolution ÷ output resolution; coordinates are divided by this. */
  scale?: number;
  /** Output canvas size (original image pixels). */
  width?: number;
  height?: number;
  /** false: keep straight polygon segments, only rescale. */
  curves?: boolean;
  /** Input is a pixel-staircase outline; smooth the steps before fitting. */
  staircase?: boolean;
}

const round = (n: number) => Math.round(n * 100) / 100;

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function sampleCubic(p0: Point, c1: Point, c2: Point, p1: Point, out: Point[]) {
  const approxLen = dist(p0, c1) + dist(c1, c2) + dist(c2, p1);
  const steps = Math.min(48, Math.max(4, Math.ceil(approxLen / 2)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const u = 1 - t;
    out.push({
      x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
      y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
    });
  }
}

function sampleQuadratic(p0: Point, c: Point, p1: Point, out: Point[]) {
  sampleCubic(
    p0,
    { x: p0.x + (2 / 3) * (c.x - p0.x), y: p0.y + (2 / 3) * (c.y - p0.y) },
    { x: p1.x + (2 / 3) * (c.x - p1.x), y: p1.y + (2 / 3) * (c.y - p1.y) },
    p1,
    out,
  );
}

/** Parse a path's d attribute and flatten every subpath to a polyline. Returns null on anything unsupported. */
function flattenPath(d: string): Subpath[] | null {
  const tokens = d.match(/[MLHVCSQTZmlhvcsqtz]|-?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g);
  if (!tokens) return null;

  const argCounts: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, Z: 0 };
  const subpaths: Subpath[] = [];
  let points: Point[] = [];
  let cur: Point = { x: 0, y: 0 };
  let start: Point = { x: 0, y: 0 };
  let prevCtrl: Point | null = null;
  let i = 0;
  let cmd = '';

  const flush = (closed: boolean) => {
    if (points.length > 1) subpaths.push({ points, closed });
    points = [];
  };

  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) {
      cmd = tokens[i++];
    } else if (!cmd) {
      return null;
    } else if (cmd === 'M') {
      cmd = 'L'; // implicit lineto after moveto
    } else if (cmd === 'm') {
      cmd = 'l';
    }

    const upper = cmd.toUpperCase();
    const rel = cmd !== upper;
    const need = argCounts[upper];
    if (need === undefined) return null;
    if (i + need > tokens.length) return null;

    const args: number[] = [];
    for (let k = 0; k < need; k++) {
      const v = parseFloat(tokens[i + k]);
      if (!Number.isFinite(v)) return null;
      args.push(v);
    }
    i += need;

    const abs = (x: number, y: number): Point => (rel ? { x: cur.x + x, y: cur.y + y } : { x, y });

    switch (upper) {
      case 'M': {
        flush(false);
        cur = abs(args[0], args[1]);
        start = cur;
        points.push(cur);
        prevCtrl = null;
        break;
      }
      case 'L': {
        cur = abs(args[0], args[1]);
        points.push(cur);
        prevCtrl = null;
        break;
      }
      case 'H': {
        cur = { x: rel ? cur.x + args[0] : args[0], y: cur.y };
        points.push(cur);
        prevCtrl = null;
        break;
      }
      case 'V': {
        cur = { x: cur.x, y: rel ? cur.y + args[0] : args[0] };
        points.push(cur);
        prevCtrl = null;
        break;
      }
      case 'C': {
        const c1 = abs(args[0], args[1]);
        const c2 = abs(args[2], args[3]);
        const p1 = abs(args[4], args[5]);
        sampleCubic(cur, c1, c2, p1, points);
        prevCtrl = c2;
        cur = p1;
        break;
      }
      case 'S': {
        const c1 = prevCtrl ? { x: 2 * cur.x - prevCtrl.x, y: 2 * cur.y - prevCtrl.y } : cur;
        const c2 = abs(args[0], args[1]);
        const p1 = abs(args[2], args[3]);
        sampleCubic(cur, c1, c2, p1, points);
        prevCtrl = c2;
        cur = p1;
        break;
      }
      case 'Q': {
        const c = abs(args[0], args[1]);
        const p1 = abs(args[2], args[3]);
        sampleQuadratic(cur, c, p1, points);
        prevCtrl = c;
        cur = p1;
        break;
      }
      case 'T': {
        const c = prevCtrl ? { x: 2 * cur.x - prevCtrl.x, y: 2 * cur.y - prevCtrl.y } : cur;
        const p1 = abs(args[0], args[1]);
        sampleQuadratic(cur, c, p1, points);
        prevCtrl = c;
        cur = p1;
        break;
      }
      case 'Z': {
        cur = start;
        flush(true);
        prevCtrl = null;
        break;
      }
    }
  }
  flush(false);

  // Dedup near-identical consecutive points; drop a duplicated closing point.
  for (const sub of subpaths) {
    const deduped: Point[] = [];
    for (const p of sub.points) {
      if (deduped.length === 0 || dist(deduped[deduped.length - 1], p) > 0.25) deduped.push(p);
    }
    if (sub.closed && deduped.length > 1 && dist(deduped[0], deduped[deduped.length - 1]) <= 0.25) {
      deduped.pop();
    }
    sub.points = deduped;
  }

  return subpaths.filter((s) => s.points.length > 1);
}

interface CornerCluster {
  from: number;
  to: number;
  apex: number;
}

/** Vertex reached after walking ~targetDist along the polyline from idx. */
function walkVertex(pts: Point[], idx: number, targetDist: number, dir: 1 | -1, closed: boolean): Point | null {
  const n = pts.length;
  let cur = idx;
  let walked = 0;
  for (let s = 0; s < n; s++) {
    let next = cur + dir;
    if (closed) next = ((next % n) + n) % n;
    else if (next < 0 || next >= n) return null;
    walked += dist(pts[cur], pts[next]);
    cur = next;
    if (walked >= targetDist) return pts[cur];
  }
  return null;
}

/**
 * Reconstruct the true corner position by intersecting the tangents of the
 * two edges entering the rounded cluster — the tracer clips sharp tips into
 * small arcs, and this puts the point back.
 */
function restoreCorner(
  pts: Point[],
  cluster: CornerCluster,
  closed: boolean,
  /** How far along each edge to sample its direction (px); kept short of the neighboring corners. */
  reachBefore = 3,
  reachAfter = 3,
): Point | null {
  if (reachBefore < 1.5 || reachAfter < 1.5) return null;
  const a1 = walkVertex(pts, cluster.from, 0.5, -1, closed);
  const a2 = walkVertex(pts, cluster.from, reachBefore, -1, closed);
  const b1 = walkVertex(pts, cluster.to, 0.5, 1, closed);
  const b2 = walkVertex(pts, cluster.to, reachAfter, 1, closed);
  if (!a1 || !a2 || !b1 || !b2) return null;

  const dax = a1.x - a2.x;
  const day = a1.y - a2.y;
  const dbx = b1.x - b2.x;
  const dby = b1.y - b2.y;
  const det = dax * dby - day * dbx;
  if (Math.abs(det) < 1e-6) return null;

  const t = ((b1.x - a1.x) * dby - (b1.y - a1.y) * dbx) / det;
  if (t < 0) return null; // lines meet behind the edge: not a convex corner
  const ix = a1.x + t * dax;
  const iy = a1.y + t * day;

  const apexPt = pts[cluster.apex];
  if (Math.hypot(ix - apexPt.x, iy - apexPt.y) > 4) return null; // implausibly far: nearly parallel edges
  return { x: ix, y: iy };
}

/**
 * Square end cap for a U-turn (the end of a thin stroke, rounded off by
 * smoothing): the two sides are extended to a flat end at the stroke's tip.
 * Returns the two cap corners, or null when the sides aren't parallel enough.
 */
function squareCap(pts: Point[], cluster: CornerCluster, closed: boolean, reachBefore: number, reachAfter: number): Point[] | null {
  if (reachBefore < 1 || reachAfter < 1) return null;
  const a1 = walkVertex(pts, cluster.from, 0.25, -1, closed);
  const a2 = walkVertex(pts, cluster.from, reachBefore, -1, closed);
  const b1 = walkVertex(pts, cluster.to, 0.25, 1, closed);
  const b2 = walkVertex(pts, cluster.to, reachAfter, 1, closed);
  if (!a1 || !a2 || !b1 || !b2) return null;
  const dA = { x: a1.x - a2.x, y: a1.y - a2.y }; // along side A, toward the tip
  const dB = { x: b1.x - b2.x, y: b1.y - b2.y }; // along side B, toward the tip
  const mA = Math.hypot(dA.x, dA.y);
  const mB = Math.hypot(dB.x, dB.y);
  if (mA < 1e-6 || mB < 1e-6) return null;
  dA.x /= mA; dA.y /= mA; dB.x /= mB; dB.y /= mB;
  if (dA.x * dB.x + dA.y * dB.y < 0.9) return null; // sides must run (nearly) parallel

  const u = { x: dA.x + dB.x, y: dA.y + dB.y };
  const mu = Math.hypot(u.x, u.y);
  u.x /= mu; u.y /= mu;
  // The tip: the farthest sample along the stroke direction.
  let tip = -Infinity;
  const n = pts.length;
  for (let i = cluster.apex - 6; i <= cluster.apex + 6; i++) {
    const p = pts[closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i))];
    tip = Math.max(tip, p.x * u.x + p.y * u.y);
  }
  const onCap = (p: Point, d: Point) => {
    const t = (tip - (p.x * u.x + p.y * u.y)) / (d.x * u.x + d.y * u.y);
    return t >= -0.5 && t <= 4 ? { x: p.x + t * d.x, y: p.y + t * d.y } : null;
  };
  const c1 = onCap(a1, dA);
  const c2 = onCap(b1, dB);
  if (!c1 || !c2 || dist(c1, c2) > 6) return null;
  return [c1, c2];
}

/** Kasa least-squares circle fit. */
function fitCircle(pts: Point[]): { cx: number; cy: number; r: number; maxResidual: number; rmsResidual: number } | null {
  const n = pts.length;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const p of pts) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x; sy += p.y; sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    sxz += p.x * z; syz += p.y * z; sz += z;
  }
  // Solve [sxx sxy sx; sxy syy sy; sx sy n] * [a b c]' = [sxz syz sz]'
  const m = [
    [sxx, sxy, sx, sxz],
    [sxy, syy, sy, syz],
    [sx, sy, n, sz],
  ];
  for (let col = 0; col < 3; col++) {
    let pivot = col;
    for (let row = col + 1; row < 3; row++) {
      if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
    }
    if (Math.abs(m[pivot][col]) < 1e-9) return null;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    for (let row = 0; row < 3; row++) {
      if (row === col) continue;
      const f = m[row][col] / m[col][col];
      for (let k = col; k < 4; k++) m[row][k] -= f * m[col][k];
    }
  }
  const a = m[0][3] / m[0][0];
  const b = m[1][3] / m[1][1];
  const c = m[2][3] / m[2][2];
  const cx = a / 2;
  const cy = b / 2;
  const r2 = c + cx * cx + cy * cy;
  if (r2 <= 0) return null;
  const r = Math.sqrt(r2);

  let maxResidual = 0;
  let sumSq = 0;
  for (const p of pts) {
    const e = Math.abs(Math.hypot(p.x - cx, p.y - cy) - r);
    maxResidual = Math.max(maxResidual, e);
    sumSq += e * e;
  }
  return { cx, cy, r, maxResidual, rmsResidual: Math.sqrt(sumSq / pts.length) };
}

function signedArea(pts: Point[]) {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * Direct least-squares ellipse fit (Fitzgibbon, Pilu & Fisher 1999, in the
 * numerically stable form of Halíř & Flusser 1998). Returns center, semi-axes
 * and rotation, or null when the points don't describe an ellipse.
 */
function fitEllipse(pts: Point[]) {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p.x; my += p.y; }
  mx /= n; my /= n;
  let scale = 0;
  for (const p of pts) scale += Math.hypot(p.x - mx, p.y - my);
  scale = scale / n || 1;

  // Scatter matrices of the quadratic (x², xy, y²) and linear (x, y, 1) parts.
  const S1 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const S2 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const S3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const x = (p.x - mx) / scale, y = (p.y - my) / scale;
    const d1 = [x * x, x * y, y * y];
    const d2 = [x, y, 1];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        S1[i][j] += d1[i] * d1[j];
        S2[i][j] += d1[i] * d2[j];
        S3[i][j] += d2[i] * d2[j];
      }
    }
  }
  const inv3 = (m: number[][]) => {
    const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
    const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
    const det = a * A + b * B + c * C;
    if (Math.abs(det) < 1e-12) return null;
    return [
      [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
      [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
      [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
    ];
  };
  const mul = (x: number[][], y: number[][]) => x.map((row) => y[0].map((_, j) => row.reduce((sum, v, k) => sum + v * y[k][j], 0)));
  const tr = (x: number[][]) => x[0].map((_, j) => x.map((row) => row[j]));
  const S3inv = inv3(S3);
  if (!S3inv) return null;
  const T = mul(S3inv, tr(S2)).map((row) => row.map((v) => -v));
  const M0 = mul(S2, T).map((row, i) => row.map((v, j) => v + S1[i][j]));
  // Premultiply by the inverse of the constraint matrix C1 = [[0,0,2],[0,-1,0],[2,0,0]].
  const M = [M0[2].map((v) => v / 2), M0[1].map((v) => -v), M0[0].map((v) => v / 2)];

  // Real eigenvalues of the 3×3 M via its characteristic cubic.
  const [[a, b, c], [d, e, f], [g, h, i]] = M;
  const p2 = -(a + e + i);
  const p1 = a * e + a * i + e * i - b * d - c * g - f * h;
  const p0 = -(a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g));
  const roots: number[] = [];
  const pp = p1 - (p2 * p2) / 3;
  const qq = (2 * p2 * p2 * p2) / 27 - (p2 * p1) / 3 + p0;
  const disc = (qq * qq) / 4 + (pp * pp * pp) / 27;
  if (disc > 0) {
    roots.push(Math.cbrt(-qq / 2 + Math.sqrt(disc)) + Math.cbrt(-qq / 2 - Math.sqrt(disc)) - p2 / 3);
  } else {
    const r = Math.sqrt(-pp / 3);
    const phi = Math.acos(Math.max(-1, Math.min(1, -qq / (2 * r * r * r))));
    for (let k = 0; k < 3; k++) roots.push(2 * r * Math.cos((phi + 2 * Math.PI * k) / 3) - p2 / 3);
  }
  const cross = (u: number[], w: number[]) => [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
  let best: number[] | null = null;
  for (const lambda of roots) {
    // Eigenvector: the largest cross product of two rows of (M − λI).
    const r0 = [a - lambda, b, c], r1 = [d, e - lambda, f], r2 = [g, h, i - lambda];
    const vec = [cross(r0, r1), cross(r0, r2), cross(r1, r2)].reduce((m, v) => (Math.hypot(...v) > Math.hypot(...m) ? v : m));
    if (Math.hypot(...vec) < 1e-12) continue;
    if (4 * vec[0] * vec[2] - vec[1] * vec[1] > 0) best = vec; // the ellipse solution
  }
  if (!best) return null;
  const [A, B, C] = best;
  const [D, E, F] = T.map((row) => row[0] * A + row[1] * B + row[2] * C);

  // Conic → center, axes, rotation (normalized coordinates, then undone).
  const den = B * B - 4 * A * C;
  if (den >= 0) return null;
  const cx = (2 * C * D - B * E) / den;
  const cy = (2 * A * E - B * D) / den;
  const Fc = A * cx * cx + B * cx * cy + C * cy * cy + D * cx + E * cy + F;
  const theta = 0.5 * Math.atan2(B, A - C);
  const cos = Math.cos(theta), sin = Math.sin(theta);
  const Ap = A * cos * cos + B * cos * sin + C * sin * sin;
  const Cp = A * sin * sin - B * cos * sin + C * cos * cos;
  if (-Fc / Ap <= 0 || -Fc / Cp <= 0) return null;
  return {
    cx: cx * scale + mx,
    cy: cy * scale + my,
    rx: Math.sqrt(-Fc / Ap) * scale,
    ry: Math.sqrt(-Fc / Cp) * scale,
    angle: theta,
  };
}

/** If the closed polyline is an ellipse within tolerance, return a perfect one (4 arcs), preserving winding. */
function tryEllipseSnap(pts: Point[]): string | null {
  if (pts.length < 20) return null;
  const e = fitEllipse(pts);
  if (!e) return null;
  const minor = Math.min(e.rx, e.ry);
  const major = Math.max(e.rx, e.ry);
  if (minor < 3 || major / minor > 8) return null;
  const cos = Math.cos(e.angle), sin = Math.sin(e.angle);
  // Radial distance from each point to the ellipse, in px.
  let sumSq = 0, maxRes = 0;
  const angles: number[] = [];
  for (const p of pts) {
    const dx = p.x - e.cx, dy = p.y - e.cy;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    const t = Math.atan2(v, u);
    const rho = 1 / Math.sqrt((Math.cos(t) / e.rx) ** 2 + (Math.sin(t) / e.ry) ** 2);
    const res = Math.abs(Math.hypot(u, v) - rho);
    sumSq += res * res;
    maxRes = Math.max(maxRes, res);
    angles.push(t);
  }
  const rms = Math.sqrt(sumSq / pts.length);
  // Same size-relative tolerance as circles: small ovals (letters) don't snap.
  if (rms > Math.max(0.2, minor * 0.012) || maxRes > Math.max(0.6, minor * 0.035)) return null;
  angles.sort((x, y) => x - y);
  let maxGap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
  for (let k = 1; k < angles.length; k++) maxGap = Math.max(maxGap, angles[k] - angles[k - 1]);
  if (maxGap > Math.PI / 3) return null;

  const sweep = signedArea(pts) > 0 ? 1 : 0;
  const at = (t: number) => ({
    x: e.cx + e.rx * Math.cos(t) * cos - e.ry * Math.sin(t) * sin,
    y: e.cy + e.rx * Math.cos(t) * sin + e.ry * Math.sin(t) * cos,
  });
  const dir = sweep ? 1 : -1;
  const q = [0, 1, 2, 3, 4].map((k) => at((dir * k * Math.PI) / 2));
  const rot = round((e.angle * 180) / Math.PI);
  let d = `M${round(q[0].x)} ${round(q[0].y)}`;
  for (let k = 1; k <= 4; k++) d += `A${round(e.rx)} ${round(e.ry)} ${rot} 0 ${sweep} ${round(q[k].x)} ${round(q[k].y)}`;
  return d + 'Z';
}

/** If the polyline is a circle within tolerance, return a perfect-circle path preserving winding. */
function tryCircleSnap(pts: Point[]): string | null {
  if (pts.length < 12) return null;
  const fit = fitCircle(pts);
  if (!fit || fit.r < 3) return null;
  // Tolerance scales with size: a small oval (the letter O) must not snap.
  if (fit.rmsResidual > Math.max(0.15, fit.r * 0.012) || fit.maxResidual > Math.max(0.5, fit.r * 0.035)) return null;

  // Require full angular coverage so arcs/crescents don't snap.
  const angles = pts
    .map((p) => Math.atan2(p.y - fit.cy, p.x - fit.cx))
    .sort((x, y) => x - y);
  let maxGap = angles[0] + 2 * Math.PI - angles[angles.length - 1];
  for (let i = 1; i < angles.length; i++) maxGap = Math.max(maxGap, angles[i] - angles[i - 1]);
  if (maxGap > Math.PI / 3) return null;

  const sweep = signedArea(pts) > 0 ? 1 : 0;
  const { cx, cy, r } = fit;
  // Four quarter arcs: two half-circle arcs between exactly opposite points
  // are ambiguous and some renderers draw them with a flat seam.
  const R = round(r);
  const dy = sweep ? r : -r;
  return (
    `M${round(cx - r)} ${round(cy)}` +
    `A${R} ${R} 0 0 ${sweep} ${round(cx)} ${round(cy - dy)}` +
    `A${R} ${R} 0 0 ${sweep} ${round(cx + r)} ${round(cy)}` +
    `A${R} ${R} 0 0 ${sweep} ${round(cx)} ${round(cy + dy)}` +
    `A${R} ${R} 0 0 ${sweep} ${round(cx - r)} ${round(cy)}Z`
  );
}

/** True when every point lies within tol of the chord between the run's ends. */
function isStraight(run: Point[], tol: number) {
  const a = run[0];
  const b = run[run.length - 1];
  const len = dist(a, b);
  if (len < 1e-6) return false;
  for (let i = 1; i < run.length - 1; i++) {
    const p = run[i];
    const off = Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / len;
    if (off > tol) return false;
  }
  return true;
}

/**
 * How well run[i0..i1] fits a straight line (total least squares).
 * rms: residual scatter. sag: systematic one-sided bend, estimated by fitting
 * the residuals to a parabola — random noise has none, an arc of chord c and
 * radius r has about c²/8r. Separating the two is what lets a noisy straight
 * edge become a line while a gentle arc stays a curve.
 */
function lineQuality(run: Point[], i0: number, i1: number) {
  const n = i1 - i0 + 1;
  let cx = 0, cy = 0;
  for (let k = i0; k <= i1; k++) { cx += run[k].x; cy += run[k].y; }
  cx /= n; cy /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let k = i0; k <= i1; k++) {
    const dx = run[k].x - cx, dy = run[k].y - cy;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(angle), uy = Math.sin(angle);

  let tmin = Infinity, tmax = -Infinity;
  for (let k = i0; k <= i1; k++) {
    const t = (run[k].x - cx) * ux + (run[k].y - cy) * uy;
    if (t < tmin) tmin = t;
    if (t > tmax) tmax = t;
  }
  const span = tmax - tmin || 1;
  let sumE2 = 0, sumQ = 0, maxE = 0;
  const es: number[] = [], qs: number[] = [];
  for (let k = i0; k <= i1; k++) {
    const dx = run[k].x - cx, dy = run[k].y - cy;
    const e = dx * -uy + dy * ux;
    const t = ((dx * ux + dy * uy) - tmin) / span;
    const q = t * (1 - t);
    es.push(e); qs.push(q);
    sumE2 += e * e; sumQ += q;
    if (Math.abs(e) > maxE) maxE = Math.abs(e);
  }
  const qm = sumQ / n;
  let num = 0, den = 0;
  for (let k = 0; k < n; k++) { num += es[k] * (qs[k] - qm); den += (qs[k] - qm) ** 2; }
  const bow = den > 1e-12 ? num / den : 0;
  return { rms: Math.sqrt(sumE2 / n), sag: Math.abs(bow) * 0.25, maxE, cx, cy, ux, uy };
}

/**
 * Split a corner-to-corner run into maximal straight stretches and curved
 * remainders, so the straight edges of a logo come out as exact lines
 * instead of slightly bowed or wavy curves.
 *
 * @param noise estimated outline noise (px RMS) — tolerances scale with it
 */
function fitRunWithLines(
  input: Point[],
  maxError: number,
  noise: number,
  /** Tangent into the run at its start / end, when the joint must be smooth. */
  startTan?: Point | null,
  endTan?: Point | null,
): string | null {
  // Straight stretches inside a curved run must be long: the flattest part
  // of a big curve passes a short straightness test and would turn the curve
  // into a polygon. (A whole corner-to-corner run is handled below.)
  const MIN_LINE = 15; // px
  const run = input.slice();
  const last = run.length - 1;
  const straight = (i0: number, i1: number) => isLineLike(run, i0, i1, noise);

  // Corner to corner and straight (a star's edge, a letter stem): one line.
  if (!startTan && !endTan && last >= 1 && isLineLike(run, 0, last, noise, true)) {
    return `L${round(run[last].x)} ${round(run[last].y)}`;
  }
  // Where a line meets a curve, the line must stop where the edge starts to
  // bend, or the curve begins with a kink.
  const endTol = 0.12 + noise;
  // Distance from the line, averaged over ±2 samples so single-sample
  // jitter doesn't stop a trim mid-edge; a real bend still shows up.
  const offLine = (q: ReturnType<typeof lineQuality>, k: number) => {
    let sum = 0;
    let cnt = 0;
    for (let m = Math.max(0, k - 2); m <= Math.min(last, k + 2); m++) {
      sum += (run[m].x - q.cx) * -q.uy + (run[m].y - q.cy) * q.ux;
      cnt++;
    }
    return Math.abs(sum / cnt);
  };

  // A real straight edge ends where the outline turns into a corner or a
  // clearly curved arc (a rounded rectangle's side). The flat middle of a
  // gentle curve keeps curving at the same slow rate past both ends — making
  // it a line would leave visible flat spots.
  const endsTurn = (i0: number, i1: number) => {
    const dir = unit(run[i1].x - run[i0].x, run[i1].y - run[i0].y);
    if (!dir) return false;
    const turnPast = (from: number, step: 1 | -1) => {
      let k = from;
      while (k + step >= 0 && k + step <= last && dist(run[from], run[k]) < 8) k += step;
      if (k === from) return 180; // run end: a corner
      const v = unit((run[k].x - run[from].x) * step, (run[k].y - run[from].y) * step);
      if (!v) return 180;
      return (Math.acos(Math.max(-1, Math.min(1, v.x * dir.x + v.y * dir.y))) * 180) / Math.PI;
    };
    const atStart = i0 === 0 ? (startTan ? turnPast(i0, -1) : 180) : turnPast(i0, -1);
    const atEnd = i1 === last ? (endTan ? turnPast(i1, 1) : 180) : turnPast(i1, 1);
    return atStart >= 10 && atEnd >= 10;
  };

  let d = '';
  let curveStart = 0;
  let leftTan: Point | null | undefined = startTan;
  let i = 0;
  while (i < last) {
    // Shortest stretch long enough to count as a line.
    let j = i + 1;
    while (j < last && dist(run[i], run[j]) < MIN_LINE) j++;
    if (dist(run[i], run[j]) < MIN_LINE || !straight(i, j)) {
      i++;
      continue;
    }
    // Grow; look past a local bump before giving up on the line.
    for (;;) {
      const next = [j + 2, j + 12, j + 24].map((k) => Math.min(k, last)).find((k) => k > j && straight(i, k));
      if (next === undefined) break;
      j = next;
      if (j === last) break;
    }
    // Settle both ends exactly where the samples leave the line, judged
    // against a line fitted to the stretch's middle (the ends may already
    // be bending into a neighboring curve). The run's own ends are corners
    // and stay put.
    const margin = Math.floor((j - i) * 0.2);
    let q = lineQuality(run, i + margin, j - margin);
    // A run end is fixed when it's a corner; a smooth seam (tangent given) may move.
    const startFixed = !startTan;
    const endFixed = !endTan;
    let start = i;
    if (i > 0 || !startFixed) {
      while (start - 1 > curveStart && offLine(q, start - 1) <= endTol) start--;
      while (start < j && offLine(q, start) > endTol) start++;
    }
    while ((j < last || !endFixed) && j > start && offLine(q, j) > endTol) j--;
    if (dist(run[start], run[j]) < MIN_LINE || !endsTurn(start, j)) {
      i++;
      continue;
    }
    i = start;
    q = lineQuality(run, i, j);
    const proj = (p: Point) => {
      const t = (p.x - q.cx) * q.ux + (p.y - q.cy) * q.uy;
      return { x: q.cx + t * q.ux, y: q.cy + t * q.uy };
    };
    // Snap the line's free ends onto the fitted line (not the noisy samples).
    if (i > 0) run[i] = proj(run[i]);
    if (j < last) run[j] = proj(run[j]);
    // Line starts at a free seam: the path's start point moves onto the line.
    if (i === 0 && !startFixed) run[0] = proj(run[0]);
    const dir = unit(run[j].x - run[i].x, run[j].y - run[i].y);

    if (curveStart < i) {
      const back = dir ? { x: -dir.x, y: -dir.y } : null;
      const piece = fitRun(run.slice(curveStart, i + 1), maxError, noise, leftTan, back);
      if (piece === null) return null;
      d += piece;
    }
    d += `L${round(run[j].x)} ${round(run[j].y)}`;
    curveStart = j;
    leftTan = dir;
    i = j;
  }
  if (curveStart < last) {
    const piece = fitRun(run.slice(curveStart), maxError, noise, leftTan, endTan);
    if (piece === null) return null;
    d += piece;
  }
  return d;
}

/**
 * Line test with length-aware tolerance. Edge wobble (JPEG blocks) has a
 * roughly fixed amplitude, while a real arc's bow grows with the square of
 * the stretch length — so long stretches can tolerate more bow before they
 * stop looking straight, and short ones must be tight.
 */
function isLineLike(run: Point[], i0: number, i1: number, noise: number, cornerToCorner = false) {
  const len = dist(run[i0], run[i1]);
  const q = lineQuality(run, i0, i1);
  // An arc's bow grows with the square of its length, edge wobble doesn't:
  // the allowance grows slowly with length so arcs fail at every length.
  const sagTol = cornerToCorner
    ? Math.max(1.2 * noise, Math.min(0.4, 0.1 + len * 0.005))
    : Math.max(1.2 * noise, Math.min(0.4, 0.06 + Math.max(0, len - 15) * 0.01));
  // Inside a curved run the tolerance is tight: near an S-bend's inflection a
  // curve is almost straight for a while, and a loose test turns it into a
  // line with a kink at each end. Corner-to-corner edges get more slack for
  // compression wobble.
  const rmsTol = cornerToCorner ? Math.max(1.6 * noise, 0.4) : Math.max(1.6 * noise, 0.2);
  const maxTol = cornerToCorner ? Math.max(0.75, 3 * noise) : Math.max(0.4, 3 * noise);
  // The max-residual guard stops a long line from averaging away the start
  // of an adjoining curve.
  return q.rms <= rmsTol && q.sag <= sagTol && q.maxE <= maxTol;
}

function unit(x: number, y: number): Point | null {
  const m = Math.hypot(x, y);
  return m < 1e-9 ? null : { x: x / m, y: y / m };
}

/** Direction from run[from] toward a sample ~2px along the run. */
function tangentFrom(run: Point[], from: number, step: -1 | 1): Point | null {
  let k = from;
  while (k + step >= 0 && k + step < run.length && dist(run[from], run[k]) < 2) k += step;
  return unit(run[k].x - run[from].x, run[k].y - run[from].y);
}

/**
 * Fit smooth cubics through a point run. Tangents: leftTan points into the
 * curve at its start, rightTan points into it at its end (i.e. backwards).
 * Passing the neighboring line's direction makes the joint seamless.
 */
function fitRun(run: Point[], maxError: number, noise = 0, leftTan?: Point | null, rightTan?: Point | null): string | null {
  if (run.length < 2) return '';
  const last = run[run.length - 1];
  if (run.length <= 3) return `L${round(last.x)} ${round(last.y)}`;
  if (!leftTan && !rightTan && isLineLike(run, 0, run.length - 1, noise, true)) {
    return `L${round(last.x)} ${round(last.y)}`;
  }
  const lt = leftTan ?? tangentFrom(run, 0, 1);
  const rt = rightTan ?? tangentFrom(run, run.length - 1, -1);
  if (!lt || !rt) return null;
  const tol = Math.max(maxError, 2 * noise);
  const beziers = fitCubic(run.map((p) => [p.x, p.y]), [lt.x, lt.y], [rt.x, rt.y], tol * tol);
  let d = '';
  for (const bez of beziers) {
    const nums = [bez[1][0], bez[1][1], bez[2][0], bez[2][1], bez[3][0], bez[3][1]];
    if (nums.some((v) => !Number.isFinite(v))) return null;
    const [p0, c1, c2, p1] = bez.map(([x, y]) => ({ x, y }));
    // A cubic whose handles sit on its chord is a straight line: say so.
    if (isStraight([p0, c1, c2, p1], 0.15)) {
      d += `L${round(p1.x)} ${round(p1.y)}`;
      continue;
    }
    d += `C${nums.map(round).join(' ')}`;
  }
  return d;
}

/**
 * Gaussian smoothing along a sampled polyline with "twicing" (2G − G∘G),
 * which cancels most of the shrinkage plain smoothing causes on curves.
 * Open runs keep their end points (anti-symmetric extension at the ends).
 */
function smoothAlong(pts: Point[], sigmaSamples: number, closed: boolean): Point[] {
  const n = closed ? pts.length - 1 : pts.length; // closed input repeats its first point
  if (n < 5) return pts;
  const R = Math.min(Math.ceil(3 * sigmaSamples), n - 1);
  const w: number[] = [];
  let wsum = 0;
  for (let k = -R; k <= R; k++) {
    const v = Math.exp(-(k * k) / (2 * sigmaSamples * sigmaSamples));
    w.push(v);
    wsum += v;
  }
  const blur = (src: Point[]): Point[] => {
    const get = (i: number): Point => {
      if (closed) return src[((i % n) + n) % n];
      if (i < 0) return { x: 2 * src[0].x - src[-i].x, y: 2 * src[0].y - src[-i].y };
      if (i > n - 1) {
        const m = 2 * (n - 1) - i;
        return { x: 2 * src[n - 1].x - src[m].x, y: 2 * src[n - 1].y - src[m].y };
      }
      return src[i];
    };
    const out: Point[] = [];
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0;
      for (let k = -R; k <= R; k++) {
        const p = get(i + k);
        x += w[k + R] * p.x;
        y += w[k + R] * p.y;
      }
      out.push({ x: x / wsum, y: y / wsum });
    }
    return out;
  };
  const base = pts.slice(0, n);
  const g1 = blur(base);
  const g2 = blur(g1);
  const out = base.map((p, i) => ({ x: 2 * g1[i].x - g2[i].x, y: 2 * g1[i].y - g2[i].y }));
  if (!closed) {
    out[0] = pts[0];
    out[n - 1] = pts[n - 1];
  } else {
    out.push(out[0]);
  }
  return out;
}

/** Re-sample a polyline at uniform arc-length spacing. */
function resample(pts: Point[], closed: boolean, step: number): Point[] {
  const src = closed ? [...pts, pts[0]] : pts;
  const out: Point[] = [src[0]];
  let carry = 0; // distance travelled since the last emitted point
  for (let i = 0; i + 1 < src.length; i++) {
    const a = src[i];
    const b = src[i + 1];
    const len = dist(a, b);
    if (len < 1e-9) continue;
    let t = step - carry;
    while (t <= len) {
      out.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
      t += step;
    }
    carry = len - (t - step);
  }
  if (closed) {
    if (out.length > 1 && dist(out[out.length - 1], out[0]) < step * 0.5) out.pop();
  } else if (dist(out[out.length - 1], src[src.length - 1]) > 1e-6) {
    out.push(src[src.length - 1]);
  }
  return out;
}

/** [1 2 1]/4 smoothing passes — knocks out sub-pixel noise; corners are restored later. */
function smoothPolyline(pts: Point[], closed: boolean, iterations: number): Point[] {
  let cur = pts;
  const n = pts.length;
  for (let it = 0; it < iterations; it++) {
    const next = new Array<Point>(n);
    for (let i = 0; i < n; i++) {
      if (!closed && (i === 0 || i === n - 1)) {
        next[i] = cur[i];
        continue;
      }
      const a = cur[(i - 1 + n) % n];
      const b = cur[i];
      const c = cur[(i + 1) % n];
      next[i] = { x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 };
    }
    cur = next;
  }
  return cur;
}

/** Turn angle (degrees) at sample i, measured k samples to each side. */
function turnK(pts: Point[], i: number, k: number, closed: boolean): number {
  const n = pts.length;
  let ia = i - k;
  let ib = i + k;
  if (closed) {
    ia = ((ia % n) + n) % n;
    ib = ib % n;
  } else if (ia < 0 || ib >= n) {
    return 0;
  }
  const v1x = pts[i].x - pts[ia].x;
  const v1y = pts[i].y - pts[ia].y;
  const v2x = pts[ib].x - pts[i].x;
  const v2y = pts[ib].y - pts[i].y;
  const m1 = Math.hypot(v1x, v1y);
  const m2 = Math.hypot(v2x, v2y);
  if (m1 < 1e-9 || m2 < 1e-9) return 0;
  const cos = Math.min(1, Math.max(-1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
  return (Math.acos(cos) * 180) / Math.PI;
}

/**
 * Corner detection at two scales. A true corner turns by the same angle
 * whether measured over 1.5px or 3px; a curve of radius r turns ~2k/r, so its
 * small-scale turn is only half the large-scale one. That separates corners
 * from small rounded features and from edge noise.
 */
function detectCorners(pts: Point[], closed: boolean, cornerDeg: number, step: number) {
  const n = pts.length;
  // Scales are small enough for 2px letter strokes; edge noise is already
  // removed by the raster boundary smoothing.
  const kBig = Math.max(2, Math.round(1.5 / step));
  const kSmall = Math.max(1, Math.round(0.75 / step));
  const big = new Float64Array(n);
  if (n < 2 * kBig + 2) return { corners: [] as number[], big, kSmall, kBig };
  for (let i = 0; i < n; i++) big[i] = turnK(pts, i, kBig, closed);

  // Score each sample; 0 = not a corner candidate.
  const score = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    if (big[i] < cornerDeg) continue;
    // Very strong turns are corners even when blunted (thin tips lose their
    // last pixels to anti-aliasing); otherwise require scale-invariance.
    const ratio = big[i] >= 100 ? 0 : big[i] >= 60 ? 0.5 : 0.6;
    if (turnK(pts, i, kSmall, closed) < ratio * big[i]) continue;
    score[i] = big[i];
  }

  // Non-maximum suppression over ±kBig, among candidates only.
  const corners: number[] = [];
  for (let i = 0; i < n; i++) {
    if (score[i] === 0) continue;
    let isMax = true;
    for (let d = -kBig; d <= kBig && isMax; d++) {
      if (d === 0) continue;
      let j = i + d;
      if (closed) j = ((j % n) + n) % n;
      else if (j < 0 || j >= n) continue;
      if (score[j] > score[i] || (score[j] === score[i] && j < i)) isMax = false;
    }
    if (isMax) corners.push(i);
  }
  return { corners, big, kSmall, kBig };
}

function rebuildSubpath(sub: Subpath, maxError: number, cornerDeg: number, outlineSigma: number): string | null {
  const STEP = 0.5;
  let pts = sub.points;

  // Tiny fragments: keep as straight segments, they're sub-visible anyway.
  if (pts.length < 8) {
    let d = `M${round(pts[0].x)} ${round(pts[0].y)}`;
    for (let i = 1; i < pts.length; i++) d += `L${round(pts[i].x)} ${round(pts[i].y)}`;
    return d + (sub.closed ? 'Z' : '');
  }

  if (sub.closed) {
    const circle = tryCircleSnap(pts);
    if (circle) return circle;
    const ellipse = tryEllipseSnap(pts);
    if (ellipse) return ellipse;
  }

  const sampled = resample(pts, sub.closed, STEP);
  pts = smoothPolyline(sampled, sub.closed, 2);
  const n = pts.length;
  if (n < 4) return null;

  // Tiny closed loops (small counters, dots): corner logic has nothing to
  // work with at this size, so fit one smooth, tight loop.
  if (sub.closed && n * STEP < 12) {
    const loop = [...pts, pts[0]];
    const tan = unit(pts[1].x - pts[n - 1].x, pts[1].y - pts[n - 1].y);
    const piece = fitRun(loop, 0.15, 0, tan, tan && { x: -tan.x, y: -tan.y });
    return piece === null ? null : `M${round(pts[0].x)} ${round(pts[0].y)}${piece}Z`;
  }

  // Outline noise: how far smoothing moved the samples. Corners move most,
  // so drop the top 10% before taking the RMS.
  const moves = sampled.map((p, i) => dist(p, pts[i])).sort((a, b) => a - b);
  const kept = moves.slice(0, Math.max(1, Math.floor(moves.length * 0.9)));
  const noise = Math.sqrt(kept.reduce((sum, m) => sum + m * m, 0) / kept.length);

  const detected = detectCorners(pts, sub.closed, cornerDeg, STEP);
  let cornerIdx = detected.corners;

  if (sub.closed && cornerIdx.length > 0) {
    // Start the loop at a corner so no corner zone straddles the seam.
    const c0 = cornerIdx[0];
    pts = [...pts.slice(c0), ...pts.slice(0, c0)];
    cornerIdx = cornerIdx.map((c) => (c - c0 + n) % n).sort((a, b) => a - b);
  }

  // Each corner replaces a short zone (rounded by smoothing) with the
  // reconstructed sharp point. A U-turn (the end of a thin stroke) becomes a
  // square cap with two corners instead — one point there makes a spike.
  const k = cornerIdx.length;
  const gapPx = (a: number, b: number) => (((b - a + n) % n) || n) * STEP; // samples a→b, forward
  // A U-turn spans more than the detection window on thin strokes, so judge
  // it over twice the distance.
  const isCap = cornerIdx.map((c) => turnK(pts, c, 2 * detected.kBig, sub.closed) >= 150);
  const zoneSize = isCap.map((cap) => (cap ? detected.kBig : detected.kSmall));
  const restored = cornerIdx.map((c, j): Point[] => {
    const zs = zoneSize[j];
    const from = sub.closed ? (c - zs + n) % n : Math.max(0, c - zs);
    const to = sub.closed ? (c + zs) % n : Math.min(n - 1, c + zs);
    // Don't let the edge-direction samples run into the neighboring corner's zone.
    const prev = k > 1 || sub.closed ? cornerIdx[(j - 1 + k) % k] : -1;
    const next = k > 1 || sub.closed ? cornerIdx[(j + 1) % k] : -1;
    const prevZone = prev >= 0 ? zoneSize[(j - 1 + k) % k] : 0;
    const nextZone = next >= 0 ? zoneSize[(j + 1) % k] : 0;
    const before = prev >= 0 && (sub.closed || prev < c) ? gapPx(prev, c) - (zs + prevZone) * STEP - 0.5 : 6;
    const after = next >= 0 && (sub.closed || next > c) ? gapPx(c, next) - (zs + nextZone) * STEP - 0.5 : 6;
    const cluster = { from, to, apex: c };
    if (isCap[j]) {
      const cap = squareCap(pts, cluster, sub.closed, Math.min(3, before), Math.min(3, after));
      if (cap) return cap;
    }
    const corner = restoreCorner(pts, cluster, sub.closed, Math.min(3, before), Math.min(3, after));
    if (corner) return [corner];
    // Near-parallel sides make the corner unrecoverable; a cap beats a spike.
    return squareCap(pts, cluster, sub.closed, Math.min(3, before), Math.min(3, after)) ?? [pts[c]];
  });
  const zoneOf = new Int32Array(n).fill(-1);
  cornerIdx.forEach((c, j) => {
    for (let d = -zoneSize[j]; d <= zoneSize[j]; d++) {
      let i = c + d;
      if (sub.closed) i = ((i % n) + n) % n;
      else if (i < 0 || i >= n) continue;
      zoneOf[i] = j;
    }
  });

  const rebuilt: Point[] = [];
  let corners: number[] = [];
  for (let i = 0; i < n; i++) {
    const j = zoneOf[i];
    if (j < 0) {
      rebuilt.push(pts[i]);
    } else if (i === cornerIdx[j]) {
      for (const point of restored[j]) {
        corners.push(rebuilt.length);
        rebuilt.push(point);
      }
    }
  }
  pts = rebuilt;

  let smoothSeam = false;
  if (sub.closed) {
    // Fit closed paths corner-to-corner; with no corners, cut where it turns most.
    if (corners.length === 0) {
      smoothSeam = true;
      let cut = 0;
      for (let i = 1; i < detected.big.length; i++) if (detected.big[i] > detected.big[cut]) cut = i;
      corners = [Math.min(cut, pts.length - 1)];
    }
    const first = corners[0];
    pts = [...pts.slice(first), ...pts.slice(0, first)];
    corners = corners.map((c) => c - first);
    corners.push(pts.length); // close back to the starting corner
    pts = [...pts, pts[0]];
  } else {
    if (corners.length === 0 || corners[0] !== 0) corners.unshift(0);
    if (corners[corners.length - 1] !== pts.length - 1) corners.push(pts.length - 1);
  }

  // Along-the-outline smoothing of each corner-to-corner run (corners stay
  // fixed). Removes the ~10px waves JPEG blocks leave in edges, which the
  // small-scale smoothing above can't touch. Strength follows the Smoothing
  // setting; runs are never smoothed over more than an eighth of their length.
  if (outlineSigma > 0.3) {
    const runs = corners.slice(0, -1).map((c, k) => [c, corners[k + 1]] as const);
    const out = pts.slice();
    for (const [a, b] of runs) {
      const runLen = (b - a) * STEP;
      const sig = Math.min(outlineSigma, runLen / 8) / STEP;
      if (sig < 1) continue;
      const sm = smoothAlong(pts.slice(a, b + 1), sig, smoothSeam && runs.length === 1);
      for (let k = 1; k < sm.length - 1; k++) out[a + k] = sm[k];
    }
    pts = out;
  }

  // A closed loop with no corners is cut at an arbitrary point: give both
  // sides of the cut the same tangent so the seam is invisible.
  let seamTan: Point | null = null;
  if (sub.closed && smoothSeam) {
    const m = pts.length - 1; // pts[m] === pts[0]
    const back = Math.max(1, m - 4);
    seamTan = unit(pts[Math.min(4, m)].x - pts[back].x, pts[Math.min(4, m)].y - pts[back].y);
  }

  let d = `M${round(pts[0].x)} ${round(pts[0].y)}`;
  for (let s = 0; s + 1 < corners.length; s++) {
    const isFirst = s === 0;
    const isLast = s + 2 === corners.length;
    const piece = fitRunWithLines(
      pts.slice(corners[s], corners[s + 1] + 1),
      maxError,
      noise,
      isFirst && seamTan ? seamTan : undefined,
      isLast && seamTan ? { x: -seamTan.x, y: -seamTan.y } : undefined,
    );
    if (piece === null) return null;
    d += piece;
  }
  return d + (sub.closed ? 'Z' : '');
}

/**
 * Smooth a pixel-staircase outline (potrace-style): short steps are replaced
 * by their midpoints, which is where the true edge passes. Long runs keep
 * their endpoints when the neighboring run is long too — those are real
 * corners (e.g. a rectangle), not staircase artifacts.
 *
 * @param stepLen segments up to this length count as staircase steps
 */
function smoothStaircase(sub: Subpath, stepLen: number): Subpath {
  const pts = sub.points;
  const n = pts.length;
  if (n < 3) return sub;
  const segs = sub.closed ? n : n - 1;
  const seg = (i: number) => [pts[i], pts[(i + 1) % n]] as const;
  const isLong = (i: number) => {
    if (!sub.closed && (i < 0 || i >= segs)) return true; // path ends act as anchors
    const [a, b] = seg(((i % segs) + segs) % segs);
    return dist(a, b) > stepLen;
  };

  const out: Point[] = [];
  if (!sub.closed) out.push(pts[0]);
  for (let i = 0; i < segs; i++) {
    const [a, b] = seg(i);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (!isLong(i)) {
      out.push(mid);
      continue;
    }
    const prevLong = isLong(i - 1);
    const nextLong = isLong(i + 1);
    if (prevLong && (sub.closed || i > 0)) out.push(a);
    if (!prevLong || !nextLong) out.push(mid);
  }
  if (!sub.closed) out.push(pts[n - 1]);
  return { points: out, closed: sub.closed };
}

function polylineD(sub: Subpath) {
  let d = `M${round(sub.points[0].x)} ${round(sub.points[0].y)}`;
  for (let i = 1; i < sub.points.length; i++) d += `L${round(sub.points[i].x)} ${round(sub.points[i].y)}`;
  return d + (sub.closed ? 'Z' : '');
}

export function refineTracedSvg(svg: string, options: RefineOptions): string {
  const smoothness = Math.min(100, Math.max(0, options.smoothness));
  const maxError = 0.25 + (smoothness / 100) * 0.6;
  const cornerDeg = 28 + smoothness * 0.3;
  // Along-outline smoothing radius (px): 4 at the default setting of 50.
  const outlineSigma = smoothness * 0.08;
  const scale = options.scale ?? 1;
  const curves = options.curves ?? true;

  let result = svg.replace(/<path\b[^>]*?\/?>/g, (tag: string) => {
    const dMatch = tag.match(/\sd="([^"]+)"/);
    if (!dMatch) return tag;
    const tMatch = tag.match(/\stransform="translate\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)\s*\)"/);
    const tx = tMatch ? parseFloat(tMatch[1]) : 0;
    const ty = tMatch ? parseFloat(tMatch[2]) : 0;
    // Any other transform: we can't bake it safely, leave the path alone.
    if (!tMatch && /\stransform=/.test(tag)) return tag;

    try {
      const subpaths = flattenPath(dMatch[1]);
      if (!subpaths || subpaths.length === 0) return tag;
      let out = '';
      for (let sub of subpaths) {
        sub = {
          closed: sub.closed,
          points: sub.points.map((p) => ({ x: (p.x + tx) / scale, y: (p.y + ty) / scale })),
        };
        if (options.staircase) sub = smoothStaircase(sub, 1.5 / scale);
        if (!curves) {
          out += polylineD(sub);
          continue;
        }
        const rebuilt = rebuildSubpath(sub, maxError, cornerDeg, outlineSigma);
        out += rebuilt ?? polylineD(sub);
      }
      return tag
        .replace(dMatch[0], ` d="${out}"`)
        .replace(/\stransform="[^"]*"/, '');
    } catch {
      return tag;
    }
  });

  if (options.width && options.height) {
    const w = options.width;
    const h = options.height;
    result = result.replace(/<svg\b[^>]*>/, (open) =>
      open
        .replace(/\s(width|height|viewBox)="[^"]*"/g, '')
        .replace('<svg', `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"`),
    );
  }
  return result;
}
