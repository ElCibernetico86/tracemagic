// Mark every sharp joint (tangent change > 12°) in a traced SVG over a zoomed crop:
// npx tsx bench/corner-marks.ts <svg> <out.png> <x> <y> <w> <h> <zoom>
import fs from 'fs';
import sharp from 'sharp';

type P = [number, number];
function joints(d: string): P[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
  const counts: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
  const out: P[] = [];
  let cmd = '', i = 0, cur: P = [0, 0], start: P = [0, 0];
  let segs: { from: P; to: P; t0: P; t1: P }[] = [];
  const flush = () => {
    for (let k = 0; k < segs.length; k++) {
      const a = segs[k], b = segs[(k + 1) % segs.length];
      const ang = (v: P) => Math.atan2(v[1], v[0]);
      let dlt = Math.abs(ang(a.t1) - ang(b.t0)) * 180 / Math.PI;
      if (dlt > 180) dlt = 360 - dlt;
      if (dlt > 12) out.push(a.to);
    }
    segs = [];
  };
  const dir = (a: P, b: P): P => [b[0] - a[0], b[1] - a[1]];
  while (i < tokens.length) {
    if (/[a-zA-Z]/.test(tokens[i])) { cmd = tokens[i++]; if (/z/i.test(cmd)) { if (Math.hypot(cur[0] - start[0], cur[1] - start[1]) > 0.01) segs.push({ from: cur, to: start, t0: dir(cur, start), t1: dir(cur, start) }); flush(); cur = start; continue; } }
    else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
    const up = cmd.toUpperCase(), rel = cmd !== up, n = counts[up];
    const a = tokens.slice(i, i + n).map(Number); i += n;
    const abs = (x: number, y: number): P => (rel ? [cur[0] + x, cur[1] + y] : [x, y]);
    if (up === 'M') { flush(); cur = abs(a[0], a[1]); start = cur; continue; }
    let to: P, t0: P, t1: P;
    if (up === 'H') to = [rel ? cur[0] + a[0] : a[0], cur[1]];
    else if (up === 'V') to = [cur[0], rel ? cur[1] + a[0] : a[0]];
    else to = abs(a[n - 2], a[n - 1]);
    if (up === 'C') { const c1 = abs(a[0], a[1]), c2 = abs(a[2], a[3]); t0 = dir(cur, c1); t1 = dir(c2, to); }
    else { t0 = dir(cur, to); t1 = t0; }
    segs.push({ from: cur, to, t0, t1 });
    cur = to;
  }
  flush();
  return out;
}

async function main() {
  const [svgFile, out, xs, ys, ws, hs, zs] = process.argv.slice(2);
  const [x, y, w, h, Z] = [xs, ys, ws, hs, zs].map(Number);
  const svg = fs.readFileSync(svgFile, 'utf8');
  const pts = [...svg.matchAll(/ d="([^"]+)"/g)].flatMap((m) => joints(m[1])).filter(([px, py]) => px >= x && px <= x + w && py >= y && py <= y + h);
  const marks = `<svg xmlns="http://www.w3.org/2000/svg" width="${w * Z}" height="${h * Z}">${pts.map(([px, py]) => `<circle cx="${(px - x) * Z}" cy="${(py - y) * Z}" r="${Z * 0.9}" fill="#ff2d55"/>`).join('')}</svg>`;
  const base = await sharp(Buffer.from(svg), { density: 72 * Z }).extract({ left: x * Z, top: y * Z, width: w * Z, height: h * Z }).flatten({ background: '#f0f' }).png().toBuffer();
  await sharp(base).composite([{ input: Buffer.from(marks) }]).png().toFile(out);
  console.log(`${pts.length} sharp joints in view`);
}
main();
