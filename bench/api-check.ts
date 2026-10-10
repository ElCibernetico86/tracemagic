// Check the vectorize API: npx tsx bench/api-check.ts [https://deployed.app]
// With no URL it calls the Vercel function handler (api/vectorize.ts) directly.
import sharp from 'sharp';
import { POST } from '../api/vectorize.js';
import { LOGOS } from './logos.js';

async function call(base: string | undefined, body: FormData) {
  if (!base) return POST(new Request('http://local/api/vectorize', { method: 'POST', body }));
  return fetch(`${base.replace(/\/$/, '')}/api/vectorize`, { method: 'POST', body });
}

async function main() {
  const base = process.argv[2];
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
      summary = j.stats ? `paths=${j.stats.paths} colors=${j.stats.colors} server=${j.stats.durationMs}ms` : JSON.stringify(j);
    } catch {}
    console.log(`${name.padEnd(14)} ${res.status} ${summary} total=${Date.now() - started}ms`);
  }

  const bad = new FormData();
  bad.append('image', new Blob(['hi'], { type: 'text/plain' }), 'a.txt');
  const r = await call(base, bad);
  console.log(`wrong type     ${r.status} ${await r.text()}`);
}
main();
