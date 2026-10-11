import React, { useState, useRef, useEffect, useCallback, useMemo, ChangeEvent } from 'react';
import {
  Upload,
  Download,
  Loader2,
  Sparkles,
  AlertCircle,
  Layout,
  Copy,
  Check,
  ZoomIn,
  ZoomOut,
  Maximize,
  Columns2,
  Image as ImageIcon,
  PenTool,
  Scissors,
  Palette,
  RotateCcw,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { svgToDxf, svgToPng } from '../lib/exporters';
import { downloadBlob } from '../lib/download';
import { mapToNearest, recolorSvg, reducePalette, type PaletteEntry } from '../lib/palette';

type TraceMode = 'color' | 'grayscale' | 'bw';
type CurveMode = 'spline' | 'polygon' | 'pixel';
type ShapeStacking = 'stacked' | 'cutout';
type ViewMode = 'split' | 'vector' | 'original';
type CanvasBg = 'checker' | 'light' | 'dark';
type PresetId = 'auto' | 'photo' | 'logo' | 'sketch';

interface TraceSettings {
  mode: TraceMode;
  autoColors: boolean;
  maxColors: number;
  detail: number;
  smoothness: number;
  curveMode: CurveMode;
  stacking: ShapeStacking;
  groupByColor: boolean;
  snapAxes: boolean;
}

interface TraceStats {
  paths: number;
  colors: number;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
}

const OUTPUT_DEFAULTS = { stacking: 'stacked' as ShapeStacking, groupByColor: true, snapAxes: true };

const PRESETS: Record<PresetId, { label: string; settings: TraceSettings }> = {
  auto: {
    label: 'Auto',
    settings: { mode: 'color', autoColors: true, maxColors: 32, detail: 80, smoothness: 50, curveMode: 'spline', ...OUTPUT_DEFAULTS },
  },
  photo: {
    label: 'Photo',
    settings: { mode: 'color', autoColors: true, maxColors: 48, detail: 60, smoothness: 65, curveMode: 'spline', ...OUTPUT_DEFAULTS },
  },
  logo: {
    label: 'Logo',
    settings: { mode: 'color', autoColors: false, maxColors: 12, detail: 85, smoothness: 40, curveMode: 'spline', ...OUTPUT_DEFAULTS },
  },
  sketch: {
    label: 'Sketch',
    settings: { mode: 'bw', autoColors: true, maxColors: 32, detail: 75, smoothness: 55, curveMode: 'spline', ...OUTPUT_DEFAULTS },
  },
};

const MODE_LABELS: { id: TraceMode; label: string }[] = [
  { id: 'color', label: 'Color' },
  { id: 'grayscale', label: 'Grays' },
  { id: 'bw', label: 'B&W' },
];

const CURVE_LABELS: { id: CurveMode; label: string }[] = [
  { id: 'spline', label: 'Curves' },
  { id: 'polygon', label: 'Polygons' },
  { id: 'pixel', label: 'Pixel' },
];

/**
 * Uploads are shrunk in the browser first: the hosted API (Vercel) rejects
 * request bodies over 4.5 MB, and the tracer works at ≤2000px anyway.
 */
const MAX_UPLOAD_DIMENSION = 2000;
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number) {
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not prepare the image.'))), type, quality),
  );
}

async function prepareUpload(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    let scale = Math.min(1, MAX_UPLOAD_DIMENSION / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= MAX_UPLOAD_BYTES) return file;
    const isJpeg = file.type === 'image/jpeg';
    for (;;) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      // JPEG stays JPEG; anything else stays PNG so transparency survives.
      const blob = isJpeg ? await canvasToBlob(canvas, 'image/jpeg', 0.92) : await canvasToBlob(canvas, 'image/png');
      if (blob.size <= MAX_UPLOAD_BYTES || scale < 0.2) return blob;
      scale *= 0.8;
    }
  } finally {
    bitmap.close();
  }
}

/** PNG export widths; 4500 is the usual print-on-demand canvas width. */
const PNG_WIDTHS = [1000, 2000, 4500, 6000];

