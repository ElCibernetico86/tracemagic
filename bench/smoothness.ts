// Curve smoothness score for traced SVGs: npx tsx bench/smoothness.ts <file.svg> [...]
// "wobble" = mean absolute change in turning per 1px step along every outline, in degrees,
// skipping genuine corners. A perfect circle of radius r scores ~0; rough curves score high.
// Also reports the number of curve segments (fewer, longer segments read as smoother).
import fs from 'fs';
import { flattenSvgPath } from '../src/lib/exporters.js';

export function smoothness(svg: string) {
  let wobbleSum = 0, steps = 0, segments = 0;
  for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
    segments += (m[1].match(/[CcSsQqTtAa]/g) ?? []).length;
    for (const poly of flattenSvgPath(m[1], 0.05)) {
      // Resample at 1px.
      const pts = poly.points;
      const res: number[][] = [pts[0]];
      let carry = 0;
      for (let i = 1; i < pts.length; i++) {
        const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
        const len = Math.hypot(bx - ax, by - ay);
        let t = 1 - carry;
        while (t <= len) { res.push([ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len]); t += 1; }
        carry = len - (t - 1);
      }
      if (res.length < 12) continue;
      const n = res.length;
      const turn: number[] = [];
      for (let i = 0; i < n; i++) {
        const a = res[(i - 1 + n) % n], b = res[i], c = res[(i + 1) % n];
        const t1 = Math.atan2(b[1] - a[1], b[0] - a[0]), t2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
        let d = ((t2 - t1 + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
        turn.push((d * 180) / Math.PI);
      }
      for (let i = 0; i < n; i++) {
        const a = turn[i], b = turn[(i + 1) % n];
        if (Math.abs(a) > 25 || Math.abs(b) > 25) continue; // corner
        wobbleSum += Math.abs(b - a);
        steps++;
      }
    }
  }
  return { wobble: steps ? wobbleSum / steps : 0, segments };
}

if (process.argv[1]?.endsWith('smoothness.ts')) {
  for (const f of process.argv.slice(2)) {
    const { wobble, segments } = smoothness(fs.readFileSync(f, 'utf8'));
    console.log(`${f.split('/').pop()}: wobble=${wobble.toFixed(3)}°/px segments=${segments}`);
  }
}
