# Trace quality bench

- `npx tsx bench/run.ts <tag>` — trace the synthetic logos in `logos.ts` (badge, geometric, thin
  line art; each as PNG and as JPG q70),
  score pixel error against the exact original at 4×, write side-by-sides to `bench/out/`.
- `npx tsx bench/modes.ts` — smoke-test polygon / pixel / B&W / grayscale / cutout / color cap /
  transparency / large image.
- `npx tsx bench/debug-stages.ts <image> [layerHex]` — print raw and refined path data per color
  layer (`OUT=bench/out/x` also saves each stage as an SVG).
- `npx tsx bench/geom-small.ts` — run the geometry pass on tiny synthetic shapes (2px strokes).
- `npx tsx bench/api-check.ts [https://deployed.app]` — exercise the API (local handler or live).
- `npx tsx bench/dump-quant.ts <image> <out.png>` — save the quantized trace-resolution image.

Run these after any change to `quantize.ts`, `trace-postprocess.ts` or `trace-pipeline.ts`.

Upscaler (Real-ESRGAN, `public/models/realesr-general-x4v3.onnx`):
- `npx tsx bench/upscale-check.ts` — run the model on a blurry test image (bicubic vs AI side by side).
- `npx tsx bench/upscale-vs-direct.ts` — trace small blurry logos directly vs after a 4× AI pass.