function ToggleRow({ label, hint, on, onToggle }: { label: string; hint: string; on: boolean; onToggle: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 mt-4">
      <div>
        <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">{label}</p>
        <p className="text-[9px] text-white/25 mt-0.5">{hint}</p>
      </div>
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={on}
        aria-label={label}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${on ? 'bg-[#C1FF00]' : 'bg-white/10'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${on ? 'left-[22px] bg-black' : 'left-0.5'}`} />
      </button>
    </div>
  );
}

function formatKb(bytes: number) {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

export default function AppPage() {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [imageAspect, setImageAspect] = useState<number | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [svgResult, setSvgResult] = useState<string | null>(null);
  // Color reduction: the auto-detected palette, the colors picked in the
  // Colors panel (null = unchanged), and the palette the tracer was told to use.
  const [basePalette, setBasePalette] = useState<PaletteEntry[] | null>(null);
  const [resultPalette, setResultPalette] = useState<PaletteEntry[] | null>(null);
  const [keep, setKeep] = useState<string[] | null>(null);
  const [fixedPalette, setFixedPalette] = useState<string[] | null>(null);
  const [stats, setStats] = useState<TraceStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [preset, setPreset] = useState<PresetId | 'custom'>('auto');
  const [settings, setSettings] = useState<TraceSettings>(PRESETS.auto.settings);

  const [viewMode, setViewMode] = useState<ViewMode>('split');
  const [pngWidth, setPngWidth] = useState(4500);
  const uploadRef = useRef<{ file: File; blob: Promise<Blob> } | null>(null);
  const [exporting, setExporting] = useState<'png' | null>(null);
  const [canvasBg, setCanvasBg] = useState<CanvasBg>('checker');
  const [divider, setDivider] = useState(50);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const hasTracedRef = useRef(false);
  const panState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const navigate = useNavigate();

  const acceptFile = (selected: File) => {
    if (!selected.type.startsWith('image/')) {
      setError('Please upload a valid image file (PNG, JPG, WebP, GIF).');
      return;
    }
    setFile(selected);
    setPreview(URL.createObjectURL(selected));
    setSvgResult(null);
    setBasePalette(null);
    setResultPalette(null);
    setKeep(null);
    setFixedPalette(null);
    setStats(null);
    setError(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    hasTracedRef.current = false;
  };

  // An image handed over from the Upscale page arrives in navigation state.
  const location = useLocation();
  useEffect(() => {
    const incoming = (location.state as { file?: File } | null)?.file;
    if (incoming instanceof File) {
      acceptFile(incoming);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) acceptFile(selected);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped);
  };

  const runTrace = useCallback(async () => {
    if (!file) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsTracing(true);
    setError(null);

    // Prepare once per file; settings changes re-trace without re-processing.
    if (uploadRef.current?.file !== file) {
      uploadRef.current = { file, blob: prepareUpload(file) };
    }
    let upload: Blob;
    try {
      upload = await uploadRef.current.blob;
    } catch {
      upload = file;
    }

    const formData = new FormData();
    formData.append('image', upload, file.name);
    formData.append('mode', settings.mode);
    formData.append('maxColors', settings.autoColors ? 'auto' : String(settings.maxColors));
    formData.append('detail', String(settings.detail));
    formData.append('smoothness', String(settings.smoothness));
    formData.append('curveMode', settings.curveMode);
    formData.append('stacking', settings.stacking);
    formData.append('groupByColor', String(settings.groupByColor));
    formData.append('snapAxes', String(settings.snapAxes));
    if (fixedPalette) formData.append('palette', JSON.stringify(fixedPalette));

    try {
      const res = await fetch('/api/vectorize', {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to vectorize image');
      }
      setSvgResult(data.svg);
      setStats(data.stats ?? null);
      setResultPalette(data.palette ?? null);
      if (!fixedPalette) setBasePalette(data.palette ?? null);
      setKeep(null);
      hasTracedRef.current = true;
    } catch (err: any) {
      if (err.name !== 'AbortError') setError(err.message);
    } finally {
      if (abortRef.current === controller) setIsTracing(false);
    }
  }, [file, settings, fixedPalette]);

  // Re-trace automatically when settings change after the first trace.
  useEffect(() => {
    if (!file || !hasTracedRef.current) return;
    const timer = setTimeout(runTrace, 500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // Re-trace when a reduced palette is applied (or reset).
  useEffect(() => {
    if (!file || !hasTracedRef.current) return;
    runTrace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedPalette]);

  // Non-passive wheel listener so zooming doesn't scroll the page.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setZoom((z) => {
        const next = Math.min(8, Math.max(1, z * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        if (next === 1) setPan({ x: 0, y: 0 });
        return next;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [preview]);

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    // Presets tune tracing quality; keep the user's SVG output choices as-is.
    setSettings((prev) => ({
      ...PRESETS[id].settings,
      stacking: prev.stacking,
      groupByColor: prev.groupByColor,
      snapAxes: prev.snapAxes,
    }));
  };

  const updateSettings = (patch: Partial<TraceSettings>) => {
    setPreset('custom');
    // A new color mode or color limit makes a hand-picked palette meaningless.
    if ('mode' in patch || 'autoColors' in patch || 'maxColors' in patch) {
      setFixedPalette(null);
      setKeep(null);
    }
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const zoomBy = (factor: number) => {
    setZoom((z) => {
      const next = Math.min(8, Math.max(1, z * factor));
      if (next === 1) setPan({ x: 0, y: 0 });
      return next;
    });
  };

  const resetView = () => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  };

  const handleCanvasPointerDown = (e: React.PointerEvent) => {
    if (zoom <= 1) return;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    panState.current = { x: e.clientX, y: e.clientY, panX: pan.x, panY: pan.y };
  };

  const handleCanvasPointerMove = (e: React.PointerEvent) => {
    if (!panState.current) return;
    setPan({
      x: panState.current.panX + (e.clientX - panState.current.x),
      y: panState.current.panY + (e.clientY - panState.current.y),
    });
  };

  const handleCanvasPointerUp = () => {
    panState.current = null;
  };

  const handleDividerPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    const container = canvasRef.current;
    if (!container) return;
    const handle = e.currentTarget as HTMLElement;
    handle.setPointerCapture(e.pointerId);

    const onMove = (ev: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      setDivider(Math.min(98, Math.max(2, ((ev.clientX - rect.left) / rect.width) * 100)));
    };
    const onUp = () => {
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
  };

  // ---- Color reduction ----
  const appliedColors = useMemo(
    () => (fixedPalette ?? basePalette?.map((e) => e.color) ?? []).map((c) => c.toUpperCase()),
    [fixedPalette, basePalette],
  );
  const chosenColors = keep ?? appliedColors;
  const colorsPending =
    keep !== null &&
    (keep.length !== appliedColors.length || keep.some((c) => !appliedColors.includes(c)));
  const swatchTargets = useMemo(
    () => (basePalette && chosenColors.length ? mapToNearest(basePalette.map((e) => e.color), chosenColors) : new Map<string, string>()),
    [basePalette, chosenColors],
  );
  // Instant preview: recolor the current result into the chosen colors.
  const displaySvg = useMemo(() => {
    if (!svgResult || !colorsPending || !resultPalette) return svgResult;
    return recolorSvg(svgResult, mapToNearest(resultPalette.map((e) => e.color), chosenColors));
  }, [svgResult, colorsPending, resultPalette, chosenColors]);

  const setColorCount = (n: number) => {
    if (!basePalette) return;
    setKeep(reducePalette(basePalette, n).map((c) => c.toUpperCase()));
  };
  const toggleColor = (color: string) => {
    const c = color.toUpperCase();
    if (chosenColors.includes(c)) {
      if (chosenColors.length > 1) setKeep(chosenColors.filter((k) => k !== c));
    } else {
      setKeep([...chosenColors, c]);
    }
  };
  const applyColors = () => {
    if (!basePalette) return;
    // Keeping every detected color is the same as automatic detection.
    const all = basePalette.length === chosenColors.length && basePalette.every((e) => chosenColors.includes(e.color.toUpperCase()));
    const ordered = basePalette.map((e) => e.color.toUpperCase()).filter((c) => chosenColors.includes(c));
    setKeep(null);
    setFixedPalette(all ? null : ordered);
  };
  const resetColors = () => {
    setKeep(null);
    setFixedPalette(null);
  };

  const baseName = () => file?.name.replace(/\.[^.]+$/, '') || 'tracemagic';

  const handleDownload = () => {
    if (!svgResult) return;
    downloadBlob(new Blob([svgResult], { type: 'image/svg+xml' }), `${baseName()}-vector.svg`);
  };

  const handleDownloadPng = async () => {
    if (!svgResult) return;
    setExporting('png');
    try {
      const blob = await svgToPng(svgResult, pngWidth);
      downloadBlob(blob, `${baseName()}-${pngWidth}px.png`);
    } catch (err: any) {
      setError(err?.message || 'Could not create the PNG.');
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadDxf = () => {
    if (!svgResult) return;
    try {
      const { dxf } = svgToDxf(svgResult);
      downloadBlob(new Blob([dxf], { type: 'application/dxf' }), `${baseName()}.dxf`);
    } catch (err: any) {
      setError(err?.message || 'Could not create the DXF.');
    }
  };

  const handleCopy = async () => {
    if (!svgResult) return;
    try {
      await navigator.clipboard.writeText(svgResult);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const aspect = stats ? stats.width / stats.height : imageAspect;
  const bgClass =
    canvasBg === 'light' ? 'bg-white' : canvasBg === 'dark' ? 'bg-black' : 'bg-black';
  const showSplit = viewMode === 'split' && !!svgResult;

  const sliderClass =
    'w-full h-1.5 appearance-none rounded-full bg-white/10 accent-[#C1FF00] cursor-pointer';
  const segmentClass = (active: boolean) =>
    `flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
      active ? 'bg-[#C1FF00] text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
    }`;

  return (
    <div className="max-w-[1500px] mx-auto px-4 sm:px-6 lg:px-8 py-10 w-full flex-grow flex flex-col">
      <div className="mb-8 text-center">
        <div className="text-[10px] font-bold uppercase tracking-[1px] bg-white/5 text-white px-3 py-1.5 rounded-full inline-block mb-4">
          Trace Workspace
        </div>
        <h1 className="text-4xl font-black text-white mb-2 uppercase tracking-tight">Vector Tracer</h1>
        <p className="text-white/60">Upload a raster image and tune the trace until it's perfect.</p>
      </div>

      {error && (
        <div className="mb-6 bg-rose-500/10 text-rose-400 p-4 rounded-xl flex items-center gap-3 border border-rose-500/20">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="grid lg:grid-cols-[360px_1fr] gap-6 items-start flex-grow">
        {/* Controls column */}
        <div className="flex flex-col gap-6">
          {/* Source */}
          <div className="bg-[#111] rounded-3xl border border-white/10 p-6">
            <h2 className="font-bold text-white mb-4 flex items-center gap-3 text-sm uppercase tracking-widest">
              <span className="bg-white/10 text-white w-6 h-6 rounded flex items-center justify-center text-xs">1</span>
              Source
            </h2>

            {!preview ? (
              <label
                className="border-2 border-dashed border-white/20 bg-black/40 rounded-2xl p-8 flex flex-col items-center justify-center text-center hover:bg-white/5 hover:border-[#C1FF00]/50 transition-colors cursor-pointer group"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
              >
                <div className="bg-white/5 w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-4 group-hover:scale-110 transition-transform">
                  <Upload className="w-7 h-7 text-[#C1FF00]" />
                </div>
                <h3 className="text-base font-bold text-white mb-2 uppercase tracking-wide">Drop bitmap here</h3>
                <p className="text-[10px] text-white/40 uppercase tracking-widest">PNG, JPG, WebP, GIF · Max 15MB</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  className="hidden"
                  accept="image/png, image/jpeg, image/jpg, image/webp, image/gif"
                  onChange={handleFileChange}
                />
              </label>
            ) : (
              <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black flex items-center justify-center max-h-44">
                <img src={preview} alt="Preview" className="max-w-full max-h-44 object-contain" />
                <button
                  onClick={() => {
                    setFile(null);
                    setPreview(null);
                    setSvgResult(null);
                    setStats(null);
                    setImageAspect(null);
                    hasTracedRef.current = false;
                  }}
                  className="absolute top-3 right-3 bg-black/80 backdrop-blur text-white px-3 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-[#C1FF00] hover:text-black transition-colors"
                >
                  Change
                </button>
              </div>
            )}

            <button
              onClick={runTrace}
              disabled={!file || isTracing}
              className="w-full mt-5 bg-[#C1FF00] hover:bg-[#a6db00] disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed text-black py-3.5 rounded-xl font-black uppercase tracking-[1.5px] text-sm transition-all flex items-center justify-center gap-2"
            >
              {isTracing ? (
                <><Loader2 className="w-5 h-5 animate-spin" /> Processing...</>
              ) : (
                <><Sparkles className="w-5 h-5" /> Trace Image</>
              )}
            </button>
          </div>

          {/* Settings */}
          <div className="bg-[#111] rounded-3xl border border-white/10 p-6">
            <h2 className="font-bold text-white mb-4 flex items-center gap-3 text-sm uppercase tracking-widest">
              <span className="bg-white/10 text-white w-6 h-6 rounded flex items-center justify-center text-xs">2</span>
              Settings
              {hasTracedRef.current && (
                <span className="ml-auto text-[9px] text-[#C1FF00]/70 normal-case tracking-normal font-medium">
                  auto re-traces
                </span>
              )}
            </h2>

            {/* Presets */}
            <div className="grid grid-cols-4 gap-2 mb-5">
              {(Object.keys(PRESETS) as PresetId[]).map((id) => (
                <button key={id} onClick={() => applyPreset(id)} className={segmentClass(preset === id)}>
                  {PRESETS[id].label}
                </button>
              ))}
            </div>

            {/* Mode */}
            <div className="mb-5">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Color Mode</p>
              <div className="flex gap-2">
                {MODE_LABELS.map(({ id, label }) => (
                  <button key={id} onClick={() => updateSettings({ mode: id })} className={segmentClass(settings.mode === id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Palette */}
            <div className={`mb-5 ${settings.mode === 'bw' ? 'opacity-30 pointer-events-none' : ''}`}>
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Max Colors</p>
                <button
                  onClick={() => updateSettings({ autoColors: !settings.autoColors })}
                  className={`text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded transition-colors ${
                    settings.autoColors ? 'bg-[#C1FF00] text-black' : 'bg-white/10 text-white/50 hover:text-white'
                  }`}
                >
                  Auto
                </button>
              </div>
              <div className={settings.autoColors ? 'opacity-30 pointer-events-none' : ''}>
                <input
                  type="range"
                  min={2}
                  max={64}
                  value={settings.maxColors}
                  onChange={(e) => updateSettings({ maxColors: Number(e.target.value), autoColors: false })}
                  className={sliderClass}
                />
                <p className="text-right text-[10px] text-white/40 mt-1 font-mono">{settings.maxColors} colors</p>
              </div>
            </div>

            {/* Detail */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Detail</p>
                <span className="text-[10px] text-white/40 font-mono">{settings.detail}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={settings.detail}
                onChange={(e) => updateSettings({ detail: Number(e.target.value) })}
                className={sliderClass}
              />
              <div className="flex justify-between text-[9px] text-white/25 uppercase tracking-widest mt-1">
                <span>Cleaner</span>
                <span>Finer</span>
              </div>
            </div>

            {/* Smoothness */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Smoothing</p>
                <span className="text-[10px] text-white/40 font-mono">{settings.smoothness}</span>
              </div>
              <input
                type="range"
                min={0}
                max={100}
                value={settings.smoothness}
                onChange={(e) => updateSettings({ smoothness: Number(e.target.value) })}
                className={sliderClass}
              />
              <div className="flex justify-between text-[9px] text-white/25 uppercase tracking-widest mt-1">
                <span>Sharp corners</span>
                <span>Smooth curves</span>
              </div>
            </div>

            {/* Curve fitting */}
            <div className="mb-5">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Curve Fitting</p>
              <div className="flex gap-2">
                {CURVE_LABELS.map(({ id, label }) => (
                  <button key={id} onClick={() => updateSettings({ curveMode: id })} className={segmentClass(settings.curveMode === id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* SVG output */}
            <div className="pt-5 border-t border-white/10">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Shape Stacking</p>
              <div className="flex gap-2 mb-1">
                <button
                  onClick={() => updateSettings({ stacking: 'stacked' })}
                  className={segmentClass(settings.stacking === 'stacked')}
                >
                  Stacked
                </button>
                <button
                  onClick={() => updateSettings({ stacking: 'cutout' })}
                  className={segmentClass(settings.stacking === 'cutout')}
                >
                  Cut-outs
                </button>
              </div>
              <p className="text-[9px] text-white/25 mb-4">
                {settings.stacking === 'stacked'
                  ? 'Each color sits on top of the one below — no gaps between colors.'
                  : 'Colors never overlap — best for cut files and screen printing.'}
              </p>

              <ToggleRow
                label="Group by Color"
                hint="One named group per color in the SVG (DXF always uses one layer per color)."
                on={settings.groupByColor}
                onToggle={() => updateSettings({ groupByColor: !settings.groupByColor })}
              />
              <ToggleRow
                label="Snap Level & Plumb"
                hint="Straight edges within 2° of horizontal or vertical become exactly level or plumb."
                on={settings.snapAxes}
                onToggle={() => updateSettings({ snapAxes: !settings.snapAxes })}
              />
            </div>
          </div>
        </div>

        {/* Preview column */}
        <div className="bg-[#111] rounded-3xl border border-white/10 p-6 flex flex-col min-h-[560px] lg:sticky lg:top-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 className="font-bold text-white flex items-center gap-3 text-sm uppercase tracking-widest">
              <span className="bg-white/10 text-white w-6 h-6 rounded flex items-center justify-center text-xs">3</span>
              Preview
            </h2>

            <div className="flex items-center gap-2 flex-wrap">
              {/* View mode */}
              <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                <button
                  onClick={() => setViewMode('split')}
                  disabled={!svgResult}
                  title="Split comparison"
                  className={`p-1.5 rounded transition-colors disabled:opacity-30 ${viewMode === 'split' ? 'bg-[#C1FF00] text-black' : 'text-white/50 hover:text-white'}`}
                >
                  <Columns2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('vector')}
                  disabled={!svgResult}
                  title="Vector only"
                  className={`p-1.5 rounded transition-colors disabled:opacity-30 ${viewMode === 'vector' ? 'bg-[#C1FF00] text-black' : 'text-white/50 hover:text-white'}`}
                >
                  <PenTool className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setViewMode('original')}
                  title="Original only"
                  className={`p-1.5 rounded transition-colors ${viewMode === 'original' ? 'bg-[#C1FF00] text-black' : 'text-white/50 hover:text-white'}`}
                >
                  <ImageIcon className="w-4 h-4" />
                </button>
              </div>

              {/* Background */}
              <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                {(['checker', 'light', 'dark'] as CanvasBg[]).map((bg) => (
                  <button
                    key={bg}
                    onClick={() => setCanvasBg(bg)}
                    title={`${bg} background`}
                    className={`w-7 h-7 rounded border transition-all ${canvasBg === bg ? 'border-[#C1FF00]' : 'border-white/10 hover:border-white/40'} ${
                      bg === 'light' ? 'bg-white' : bg === 'dark' ? 'bg-black' : 'bg-[conic-gradient(#666_0_25%,#999_0_50%,#666_0_75%,#999_0)] bg-[length:8px_8px]'
                    }`}
                  />
                ))}
              </div>

              {/* Zoom */}
              <div className="flex bg-white/5 rounded-lg p-1 gap-1 items-center">
                <button onClick={() => zoomBy(1 / 1.3)} title="Zoom out" className="p-1.5 rounded text-white/50 hover:text-white transition-colors">
                  <ZoomOut className="w-4 h-4" />
                </button>
                <span className="text-[10px] font-mono text-white/40 w-10 text-center">{Math.round(zoom * 100)}%</span>
                <button onClick={() => zoomBy(1.3)} title="Zoom in" className="p-1.5 rounded text-white/50 hover:text-white transition-colors">
                  <ZoomIn className="w-4 h-4" />
                </button>
                <button onClick={resetView} title="Reset view" className="p-1.5 rounded text-white/50 hover:text-white transition-colors">
                  <Maximize className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Canvas */}
          <div
            ref={canvasRef}
            className={`flex-grow border border-white/10 rounded-2xl relative overflow-hidden select-none ${bgClass} ${zoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''}`}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerUp}
          >
            {canvasBg === 'checker' && (
              <div className="absolute inset-0 opacity-[0.06] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CjxyZWN0IHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2Y4ZmFmYyIvPgo8cmVjdCB4PSIxMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZjFmMjY2Ii8+CjxyZWN0IHk9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmMWYyZjYiLz4KPHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmOGZhZmMiLz4KPC9zdmc+')] [background-size:20px_20px]" />
            )}

            {!preview && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/20 text-center">
                <Layout className="w-12 h-12 mb-4 opacity-50" />
                <p className="font-medium text-sm uppercase tracking-widest">Waiting for input</p>
              </div>
            )}

            {preview && (
              <>
                {/* Original layer */}
                {(viewMode !== 'vector' || !svgResult) && (
                  <div className="absolute inset-0 flex items-center justify-center p-6">
                    <div
                      className="relative max-w-full max-h-full w-full h-full"
                      style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center' }}
                    >
                      <div
                        className="absolute inset-0 m-auto"
                        style={aspect ? { aspectRatio: String(aspect), maxWidth: '100%', maxHeight: '100%' } : undefined}
                      >
                        <img
                          src={preview}
                          alt="Original"
                          draggable={false}
                          onLoad={(e) => {
                            const img = e.currentTarget;
                            if (img.naturalWidth && img.naturalHeight) {
                              setImageAspect(img.naturalWidth / img.naturalHeight);
                            }
                          }}
                          className="absolute inset-0 w-full h-full object-contain"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Vector layer — clipped at canvas level so it tracks the divider exactly */}
                {svgResult && viewMode !== 'original' && (
                  <div
                    className="absolute inset-0"
                    style={showSplit ? { clipPath: `inset(0 0 0 ${divider}%)` } : undefined}
                  >
                    <div className="absolute inset-0 flex items-center justify-center p-6">
                      <div
                        className="relative max-w-full max-h-full w-full h-full"
                        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center' }}
                      >
                        <div
                          className="absolute inset-0 m-auto [&>svg]:w-full [&>svg]:h-full"
                          style={aspect ? { aspectRatio: String(aspect), maxWidth: '100%', maxHeight: '100%' } : undefined}
                          dangerouslySetInnerHTML={{ __html: displaySvg ?? '' }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Split divider */}
                {showSplit && (
                  <>
                    <div className="absolute top-0 bottom-0 w-px bg-[#C1FF00] pointer-events-none z-10" style={{ left: `${divider}%` }} />
                    <div
                      onPointerDown={handleDividerPointerDown}
                      className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-8 h-8 rounded-full bg-[#C1FF00] text-black flex items-center justify-center cursor-ew-resize shadow-lg z-20 touch-none"
                      style={{ left: `${divider}%` }}
                    >
                      <Columns2 className="w-4 h-4" />
                    </div>
                    <span className="absolute top-3 left-3 text-[9px] font-bold uppercase tracking-widest bg-black/70 text-white/70 px-2 py-1 rounded pointer-events-none">
                      Original
                    </span>
                    <span className="absolute top-3 right-3 text-[9px] font-bold uppercase tracking-widest bg-black/70 text-[#C1FF00] px-2 py-1 rounded pointer-events-none">
                      Vector
                    </span>
                  </>
                )}
              </>
            )}

            {/* Tracing overlay */}
            <AnimatePresence>
              {isTracing && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="absolute inset-0 bg-black/60 backdrop-blur-[2px] flex flex-col items-center justify-center z-30"
                >
                  <Loader2 className="w-10 h-10 mb-4 animate-spin text-[#C1FF00] opacity-80" />
                  <p className="font-bold text-sm uppercase tracking-widest text-[#C1FF00] animate-pulse">
                    Tracing vector paths...
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer: stats + actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 min-h-[44px]">
            <div className="text-[10px] font-mono text-white/40 uppercase tracking-wider">
              {stats && (
                <>
                  {stats.paths} paths · {stats.colors} colors · {formatKb(stats.bytes)} · {stats.durationMs}ms
                </>
              )}
            </div>
            {svgResult && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCopy}
                  disabled={colorsPending}
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-40"
                >
                  {copied ? <Check className="w-4 h-4 text-[#C1FF00]" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied' : 'Copy SVG'}
                </button>
                <div className="flex items-center rounded-lg bg-white/10 overflow-hidden">
                  <select
                    value={pngWidth}
                    onChange={(e) => setPngWidth(Number(e.target.value))}
                    title="PNG width in pixels"
                    className="bg-transparent text-white text-[10px] font-bold pl-3 pr-1 py-2.5 outline-none cursor-pointer"
                  >
                    {PNG_WIDTHS.map((w) => (
                      <option key={w} value={w} className="bg-[#111] text-white">
                        {w}px
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleDownloadPng}
                    disabled={exporting === 'png' || colorsPending}
                    title="Download a transparent PNG at the chosen width"
                    className="flex items-center gap-2 hover:bg-white/10 text-white px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
                  >
                    {exporting === 'png' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />} PNG
                  </button>
                </div>
                <button
                  onClick={handleDownloadDxf}
                  disabled={colorsPending}
                  title="Download DXF for cutters, lasers and CAD (one layer per color; Cut-outs work best)"
                  className="flex items-center gap-2 bg-white/10 hover:bg-white/20 text-white px-4 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-40"
                >
                  <Scissors className="w-4 h-4" /> DXF
                </button>
                <button
                  onClick={handleDownload}
                  disabled={colorsPending}
                  title={colorsPending ? 'Apply the color changes first' : undefined}
                  className="flex items-center gap-2 bg-[#C1FF00] hover:bg-[#a6db00] disabled:opacity-40 text-black px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors"
                >
                  <Download className="w-4 h-4" /> Download SVG
                </button>
              </div>
            )}
          </div>

          {/* Colors: reduce / merge the palette, preview instantly, then apply */}
          {svgResult && basePalette && basePalette.length > 1 && settings.mode !== 'bw' && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest flex items-center gap-2">
                  <Palette className="w-3.5 h-3.5" /> Colors · {chosenColors.length} of {basePalette.length}
                </p>
                {(fixedPalette || keep) && (
                  <button
                    onClick={resetColors}
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/40 hover:text-white transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset
                  </button>
                )}
              </div>
              <input
                type="range"
                min={1}
                max={basePalette.length}
                value={chosenColors.length}
                onChange={(e) => setColorCount(Number(e.target.value))}
                className="w-full accent-[#C1FF00]"
                aria-label="Number of colors"
              />
              <div className="flex flex-wrap gap-2 mt-3">
                {basePalette.map((entry) => {
                  const color = entry.color.toUpperCase();
                  const kept = chosenColors.includes(color);
                  const target = swatchTargets.get(color);
                  const pct = entry.area * 100;
                  return (
                    <button
                      key={color}
                      onClick={() => toggleColor(color)}
                      title={
                        kept
                          ? `${color} · ${pct.toFixed(1)}% — tap to merge into its nearest color`
                          : `${color} → ${target} · tap to keep it`
                      }
                      className={`flex items-center gap-1.5 rounded-lg border px-1.5 py-1 transition-colors ${kept ? 'border-white/15 bg-white/5' : 'border-dashed border-white/15 opacity-60'}`}
                    >
                      <span className="w-6 h-6 rounded border border-white/20" style={{ background: color }} />
                      {!kept && target && (
                        <>
                          <span className="text-[10px] text-white/40">→</span>
                          <span className="w-4 h-4 rounded border border-white/20" style={{ background: target }} />
                        </>
                      )}
                      <span className="text-[9px] font-mono text-white/40 pr-0.5">{pct < 0.1 ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)}%</span>
                    </button>
                  );
                })}
              </div>
              {colorsPending ? (
                <button
                  onClick={applyColors}
                  disabled={isTracing}
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-[#C1FF00] hover:bg-[#a6db00] disabled:opacity-50 text-black py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors"
                >
                  {isTracing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Apply {chosenColors.length} {chosenColors.length === 1 ? 'color' : 'colors'}
                </button>
              ) : null}
              <p className="text-[9px] text-white/25 mt-2">
                {colorsPending
                  ? 'Previewing merged colors. Apply re-traces with exactly these colors — downloads unlock after.'
                  : 'Slide to merge similar shades, or tap a swatch to merge it into its nearest color.'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
