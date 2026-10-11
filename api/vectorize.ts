// Vercel function for POST /api/vectorize (the local dev server has the same
// route in server.ts). Uses the Web Request API, so multipart parsing is native.
import { SUPPORTED_IMAGE_TYPES, parseTraceOptions, traceImage } from '../trace-pipeline.js';

export async function POST(request: Request) {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: 'Could not read the uploaded image.' }, { status: 400 });
  }

  const image = form.get('image');
  if (!(image instanceof File)) {
    return Response.json({ error: 'No image uploaded.' }, { status: 400 });
  }
  if (!SUPPORTED_IMAGE_TYPES.has(image.type)) {
    return Response.json({ error: 'Please upload a PNG, JPG, or WebP image.' }, { status: 400 });
  }

  const fields: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value === 'string') fields[key] = value;
  }

  try {
    const buffer = Buffer.from(await image.arrayBuffer());
    const { svg, palette, stats } = await traceImage(buffer, parseTraceOptions(fields));
    return Response.json({ svg, palette, engine: 'vtracer', stats });
  } catch (error: any) {
    console.error('Vectorization error:', error);
    return Response.json({ error: 'Failed to vectorize image.', details: error.message }, { status: 500 });
  }
}
