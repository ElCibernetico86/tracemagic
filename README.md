# TraceMagic

Raster → vector tracer tuned for logos: exact color palettes, sharp corners, straight
lines, perfect circles, and clean results from compressed JPGs. Exports SVG,
high-resolution transparent PNG, and DXF (one layer per color).

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000/app.

## Deploy

Hosted on Vercel. The Vite front end builds to `dist/`, and the tracer runs as the
serverless function in `api/vectorize.ts` (see `vercel.json`). Pushing to `main` deploys.
The browser shrinks uploads to ≤2000px / ≤4 MB before sending them, because Vercel
caps request bodies at 4.5 MB.

## How tracing works

`trace-pipeline.ts` drives the engine (it's shared by `server.ts` and `api/vectorize.ts`):

1. `quantize.ts` finds the palette from solid areas, then assigns pixels on a smooth
   upscale so edges land at sub-pixel positions.
2. VTracer (`@neplex/vectorizer`) outlines each color region.
3. `trace-postprocess.ts` fits the final geometry: corners, lines, curves and circles.

Quality checks live in `bench/` (see `bench/README.md`).
