// Straight-edge / corner quality of traced SVGs: npx tsx bench/corners.ts <file.svg> [...]
//  nicks   — segments shorter than 2px (jogs and notches on edges that should be clean)
//  offAxis — straight segments ≥10px that are within 2° of horizontal/vertical but not exactly on it
//  lines / curves — segment counts
import fs from 'fs';

export function cornerQuality(svg: string) {
  let nicks = 0, offAxis = 0, lines = 0, curves = 0;
  for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
    const tokens = m[1].match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) ?? [];
    let cmd = '', i = 0, x = 0, y = 0, sx = 0, sy = 0;
    const counts: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };
    while (i < tokens.length) {
      if (/[a-zA-Z]/.test(tokens[i])) { cmd = tokens[i++]; if (/z/i.test(cmd)) { x = sx; y = sy; continue; } }
      else if (cmd === 'M') cmd = 'L'; else if (cmd === 'm') cmd = 'l';
      const up = cmd.toUpperCase(), rel = cmd !== up, n = counts[up];
      const a = tokens.slice(i, i + n).map(Number); i += n;
      let nx = x, ny = y;
      if (up === 'H') nx = rel ? x + a[0] : a[0];
      else if (up === 'V') ny = rel ? y + a[0] : a[0];
      else if (n >= 2) { nx = rel ? x + a[n - 2] : a[n - 2]; ny = rel ? y + a[n - 1] : a[n - 1]; }
      if (up === 'M') { sx = nx; sy = ny; }
      else {
        const len = Math.hypot(nx - x, ny - y);
        if (len < 2) nicks++;
        if (up === 'L' || up === 'H' || up === 'V') {
          lines++;
          if (len >= 10) {
            const ang = (Math.atan2(Math.abs(ny - y), Math.abs(nx - x)) * 180) / Math.PI; // 0..90
            const off = Math.min(ang, 90 - ang);
            if (off > 0.05 && off < 2) offAxis++;
          }
        } else curves++;
      }
      x = nx; y = ny;
    }
  }
  return { nicks, offAxis, lines, curves };
}

if (process.argv[1]?.endsWith('corners.ts')) {
  for (const f of process.argv.slice(2)) {
    const q = cornerQuality(fs.readFileSync(f, 'utf8'));
    console.log(`${f.split('/').pop()}: nicks=${q.nicks} offAxis=${q.offAxis} lines=${q.lines} curves=${q.curves}`);
  }
}
