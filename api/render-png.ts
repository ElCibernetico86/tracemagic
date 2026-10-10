// Vercel function for POST /api/render-png (mirrors the route in server.ts).
import { renderPng } from '../trace-pipeline.js';

export async function POST(request: Request) {
  const { svg, width } = await request.json().catch(() => ({}) as Record<string, unknown>);
  if (typeof svg !== 'string' || !svg.includes('<svg') || !Number.isInteger(width) || (width as number) < 16 || (width as number) > 8000) {
    return Response.json({ error: 'Send { svg, width } with a width between 16 and 8000.' }, { status: 400 });
  }
  try {
    const png = await renderPng(svg, width as number);
    return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png' } });
  } catch (error: any) {
    console.error('PNG render error:', error);
    return Response.json({ error: 'Failed to render PNG.', details: error.message }, { status: 500 });
  }
}
