/**
 * Client-side palette tools for color reduction: perceptual (CIELAB) color
 * distance, greedy merging down to N colors, and recoloring a traced SVG for
 * an instant preview before the image is re-traced with the chosen palette.
 */

export interface PaletteEntry {
  /** "#RRGGBB" */
  color: string;
  /** Share of the image area, 0–1. */
  area: number;
}

type Lab = [number, number, number];

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

function toLinear(c: number) {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear);
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

export function deltaE(a: Lab, b: Lab) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Reduce a palette to `n` colors by repeatedly merging the cheapest pair
 * (area-weighted squared distance, so similar shades and small specks go
 * first). Each merged group keeps the color of its largest member, so exact
 * brand colors survive instead of being averaged into new shades.
 */
export function reducePalette(entries: PaletteEntry[], n: number): string[] {
  let groups = entries.map((e) => ({ color: e.color, lab: hexToLab(e.color), area: Math.max(e.area, 1e-6) }));
  while (groups.length > Math.max(1, n)) {
    let bi = 0, bj = 1, best = Infinity;
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const a = groups[i], b = groups[j];
        const cost = ((a.area * b.area) / (a.area + b.area)) * deltaE(a.lab, b.lab) ** 2;
        if (cost < best) { best = cost; bi = i; bj = j; }
      }
    }
    const [a, b] = [groups[bi], groups[bj]];
    const keep = a.area >= b.area ? a : b;
    const merged = { color: keep.color, lab: keep.lab, area: a.area + b.area };
    groups = groups.filter((_, k) => k !== bi && k !== bj);
    groups.push(merged);
  }
  return groups.sort((x, y) => y.area - x.area).map((g) => g.color);
}

/** Where each original color goes: its nearest kept color. */
export function mapToNearest(colors: string[], kept: string[]): Map<string, string> {
  const keptLab = kept.map((c) => [c, hexToLab(c)] as const);
  const map = new Map<string, string>();
  for (const c of colors) {
    const lab = hexToLab(c);
    let best = kept[0];
    let bestD = Infinity;
    for (const [k, kl] of keptLab) {
      const d = deltaE(lab, kl);
      if (d < bestD) { bestD = d; best = k; }
    }
    map.set(c.toUpperCase(), best.toUpperCase());
  }
  return map;
}

/** Recolor a traced SVG (grouped or not) for an instant preview of a reduced palette. */
export function recolorSvg(svg: string, mapping: Map<string, string>): string {
  const seen = new Map<string, number>();
  return svg
    .replace(/fill="#([0-9a-fA-F]{6})"/g, (full, hex: string) => {
      const to = mapping.get(`#${hex.toUpperCase()}`);
      return to ? `fill="${to}"` : full;
    })
    .replace(/<g id="color-([0-9A-F]{6})"/g, (_full, hex: string) => {
      // Keep ids unique when several groups now share a color.
      const to = (mapping.get(`#${hex}`) ?? `#${hex}`).slice(1);
      const count = (seen.get(to) ?? 0) + 1;
      seen.set(to, count);
      return `<g id="color-${to}${count > 1 ? `-${count}` : ''}"`;
    });
}
