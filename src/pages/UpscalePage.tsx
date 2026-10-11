import React, { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, ArrowRight, Download, Loader2, Maximize2, Upload, Wand2, ZoomIn } from 'lucide-react';
import { cropCanvas, previewCanvas, upscaleImage, type Backend, type UpscaleProgress } from '../lib/upscaler';
import { encodePng } from '../lib/png';
import { downloadBlob } from '../lib/download';

type Factor = 2 | 4;
type View = 'compare' | 'detail';

interface Result {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  backend: Backend;
  ms: number;
  factor: Factor;
}

const DETAIL_SIZE = { w: 640, h: 480 };

const segmentClass = (active: boolean) =>
  `flex-1 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
    active ? 'bg-[#C1FF00] text-black' : 'bg-white/5 text-white/60 hover:bg-white/10 hover:text-white'
  }`;

export default function UpscalePage() {
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const [originalSize, setOriginalSize] = useState<{ w: number; h: number } | null>(null);
  const [factor, setFactor] = useState<Factor>(4);
  const [busy, setBusy] = useState<'model' | 'upscale' | 'export' | null>(null);
  const [progress, setProgress] = useState<UpscaleProgress | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [resultPreview, setResultPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('compare');
  const [divider, setDivider] = useState(50);
  const [focus, setFocus] = useState<{ x: number; y: number }>({ x: 0.5, y: 0.5 });
  const abortRef = useRef<AbortController | null>(null);
  const beforeRef = useRef<HTMLDivElement>(null);
  const afterRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const acceptFile = (selected: File) => {
    if (!selected.type.startsWith('image/')) {
      setError('Please choose an image (PNG, JPG, WebP).');
      return;
    }
    abortRef.current?.abort();
    setFile(selected);
    setOriginal(URL.createObjectURL(selected));
    setResult(null);
    setResultPreview(null);
    setError(null);
    setFocus({ x: 0.5, y: 0.5 });
    createImageBitmap(selected)
      .then((bmp) => {
        setOriginalSize({ w: bmp.width, h: bmp.height });
        bmp.close();
      })
      .catch(() => setOriginalSize(null));
  };

  const runUpscale = async () => {
    if (!file) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError(null);
    setResult(null);
    setResultPreview(null);
    setProgress(null);
    setBusy('model');
    const started = performance.now();
    try {
      const out = await upscaleImage(
        file,
        factor,
        (p) => {
          setBusy('upscale');
          setProgress(p);
        },
        controller.signal,
      );
      const res = { ...out, ms: performance.now() - started, factor };
      setResult(res);
      setResultPreview(previewCanvas(res.rgba, res.width, res.height).toDataURL('image/png'));
    } catch (err: any) {
      if (err?.name !== 'AbortError') setError(err?.message || 'Upscaling failed.');
    } finally {
      if (abortRef.current === controller) setBusy(null);
    }
  };

  const baseName = () => file?.name.replace(/\.[^.]+$/, '') || 'image';

  const exportPng = async () => {
    if (!result) return null;
    setBusy('export');
    try {
      return await encodePng(result.rgba, result.width, result.height);
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async () => {
    try {
      const png = await exportPng();
      if (png) downloadBlob(png, `${baseName()}-${result!.factor}x.png`);
    } catch (err: any) {
      setError(err?.message || 'Could not save the PNG.');
    }
  };

  const handleSendToTracer = async () => {
    try {
      const png = await exportPng();
      if (!png) return;
      const handoff = new File([png], `${baseName()}-${result!.factor}x.png`, { type: 'image/png' });
      navigate('/app', { state: { file: handoff } });
    } catch (err: any) {
      setError(err?.message || 'Could not hand the image to the tracer.');
    }
  };

  // Detail view: 1:1 crop of the result next to the original enlarged the ordinary way.
  useEffect(() => {
    if (view !== 'detail' || !result || !original || !beforeRef.current || !afterRef.current) return;
    const cx = focus.x * result.width;
    const cy = focus.y * result.height;
    const { canvas: after, x0, y0 } = cropCanvas(result.rgba, result.width, result.height, cx, cy, DETAIL_SIZE.w, DETAIL_SIZE.h);
    after.className = 'w-full h-auto block';
    afterRef.current.replaceChildren(after);

    const img = new Image();
    img.onload = () => {
      const before = document.createElement('canvas');
      before.width = after.width;
      before.height = after.height;
      const ctx = before.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingQuality = 'high';
      const f = result.factor;
      ctx.drawImage(img, x0 / f, y0 / f, after.width / f, after.height / f, 0, 0, after.width, after.height);
      before.className = 'w-full h-auto block';
      beforeRef.current?.replaceChildren(before);
    };
    img.src = original;
  }, [view, result, original, focus]);

  const pickFocus = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setFocus({
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    });
    setView('detail');
  };

  const outputSize = originalSize ? { w: originalSize.w * factor, h: originalSize.h * factor } : null;
  const percent = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="text-center mb-10">
        <span className="inline-block bg-white/5 border border-white/10 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-white/60 mb-4">
          AI Upscaler
        </span>
        <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight">Sharpen &amp; Upscale</h1>
        <p className="text-white/50 mt-2 text-sm">
          Make small or blurry images 2× or 4× larger with AI — then trace them or use them anywhere. Runs on your device.
        </p>
      </div>

      <div className="grid lg:grid-cols-[340px_1fr] gap-6 items-start">
        {/* Controls */}
        <div className="bg-[#111] rounded-3xl border border-white/10 p-6 flex flex-col gap-6">
          <div>
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">1 · Image</p>
            {!original ? (
              <label
                className="border-2 border-dashed border-white/20 bg-black/40 rounded-2xl p-8 flex flex-col items-center text-center hover:border-[#C1FF00]/50 transition-colors cursor-pointer"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  const dropped = e.dataTransfer.files?.[0];
                  if (dropped) acceptFile(dropped);
                }}
              >
                <Upload className="w-7 h-7 text-[#C1FF00] mb-3" />
                <span className="text-sm font-bold uppercase tracking-wide">Choose image</span>
                <span className="text-[10px] text-white/40 uppercase tracking-widest mt-1">PNG, JPG, WebP</span>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  accept="image/png, image/jpeg, image/webp"
                  onChange={(e: ChangeEvent<HTMLInputElement>) => {
                    const selected = e.target.files?.[0];
                    if (selected) acceptFile(selected);
                  }}
                />
              </label>
            ) : (
              <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black flex items-center justify-center max-h-44">
                <img src={original} alt="Original" className="max-w-full max-h-44 object-contain" />
                <button
                  onClick={() => {
                    abortRef.current?.abort();
                    setFile(null);
                    setOriginal(null);
                    setOriginalSize(null);
                    setResult(null);
                    setResultPreview(null);
                  }}
                  className="absolute top-3 right-3 bg-black/80 text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-[#C1FF00] hover:text-black transition-colors"
                >
                  Change
                </button>
              </div>
            )}
            {originalSize && (
              <p className="text-[10px] font-mono text-white/40 mt-2">
                {originalSize.w} × {originalSize.h}px
              </p>
            )}
          </div>

          <div>
            <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">2 · Scale</p>
            <div className="flex gap-2">
              {([2, 4] as Factor[]).map((f) => (
                <button key={f} onClick={() => setFactor(f)} className={segmentClass(factor === f)} disabled={!!busy}>
                  {f}×
                </button>
              ))}
            </div>
            {outputSize && (
              <p className="text-[10px] font-mono text-white/40 mt-2">
                Output: {outputSize.w} × {outputSize.h}px
              </p>
            )}
          </div>

          <button
            onClick={busy === 'upscale' || busy === 'model' ? () => abortRef.current?.abort() : runUpscale}
            disabled={!file || busy === 'export'}
            className="w-full flex items-center justify-center gap-2 bg-[#C1FF00] hover:bg-[#a6db00] disabled:opacity-40 text-black py-3.5 rounded-xl text-xs font-black uppercase tracking-widest transition-colors"
          >
            {busy === 'model' || busy === 'upscale' ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Cancel
              </>
            ) : (
              <>
                <Wand2 className="w-4 h-4" /> Upscale {factor}×
              </>
            )}
          </button>

          {busy === 'model' && (
            <p className="text-[10px] text-white/50 -mt-3">Loading the AI model (first time only, ~5 MB + engine)…</p>
          )}
          {busy === 'upscale' && progress && (
            <div className="-mt-2">
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div className="h-full bg-[#C1FF00] transition-all" style={{ width: `${percent}%` }} />
              </div>
              <p className="text-[10px] text-white/50 mt-2">
                {percent}% · tile {progress.done}/{progress.total} ·{' '}
                {progress.backend === 'webgpu' ? 'GPU' : 'CPU — slower, larger images can take minutes'}
              </p>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg p-3">
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-2 pt-4 border-t border-white/10">
              <p className="text-[10px] font-mono text-white/40 mb-1">
                {result.width} × {result.height}px · {(result.ms / 1000).toFixed(1)}s ·{' '}
                {result.backend === 'webgpu' ? 'GPU' : 'CPU'}
              </p>
              <button
                onClick={handleSendToTracer}
                disabled={!!busy}
                className="w-full flex items-center justify-center gap-2 bg-[#C1FF00] hover:bg-[#a6db00] disabled:opacity-40 text-black py-3 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
              >
                Send to Tracer <ArrowRight className="w-4 h-4" />
              </button>
              <button
                onClick={handleDownload}
                disabled={!!busy}
                className="w-full flex items-center justify-center gap-2 bg-white/10 hover:bg-white/20 disabled:opacity-40 text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-colors"
              >
                {busy === 'export' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Download PNG
              </button>
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="bg-[#111] rounded-3xl border border-white/10 p-6 min-h-[480px] flex flex-col">
          <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
            <h2 className="font-bold text-sm uppercase tracking-widest">Preview</h2>
            {result && (
              <div className="flex gap-1 bg-white/5 rounded-lg p-1">
                <button
                  onClick={() => setView('compare')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest ${view === 'compare' ? 'bg-[#C1FF00] text-black' : 'text-white/60'}`}
                >
                  <Maximize2 className="w-3.5 h-3.5" /> Whole
                </button>
                <button
                  onClick={() => setView('detail')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest ${view === 'detail' ? 'bg-[#C1FF00] text-black' : 'text-white/60'}`}
                >
                  <ZoomIn className="w-3.5 h-3.5" /> 100%
                </button>
              </div>
            )}
          </div>

          {!original && (
            <div className="flex-1 flex items-center justify-center text-white/30 text-sm">Choose an image to start.</div>
          )}

          {original && (!result || view === 'compare') && (
            <>
              <div
                className="relative flex-1 flex items-center justify-center rounded-2xl overflow-hidden bg-[repeating-conic-gradient(#1a1a1a_0%_25%,#222_0%_50%)] bg-[length:20px_20px] cursor-zoom-in select-none"
                onClick={result ? pickFocus : undefined}
              >
                <div className="relative w-full">
                  {/* Both layers fill the same box with object-contain, so they line up at any size. */}
                  <img src={original} alt="Before" className="block w-full h-[60vh] object-contain" />
                  {resultPreview && (
                    <img
                      src={resultPreview}
                      alt="After"
                      className="absolute inset-0 w-full h-full object-contain"
                      style={{ clipPath: `inset(0 0 0 ${divider}%)` }}
                    />
                  )}
                  {resultPreview && (
                    <div className="absolute top-0 bottom-0 w-0.5 bg-[#C1FF00] pointer-events-none" style={{ left: `${divider}%` }} />
                  )}
                </div>
                {resultPreview && (
                  <>
                    <span className="absolute top-3 left-3 bg-black/70 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded">Before</span>
                    <span className="absolute top-3 right-3 bg-black/70 text-[#C1FF00] text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded">After</span>
                  </>
                )}
              </div>
              {resultPreview && (
                <>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={divider}
                    onChange={(e) => setDivider(Number(e.target.value))}
                    className="w-full mt-4 accent-[#C1FF00]"
                    aria-label="Before/after divider"
                  />
                  <p className="text-[10px] text-white/30 text-center mt-1">Drag to compare · tap the image to inspect a spot at 100%</p>
                </>
              )}
            </>
          )}

          {result && view === 'detail' && (
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-white/40 mb-2">Before (ordinary enlarge)</p>
                <div ref={beforeRef} className="rounded-xl overflow-hidden border border-white/10 bg-black" />
              </div>
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-[#C1FF00] mb-2">After (AI)</p>
                <div ref={afterRef} className="rounded-xl overflow-hidden border border-white/10 bg-black" />
              </div>
              <p className="sm:col-span-2 text-[10px] text-white/30 text-center">
                Actual pixels at the spot you tapped. Switch to Whole and tap elsewhere to inspect another area.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
