// Check the vectorize API: npx tsx bench/api-check.ts [https://deployed.app]
// With no URL it calls the Vercel function handler (api/vectorize.ts) directly.
import sharp from 'sharp';
import { POST } from '../api/vectorize.js';
import { POST as renderPost } from '../api/render-png.js';
import { LOGOS } from './logos.js';

async function call(base: string | undefined, body: FormData) {
  if (!base) return POST(new Request('http://local/api/vectorize', { method: 'POST', body }));
  return fetch(`${base.replace(/\/$/, '')}/api/vectorize`, { method: 'POST', body });
}

async function render(base: string | undefined, svg: string, width: number) {
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ svg, width }) };
  if (!base) return renderPost(new Request('http://local/api/render-png', init));
  return fetch(`${base.replace(/\/$/, '')}/api/render-png`, init);
}

async function main() {
  const base = process.argv[2];
  let lastSvg = '';
  const png = await sharp(Buffer.from(LOGOS.badge)).png().toBuffer();
  const jpg = await sharp(Buffer.from(LOGOS.geometric)).flatten({ background: '#fff' }).jpeg({ quality: 70 }).toBuffer();

  for (const [name, buf, type] of [['badge.png', png, 'image/png'], ['geometric.jpg', jpg, 'image/jpeg']] as const) {
    const fd = new FormData();
    fd.append('image', new Blob([buf], { type }), name);
    fd.append('maxColors', 'auto');
    const started = Date.now();
    const res = await call(base, fd);
    const text = await res.text();
    let summary = text.slice(0, 160);
    try {
      const j = JSON.parse(text);
      if (j.svg) lastSvg = j.svg;
      summary = j.stats
        ? `paths=${j.stats.paths} colors=${j.stats.colors} palette=${(j.palette ?? []).map((p: any) => p.color).join(',')} server=${j.stats.durationMs}ms`
        : JSON.stringify(j);
    } catch {}
    console.log(`${name.padEnd(14)} ${res.status} ${summary} total=${Date.now() - started}ms`);
  }

  // Fixed palette (color reduction): the result must use exactly these colors.
  {
    const fd = new FormData();
    fd.append('image', new Blob([png], { type: 'image/png' }), 'badge.png');
    fd.append('palette', JSON.stringify(['#FFFFFF', '#C8102E', '#1B2A41']));
    const res = await call(base, fd);
    const j = await res.json();
    console.log(`fixed palette  ${res.status} palette=${(j.palette ?? []).map((p: any) => p.color).join(',')}`);
  }

  for (const width of [4500, 6000]) {
    const started = Date.now();
    const res = await render(base, lastSvg, width);
    if (!res.ok) {
      console.log(`png ${width}px      ${res.status} ${await res.text()}`);
      continue;
    }
    const png = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(png).metadata();
    console.log(`png ${width}px      ${res.status} ${meta.width}x${meta.height} alpha=${meta.hasAlpha} ${(png.length / 1024).toFixed(0)}KB ${Date.now() - started}ms`);
  }

  const bad = new FormData();
  bad.append('image', new Blob(['hi'], { type: 'text/plain' }), 'a.txt');
  const r = await call(base, bad);
  console.log(`wrong type     ${r.status} ${await r.text()}`);
}
main();
