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
  Crop,
  Eye,
  EyeOff,
  FileCode2,
  FileText,
  SplitSquareHorizontal,
  Grid,
  CircleDot,
  SlidersHorizontal,
  ClipboardPaste,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useLocation, useNavigate } from 'react-router-dom';
import { svgToDxf, svgToPng, svgToEps, svgToPdf, extractSvgNodes } from '../lib/exporters';
import { downloadBlob } from '../lib/download';
import { mapToNearest, recolorSvg, reducePalette, type PaletteEntry } from '../lib/palette';
import { SAMPLE_IMAGES } from '../lib/samples';
import CropModal from '../components/CropModal';

type TraceMode = 'color' | 'grayscale' | 'bw';
type CurveMode = 'spline' | 'polygon' | 'pixel';
type ShapeStacking = 'stacked' | 'cutout';
type DrawStyle = 'fill' | 'stroke';
type ViewMode = 'side-by-side' | 'split' | 'vector' | 'original';
type CanvasBg = 'checker' | 'light' | 'dark';
type PresetId = 'auto' | 'logo' | 'cut' | 'sketch';

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
  allowArcs: boolean;
  gapFiller: boolean;
  drawStyle: DrawStyle;
  strokeWidth: number;
}

interface TraceStats {
  paths: number;
  colors: number;
  bytes: number;
  width: number;
  height: number;
  durationMs: number;
}

const OUTPUT_DEFAULTS = {
  stacking: 'stacked' as ShapeStacking,
  groupByColor: true,
  snapAxes: true,
  allowArcs: true,
  gapFiller: true,
  drawStyle: 'fill' as DrawStyle,
  strokeWidth: 1.5,
};

const PRESETS: Record<PresetId, { label: string; hint: string; settings: TraceSettings }> = {
  auto: {
    label: 'Auto',
    hint: 'Balanced full-color vectorization',
    settings: {
      mode: 'color',
      autoColors: true,
      maxColors: 32,
      detail: 80,
      smoothness: 50,
      curveMode: 'spline',
      ...OUTPUT_DEFAULTS,
    },
  },
  logo: {
    label: 'Logo',
    hint: 'Crisp brand palette, sharp corners & axis snap',
    settings: {
      mode: 'color',
      autoColors: false,
      maxColors: 12,
      detail: 85,
      smoothness: 40,
      curveMode: 'spline',
      ...OUTPUT_DEFAULTS,
    },
  },
  cut: {
    label: 'Vinyl / Cut',
    hint: 'Non-overlapping cut-outs for plotters & screen print',
    settings: {
      mode: 'color',
      autoColors: false,
      maxColors: 8,
      detail: 75,
      smoothness: 55,
      curveMode: 'spline',
      ...OUTPUT_DEFAULTS,
      stacking: 'cutout',
      gapFiller: false,
    },
  },
  sketch: {
    label: 'Sketch / CAD',
    hint: 'Monochrome technical paths for laser & CNC',
    settings: {
      mode: 'bw',
      autoColors: true,
      maxColors: 32,
      detail: 78,
      smoothness: 50,
      curveMode: 'spline',
      ...OUTPUT_DEFAULTS,
      stacking: 'cutout',
    },
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
      const blob = isJpeg ? await canvasToBlob(canvas, 'image/jpeg', 0.92) : await canvasToBlob(canvas, 'image/png');
      if (blob.size <= MAX_UPLOAD_BYTES || scale < 0.2) return blob;
      scale *= 0.8;
    }
  } finally {
    bitmap.close();
  }
}

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
  const [imageDimensions, setImageDimensions] = useState<{ w: number; h: number } | null>(null);
  const [isTracing, setIsTracing] = useState(false);
  const [svgResult, setSvgResult] = useState<string | null>(null);
  const [showCropModal, setShowCropModal] = useState(false);

  // Palette state:
  // - basePalette: auto-detected palette on first trace
  // - resultPalette: palette returned by the latest trace
  // - keep: subset of colors currently kept (for reduction slider/merging)
  // - fixedPalette: locked palette sent to server on re-trace
  // - colorOverrides: instant client-side hex replacements (#OLD -> #NEW)
  // - transparentColors: colors knocked out (hidden/transparent background)
  const [basePalette, setBasePalette] = useState<PaletteEntry[] | null>(null);
  const [resultPalette, setResultPalette] = useState<PaletteEntry[] | null>(null);
  const [keep, setKeep] = useState<string[] | null>(null);
  const [fixedPalette, setFixedPalette] = useState<string[] | null>(null);
  const [colorOverrides, setColorOverrides] = useState<Record<string, string>>({});
  const [transparentColors, setTransparentColors] = useState<Set<string>>(new Set());

  const [stats, setStats] = useState<TraceStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const [preset, setPreset] = useState<PresetId | 'custom'>('auto');
  const [settings, setSettings] = useState<TraceSettings>(PRESETS.auto.settings);

  // Vectorizer.AI Inspector states
  const [viewMode, setViewMode] = useState<ViewMode>('side-by-side');
  const [wireframe, setWireframe] = useState(false);
  const [showNodes, setShowNodes] = useState(false);
  const [showPixelGrid, setShowPixelGrid] = useState(true);
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
  const autoTraceOnAcceptRef = useRef(false);
  const panState = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const navigate = useNavigate();

  const acceptFile = useCallback((selected: File, autoStart = true) => {
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
    setColorOverrides({});
    setTransparentColors(new Set());
    setStats(null);
    setError(null);
    setZoom(1);
    setPan({ x: 0, y: 0 });
    hasTracedRef.current = false;
    autoTraceOnAcceptRef.current = autoStart;
  }, []);

  // Global clipboard paste (Cmd+V / Ctrl+V) just like Vectorizer.AI
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const blob = item.getAsFile();
          if (blob) {
            e.preventDefault();
            acceptFile(blob, true);
            break;
          }
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [acceptFile]);

  // An image handed over from the Upscale page arrives in navigation state.
  const location = useLocation();
  useEffect(() => {
    const incoming = (location.state as { file?: File } | null)?.file;
    if (incoming instanceof File) {
      acceptFile(incoming, true);
      navigate(location.pathname, { replace: true, state: null });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (selected) acceptFile(selected, true);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped, true);
  };

  const loadSample = async (sample: (typeof SAMPLE_IMAGES)[number]) => {
    try {
      const sampleFile = await sample.render();
      if (sample.id === 'cad-sketch') {
        setPreset('sketch');
        setSettings((prev) => ({ ...PRESETS.sketch.settings, stacking: prev.stacking }));
      } else if (preset === 'sketch') {
        setPreset('auto');
        setSettings(PRESETS.auto.settings);
      }
      acceptFile(sampleFile, true);
    } catch (err: any) {
      setError(err?.message || 'Could not load sample image.');
    }
  };

  const runTrace = useCallback(async () => {
    if (!file) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setIsTracing(true);
    setError(null);

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
    formData.append('allowArcs', String(settings.allowArcs));
    formData.append('gapFiller', String(settings.gapFiller));
    formData.append('drawStyle', settings.drawStyle);
    formData.append('strokeWidth', String(settings.strokeWidth));
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

  // Auto-trace immediately when a file is dropped, pasted, cropped, or picked
  useEffect(() => {
    if (file && autoTraceOnAcceptRef.current) {
      autoTraceOnAcceptRef.current = false;
      runTrace();
    }
  }, [file, runTrace]);

  // Re-trace automatically when settings change after the first trace.
  useEffect(() => {
    if (!file || !hasTracedRef.current) return;
    const timer = setTimeout(runTrace, 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  // Re-trace when a reduced palette is applied (or reset).
  useEffect(() => {
    if (!file || !hasTracedRef.current) return;
    runTrace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedPalette]);

  // Zoom-to-cursor wheel listener so zooming centers on the cursor point like Vectorizer.AI.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      // Cursor offset relative to center of viewport
      const cx = e.clientX - (rect.left + rect.width / 2);
      const cy = e.clientY - (rect.top + rect.height / 2);
      const factor = e.deltaY < 0 ? 1.18 : 1 / 1.18;

      setZoom((prevZoom) => {
        const nextZoom = Math.min(16, Math.max(1, prevZoom * factor));
        if (nextZoom === 1) {
          setPan({ x: 0, y: 0 });
        } else {
          const ratio = nextZoom / prevZoom;
          setPan((prevPan) => ({
            x: cx - (cx - prevPan.x) * ratio,
            y: cy - (cy - prevPan.y) * ratio,
          }));
        }
        return nextZoom;
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [preview]);

  const applyPreset = (id: PresetId) => {
    setPreset(id);
    setSettings(PRESETS[id].settings);
  };

  const updateSettings = (patch: Partial<TraceSettings>) => {
    setPreset('custom');
    if ('mode' in patch || 'autoColors' in patch || 'maxColors' in patch) {
      setFixedPalette(null);
      setKeep(null);
    }
    setSettings((prev) => ({ ...prev, ...patch }));
  };

  const zoomBy = (factor: number) => {
    setZoom((z) => {
      const next = Math.min(16, Math.max(1, z * factor));
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

  // ---- Color reduction, custom recoloring & transparency knockout ----
  const appliedColors = useMemo(
    () => (fixedPalette ?? basePalette?.map((e) => e.color) ?? []).map((c) => c.toUpperCase()),
    [fixedPalette, basePalette],
  );
  const chosenColors = keep ?? appliedColors;
  const colorsPending =
    keep !== null &&
    (keep.length !== appliedColors.length || keep.some((c) => !appliedColors.includes(c)));
  const swatchTargets = useMemo(
    () =>
      basePalette && chosenColors.length
        ? mapToNearest(
            basePalette.map((e) => e.color),
            chosenColors,
          )
        : new Map<string, string>(),
    [basePalette, chosenColors],
  );

  // Final SVG with live color merging, custom color overrides, and transparent color knockouts applied
  const finalSvg = useMemo(() => {
    if (!svgResult) return null;
    const hasOverrides = Object.keys(colorOverrides).length > 0;
    const hasTransparency = transparentColors.size > 0;
    if (!colorsPending && !hasOverrides && !hasTransparency) return svgResult;

    const paletteList = resultPalette?.map((e) => e.color) ?? appliedColors;
    const mapping = colorsPending
      ? mapToNearest(paletteList, chosenColors)
      : new Map<string, string>(paletteList.map((c) => [c.toUpperCase(), c.toUpperCase()]));
    return recolorSvg(svgResult, mapping, colorOverrides, transparentColors);
  }, [svgResult, colorsPending, resultPalette, appliedColors, chosenColors, colorOverrides, transparentColors]);

  // Extract vector anchor nodes when Node Inspector is toggled on
  const svgNodes = useMemo(() => {
    if (!showNodes || !finalSvg) return [];
    return extractSvgNodes(finalSvg);
  }, [showNodes, finalSvg]);

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
  const toggleColorTransparency = (color: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const c = color.toUpperCase();
    setTransparentColors((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  };
  const changeColorOverride = (origColor: string, newColor: string) => {
    const c = origColor.toUpperCase();
    setColorOverrides((prev) => ({ ...prev, [c]: newColor.toUpperCase() }));
  };
  const applyColors = () => {
    if (!basePalette) return;
    const all =
      basePalette.length === chosenColors.length &&
      basePalette.every((e) => chosenColors.includes(e.color.toUpperCase()));
    const ordered = basePalette.map((e) => e.color.toUpperCase()).filter((c) => chosenColors.includes(c));
    setKeep(null);
    setFixedPalette(all ? null : ordered);
  };
  const resetColors = () => {
    setKeep(null);
    setFixedPalette(null);
    setColorOverrides({});
    setTransparentColors(new Set());
  };

  const baseName = () => file?.name.replace(/\.[^.]+$/, '') || 'tracemagic';

  const handleDownloadSvg = () => {
    if (!finalSvg) return;
    downloadBlob(new Blob([finalSvg], { type: 'image/svg+xml' }), `${baseName()}-vector.svg`);
  };

  const handleDownloadEps = () => {
    if (!finalSvg) return;
    try {
      const eps = svgToEps(finalSvg);
      downloadBlob(new Blob([eps], { type: 'application/postscript' }), `${baseName()}.eps`);
    } catch (err: any) {
      setError(err?.message || 'Could not create the EPS.');
    }
  };

  const handleDownloadPdf = () => {
    if (!finalSvg) return;
    try {
      const pdfBlob = svgToPdf(finalSvg);
      downloadBlob(pdfBlob, `${baseName()}.pdf`);
    } catch (err: any) {
      setError(err?.message || 'Could not create the PDF.');
    }
  };

  const handleDownloadPng = async () => {
    if (!finalSvg) return;
    setExporting('png');
    try {
      const blob = await svgToPng(finalSvg, pngWidth);
      downloadBlob(blob, `${baseName()}-${pngWidth}px.png`);
    } catch (err: any) {
      setError(err?.message || 'Could not create the PNG.');
    } finally {
      setExporting(null);
    }
  };

  const handleDownloadDxf = () => {
    if (!finalSvg) return;
    try {
      const { dxf } = svgToDxf(finalSvg);
      downloadBlob(new Blob([dxf], { type: 'application/dxf' }), `${baseName()}.dxf`);
    } catch (err: any) {
      setError(err?.message || 'Could not create the DXF.');
    }
  };

  const handleCopy = async () => {
    if (!finalSvg) return;
    try {
      await navigator.clipboard.writeText(finalSvg);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Could not copy to clipboard.');
    }
  };

  const aspect = stats ? stats.width / stats.height : imageAspect;
  const vbWidth = stats?.width ?? imageDimensions?.w ?? 1000;
  const vbHeight = stats?.height ?? imageDimensions?.h ?? 1000;
  const bgClass =
    canvasBg === 'light' ? 'bg-white' : canvasBg === 'dark' ? 'bg-[#09090b]' : 'bg-[#09090b]';
  const showSplit = viewMode === 'split' && !!finalSvg;
  const showSideBySide = viewMode === 'side-by-side' && !!finalSvg;

  const sliderClass =
    'w-full h-1.5 appearance-none rounded-full bg-white/10 accent-[#C1FF00] cursor-pointer';
  const segmentClass = (active: boolean) =>
    `flex-1 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors ${
      active ? 'bg-[#C1FF00] text-black' : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'
    }`;

  // Reusable Vector Viewport Layer (with optional Wireframe + Node overlay)
  const renderVectorViewport = () => (
    <div className="absolute inset-0 flex items-center justify-center p-6">
      <div
        className="relative max-w-full max-h-full w-full h-full"
        style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: 'center' }}
      >
        <div
          className={`absolute inset-0 m-auto [&>svg]:w-full [&>svg]:h-full ${
            wireframe
              ? '[&_path]:!fill-transparent [&_path]:!stroke-[#C1FF00] [&_path]:![stroke-width:1.2px] [&_path]:![vector-effect:non-scaling-stroke] [&_g]:!fill-transparent [&_g]:!stroke-[#C1FF00]'
              : ''
          }`}
          style={aspect ? { aspectRatio: String(aspect), maxWidth: '100%', maxHeight: '100%' } : undefined}
          dangerouslySetInnerHTML={{ __html: finalSvg ?? '' }}
        />
        {showNodes && svgNodes.length > 0 && (
          <svg
            viewBox={`0 0 ${vbWidth} ${vbHeight}`}
            className="absolute inset-0 m-auto w-full h-full pointer-events-none"
            style={aspect ? { aspectRatio: String(aspect), maxWidth: '100%', maxHeight: '100%' } : undefined}
          >
            {svgNodes.map(([nx, ny], idx) => (
              <circle
                key={idx}
                cx={nx}
                cy={ny}
                r={Math.max(1.2, 3.2 / Math.sqrt(zoom))}
                fill="#000"
                stroke="#C1FF00"
                strokeWidth={Math.max(0.6, 1.4 / Math.sqrt(zoom))}
              />
            ))}
          </svg>
        )}
      </div>
    </div>
  );

  // Reusable Original Raster Viewport Layer (with crispy pixelated zoom + optional Pixel Grid at ≥4x zoom)
  const renderOriginalViewport = () => (
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
            src={preview!}
            alt="Original"
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth && img.naturalHeight) {
                setImageAspect(img.naturalWidth / img.naturalHeight);
                setImageDimensions({ w: img.naturalWidth, h: img.naturalHeight });
              }
            }}
            style={{ imageRendering: zoom >= 3 ? 'pixelated' : 'auto' }}
            className="absolute inset-0 w-full h-full object-contain"
          />
          {showPixelGrid && zoom >= 4 && imageDimensions && (
            <div
              className="absolute inset-0 pointer-events-none opacity-35"
              style={{
                backgroundSize: `${100 / imageDimensions.w}% ${100 / imageDimensions.h}%`,
                backgroundImage:
                  'linear-gradient(to right, rgba(255,255,255,0.35) 1px, transparent 1px), linear-gradient(to bottom, rgba(255,255,255,0.35) 1px, transparent 1px)',
              }}
            />
          )}
        </div>
      </div>
    </div>
  );

  return (
    <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex-grow flex flex-col">
      {showCropModal && preview && file && (
        <CropModal
          imageUrl={preview}
          fileName={file.name}
          onCancel={() => setShowCropModal(false)}
          onApply={(croppedFile) => {
            setShowCropModal(false);
            acceptFile(croppedFile, true);
          }}
        />
      )}

      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[1px] bg-[#C1FF00]/10 text-[#C1FF00] px-3 py-1 rounded-full inline-flex items-center gap-1.5 mb-2">
            <Sparkles className="w-3 h-3" /> Sub-Pixel Vectorizer Workspace
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white uppercase tracking-tight">Vector Tracer</h1>
        </div>
        <p className="text-xs text-white/50 flex items-center gap-2">
          <ClipboardPaste className="w-3.5 h-3.5 text-[#C1FF00]" />
          Tip: Press <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/80 font-mono text-[10px]">⌘V</kbd> /{' '}
          <kbd className="px-1.5 py-0.5 bg-white/10 rounded text-white/80 font-mono text-[10px]">Ctrl+V</kbd> anywhere to paste an image
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-rose-500/10 text-rose-400 p-4 rounded-xl flex items-center gap-3 border border-rose-500/20">
          <AlertCircle className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-medium">{error}</p>
        </div>
      )}

      <div className="grid lg:grid-cols-[360px_1fr] gap-6 items-start flex-grow">
        {/* Controls column */}
        <div className="flex flex-col gap-5">
          {/* 1. Source */}
          <div className="bg-[#111] rounded-3xl border border-white/10 p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-bold text-white flex items-center gap-2.5 text-xs uppercase tracking-widest">
                <span className="bg-white/10 text-white w-5 h-5 rounded flex items-center justify-center text-[10px]">1</span>
                Source Bitmap
              </h2>
              {imageDimensions && (
                <span className="text-[10px] font-mono text-white/40">
                  {imageDimensions.w} × {imageDimensions.h}px
                </span>
              )}
            </div>

            {!preview ? (
              <>
                <label
                  className="border-2 border-dashed border-white/20 bg-black/40 rounded-2xl p-6 flex flex-col items-center justify-center text-center hover:bg-white/5 hover:border-[#C1FF00]/50 transition-colors cursor-pointer group"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={handleDrop}
                >
                  <div className="bg-white/5 w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-3 group-hover:scale-110 transition-transform">
                    <Upload className="w-6 h-6 text-[#C1FF00]" />
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1 uppercase tracking-wide">Drop or Paste Image</h3>
                  <p className="text-[10px] text-white/40 uppercase tracking-widest">PNG, JPG, WebP, GIF · Max 15MB</p>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/png, image/jpeg, image/jpg, image/webp, image/gif"
                    onChange={handleFileChange}
                  />
                </label>

                {/* Instant Sample Presets */}
                <div className="mt-4 pt-3 border-t border-white/10">
                  <p className="text-[9px] font-bold text-white/35 uppercase tracking-widest mb-2">
                    Or try a sample image:
                  </p>
                  <div className="grid grid-cols-3 gap-1.5">
                    {SAMPLE_IMAGES.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => loadSample(s)}
                        className="bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#C1FF00]/40 rounded-xl p-2 text-left transition-all"
                      >
                        <div className="text-[10px] font-bold text-white truncate">{s.label}</div>
                        <div className="text-[8px] text-white/40 truncate mt-0.5">{s.subtitle}</div>
                      </button>
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="relative rounded-2xl overflow-hidden border border-white/10 bg-black flex items-center justify-center max-h-40">
                <img src={preview} alt="Preview" className="max-w-full max-h-40 object-contain" />
                <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5">
                  <button
                    onClick={() => setShowCropModal(true)}
                    title="Crop region before tracing"
                    className="bg-black/80 backdrop-blur text-white px-2.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-[#C1FF00] hover:text-black transition-colors flex items-center gap-1"
                  >
                    <Crop className="w-3 h-3" /> Crop
                  </button>
                  <button
                    onClick={() => {
                      setFile(null);
                      setPreview(null);
                      setSvgResult(null);
                      setStats(null);
                      setImageAspect(null);
                      setImageDimensions(null);
                      hasTracedRef.current = false;
                    }}
                    className="bg-black/80 backdrop-blur text-white px-2.5 py-1.5 rounded text-[10px] font-bold uppercase tracking-widest hover:bg-[#C1FF00] hover:text-black transition-colors"
                  >
                    Change
                  </button>
                </div>
              </div>
            )}

            <button
              onClick={runTrace}
              disabled={!file || isTracing}
              className="w-full mt-4 bg-[#C1FF00] hover:bg-[#a6db00] disabled:bg-white/10 disabled:text-white/40 disabled:cursor-not-allowed text-black py-3 rounded-xl font-black uppercase tracking-[1.5px] text-xs transition-all flex items-center justify-center gap-2"
            >
              {isTracing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Tracing Geometry...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" /> Re-Trace Now
                </>
              )}
            </button>
          </div>

          {/* 2. Settings */}
          <div className="bg-[#111] rounded-3xl border border-white/10 p-5">
            <h2 className="font-bold text-white mb-3 flex items-center gap-2.5 text-xs uppercase tracking-widest">
              <span className="bg-white/10 text-white w-5 h-5 rounded flex items-center justify-center text-[10px]">2</span>
              Vectorization Settings
              {hasTracedRef.current && (
                <span className="ml-auto text-[9px] text-[#C1FF00]/70 normal-case tracking-normal font-medium">
                  live auto-update
                </span>
              )}
            </h2>

            {/* Presets */}
            <div className="grid grid-cols-4 gap-1.5 mb-2">
              {(Object.keys(PRESETS) as PresetId[]).map((id) => (
                <button
                  key={id}
                  onClick={() => applyPreset(id)}
                  title={PRESETS[id].hint}
                  className={segmentClass(preset === id)}
                >
                  {PRESETS[id].label}
                </button>
              ))}
            </div>
            {preset !== 'custom' && (
              <p className="text-[9px] text-white/30 mb-4">{PRESETS[preset].hint}</p>
            )}

            {/* Color Mode */}
            <div className="mb-4">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Color Mode</p>
              <div className="flex gap-2">
                {MODE_LABELS.map(({ id, label }) => (
                  <button key={id} onClick={() => updateSettings({ mode: id })} className={segmentClass(settings.mode === id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Max Colors */}
            <div className={`mb-4 ${settings.mode === 'bw' ? 'opacity-30 pointer-events-none' : ''}`}>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Max Colors</p>
                <button
                  onClick={() => updateSettings({ autoColors: !settings.autoColors })}
                  className={`text-[10px] font-bold uppercase tracking-widest px-2 py-0.5 rounded transition-colors ${
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
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Detail / Filter Speckle</p>
                <span className="text-[10px] text-white/40 font-mono">{settings.detail}%</span>
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
            <div className="mb-4">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Corner &amp; Curve Smoothing</p>
                <span className="text-[10px] text-white/40 font-mono">{settings.smoothness}%</span>
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

            {/* Curve Fitting */}
            <div className="mb-4">
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-2">Curve Geometry</p>
              <div className="flex gap-2">
                {CURVE_LABELS.map(({ id, label }) => (
                  <button key={id} onClick={() => updateSettings({ curveMode: id })} className={segmentClass(settings.curveMode === id)}>
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Vectorizer.AI Output Structure & Draw Style */}
            <div className="pt-4 border-t border-white/10">
              <div className="flex items-center gap-1.5 mb-3">
                <SlidersHorizontal className="w-3.5 h-3.5 text-[#C1FF00]" />
                <p className="text-[10px] font-bold text-white/70 uppercase tracking-widest">Output Geometry &amp; Layers</p>
              </div>

              {/* Shape Stacking */}
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">Shape Stacking</p>
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
              <p className="text-[9px] text-white/25 mb-3">
                {settings.stacking === 'stacked'
                  ? 'Shapes extend underneath upper layers to prevent anti-aliasing gaps.'
                  : 'Disjoint non-overlapping shapes — ideal for vinyl plotters & CAD.'}
              </p>

              {/* Draw Style */}
              <p className="text-[10px] font-bold text-white/40 uppercase tracking-widest mb-1.5">Draw Style</p>
              <div className="flex gap-2 mb-2">
                <button
                  onClick={() => updateSettings({ drawStyle: 'fill' })}
                  className={segmentClass(settings.drawStyle === 'fill')}
                >
                  Fill Shapes
                </button>
                <button
                  onClick={() => updateSettings({ drawStyle: 'stroke' })}
                  className={segmentClass(settings.drawStyle === 'stroke')}
                >
                  Stroke Outlines
                </button>
              </div>

              {settings.drawStyle === 'stroke' && (
                <div className="mb-3 bg-white/5 rounded-xl p-3">
                  <div className="flex justify-between text-[10px] text-white/50 mb-1">
                    <span>Stroke Width</span>
                    <span className="font-mono">{settings.strokeWidth}px</span>
                  </div>
                  <input
                    type="range"
                    min={0.5}
                    max={8}
                    step={0.25}
                    value={settings.strokeWidth}
                    onChange={(e) => updateSettings({ strokeWidth: Number(e.target.value) })}
                    className={sliderClass}
                  />
                </div>
              )}

              <ToggleRow
                label="Gap Filler"
                hint="Adds hairline matching stroke so adjacent cut-outs never show seam lines."
                on={settings.gapFiller}
                onToggle={() => updateSettings({ gapFiller: !settings.gapFiller })}
              />
              <ToggleRow
                label="Fit Circular & Elliptical Arcs"
                hint="Snap circles and ellipses to true mathematical SVG Arcs (A)."
                on={settings.allowArcs}
                onToggle={() => updateSettings({ allowArcs: !settings.allowArcs })}
              />
              <ToggleRow
                label="Snap Level & Plumb"
                hint="Straight edges within 2° of horizontal or vertical become exact."
                on={settings.snapAxes}
                onToggle={() => updateSettings({ snapAxes: !settings.snapAxes })}
              />
              <ToggleRow
                label="Group by Color"
                hint="Organize paths into named <g id='color-HEX'> groups."
                on={settings.groupByColor}
                onToggle={() => updateSettings({ groupByColor: !settings.groupByColor })}
              />
            </div>
          </div>
        </div>

        {/* Preview & Inspector Column */}
        <div className="bg-[#111] rounded-3xl border border-white/10 p-5 flex flex-col min-h-[620px] lg:sticky lg:top-6">
          {/* Top Inspector Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2">
              <span className="bg-white/10 text-white w-5 h-5 rounded flex items-center justify-center text-[10px] font-bold">
                3
              </span>
              <h2 className="font-bold text-white text-xs uppercase tracking-widest">Live Inspector</h2>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {/* View mode selector: Side-by-Side (Vectorizer.AI signature), Split Slider, Vector Only, Original Only */}
              <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                <button
                  onClick={() => setViewMode('side-by-side')}
                  disabled={!finalSvg}
                  title="Side-by-Side Synchronized View (Vectorizer.AI mode)"
                  className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 ${
                    viewMode === 'side-by-side' ? 'bg-[#C1FF00] text-black' : 'text-white/60 hover:text-white'
                  }`}
                >
                  <SplitSquareHorizontal className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Side-by-Side</span>
                </button>
                <button
                  onClick={() => setViewMode('split')}
                  disabled={!finalSvg}
                  title="Split Curtain Comparison"
                  className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 ${
                    viewMode === 'split' ? 'bg-[#C1FF00] text-black' : 'text-white/60 hover:text-white'
                  }`}
                >
                  <Columns2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Split</span>
                </button>
                <button
                  onClick={() => setViewMode('vector')}
                  disabled={!finalSvg}
                  title="Vector Result Only"
                  className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors disabled:opacity-30 ${
                    viewMode === 'vector' ? 'bg-[#C1FF00] text-black' : 'text-white/60 hover:text-white'
                  }`}
                >
                  <PenTool className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Vector</span>
                </button>
                <button
                  onClick={() => setViewMode('original')}
                  title="Original Bitmap Only"
                  className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors ${
                    viewMode === 'original' ? 'bg-[#C1FF00] text-black' : 'text-white/60 hover:text-white'
                  }`}
                >
                  <ImageIcon className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Original</span>
                </button>
              </div>

              {/* Vector Inspector Overlays: Wireframe, Anchor Nodes, Pixel Grid */}
              <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                <button
                  onClick={() => setWireframe((w) => !w)}
                  disabled={!finalSvg}
                  title="Toggle Vector Wireframe / Outline View"
                  className={`px-2 py-1.5 rounded text-[10px] font-bold uppercase tracking-wider transition-colors disabled:opacity-30 ${
                    wireframe ? 'bg-[#C1FF00] text-black' : 'text-white/60 hover:text-white'
                  }`}
                >
                  Outline
                </button>
                <button
                  onClick={() => setShowNodes((n) => !n)}
                  disabled={!finalSvg}
                  title="Show Vector Anchor Points / Nodes"
                  className={`p-1.5 rounded transition-colors disabled:opacity-30 ${
                    showNodes ? 'bg-[#C1FF00] text-black' : 'text-white/60 hover:text-white'
                  }`}
                >
                  <CircleDot className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setShowPixelGrid((g) => !g)}
                  title="Show Pixel Grid on Original Bitmap when zoomed in (≥400%)"
                  className={`p-1.5 rounded transition-colors ${
                    showPixelGrid ? 'bg-white/15 text-[#C1FF00]' : 'text-white/40 hover:text-white'
                  }`}
                >
                  <Grid className="w-4 h-4" />
                </button>
              </div>

              {/* Canvas Backdrop */}
              <div className="flex bg-white/5 rounded-lg p-1 gap-1">
                {(['checker', 'light', 'dark'] as CanvasBg[]).map((bg) => (
                  <button
                    key={bg}
                    onClick={() => setCanvasBg(bg)}
                    title={`${bg} background`}
                    className={`w-6 h-6 rounded border transition-all ${
                      canvasBg === bg ? 'border-[#C1FF00] scale-105' : 'border-white/10 hover:border-white/40'
                    } ${
                      bg === 'light'
                        ? 'bg-white'
                        : bg === 'dark'
                          ? 'bg-black'
                          : 'bg-[conic-gradient(#666_0_25%,#999_0_50%,#666_0_75%,#999_0)] bg-[length:8px_8px]'
                    }`}
                  />
                ))}
              </div>

              {/* Zoom Controls */}
              <div className="flex bg-white/5 rounded-lg p-1 gap-0.5 items-center">
                <button
                  onClick={() => zoomBy(1 / 1.3)}
                  title="Zoom out"
                  className="p-1.5 rounded text-white/50 hover:text-white transition-colors"
                >
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
                <span className="text-[10px] font-mono text-white/60 w-11 text-center">{Math.round(zoom * 100)}%</span>
                <button
                  onClick={() => zoomBy(1.3)}
                  title="Zoom in"
                  className="p-1.5 rounded text-white/50 hover:text-white transition-colors"
                >
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={resetView}
                  title="Fit to screen (100%)"
                  className="p-1.5 rounded text-white/50 hover:text-white transition-colors"
                >
                  <Maximize className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>

          {/* Interactive Viewport Canvas */}
          <div
            ref={canvasRef}
            className={`flex-grow min-h-[420px] border border-white/10 rounded-2xl relative overflow-hidden select-none ${bgClass} ${
              zoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerCancel={handleCanvasPointerUp}
          >
            {canvasBg === 'checker' && (
              <div className="absolute inset-0 opacity-[0.07] bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCI+CjxyZWN0IHdpZHRoPSIxMCIgaGVpZ2h0PSIxMCIgZmlsbD0iI2Y4ZmFmYyIvPgo8cmVjdCB4PSIxMCIgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiBmaWxsPSIjZjFmMjY2Ii8+CjxyZWN0IHk9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmMWYyZjYiLz4KPHJlY3QgeD0iMTAiIHk9IjEwIiB3aWR0aD0iMTAiIGhlaWdodD0iMTAiIGZpbGw9IiNmOGZhZmMiLz4KPC9zdmc+')] [background-size:20px_20px]" />
            )}

            {!preview && (
              <div className="absolute inset-0 flex flex-col items-center justify-center text-white/25 text-center p-6">
                <Layout className="w-12 h-12 mb-3 opacity-50" />
                <p className="font-bold text-sm uppercase tracking-widest text-white/40">Waiting for Bitmap Input</p>
                <p className="text-xs text-white/25 mt-1 max-w-sm">
                  Drop an image on the left, press Cmd/Ctrl+V to paste from clipboard, or click a sample below to inspect live vector geometry.
                </p>
              </div>
            )}

            {/* Mode 1: Vectorizer.AI Synchronized Side-by-Side Dual Viewport */}
            {preview && showSideBySide && (
              <div className="absolute inset-0 grid grid-cols-2 divide-x divide-white/15">
                <div className="relative overflow-hidden">
                  {renderOriginalViewport()}
                  <span className="absolute top-3 left-3 text-[9px] font-bold uppercase tracking-widest bg-black/75 text-white/80 px-2.5 py-1 rounded-md border border-white/10 pointer-events-none">
                    Original Input {zoom >= 4 && showPixelGrid ? '· Pixel Grid' : ''}
                  </span>
                </div>
                <div className="relative overflow-hidden">
                  {renderVectorViewport()}
                  <span className="absolute top-3 left-3 text-[9px] font-bold uppercase tracking-widest bg-black/75 text-[#C1FF00] px-2.5 py-1 rounded-md border border-[#C1FF00]/30 pointer-events-none">
                    Vector Result {wireframe ? '· Wireframe' : ''} {showNodes ? `· ${svgNodes.length} Nodes` : ''}
                  </span>
                </div>
              </div>
            )}

            {/* Mode 2: Split Curtain / Single Viewports */}
            {preview && !showSideBySide && (
              <>
                {(viewMode !== 'vector' || !finalSvg) && renderOriginalViewport()}

                {finalSvg && viewMode !== 'original' && (
                  <div
                    className="absolute inset-0"
                    style={showSplit ? { clipPath: `inset(0 0 0 ${divider}%)` } : undefined}
                  >
                    {renderVectorViewport()}
                  </div>
                )}

                {showSplit && (
                  <>
                    <div
                      className="absolute top-0 bottom-0 w-px bg-[#C1FF00] pointer-events-none z-10"
                      style={{ left: `${divider}%` }}
                    />
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
                  <Loader2 className="w-10 h-10 mb-3 animate-spin text-[#C1FF00] opacity-85" />
                  <p className="font-bold text-xs uppercase tracking-widest text-[#C1FF00] animate-pulse">
                    Fitting sub-pixel curves &amp; corners...
                  </p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Interactive Palette Studio: Reduce, Recolor, or Knock Out Background Colors */}
          {svgResult && basePalette && basePalette.length >= 1 && settings.mode !== 'bw' && (
            <div className="mt-4 pt-4 border-t border-white/10">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <p className="text-[10px] font-bold text-white/60 uppercase tracking-widest flex items-center gap-2">
                  <Palette className="w-3.5 h-3.5 text-[#C1FF00]" /> Palette Studio · {chosenColors.length} of{' '}
                  {basePalette.length} Colors Active
                  {transparentColors.size > 0 && (
                    <span className="text-[#C1FF00] bg-[#C1FF00]/10 px-2 py-0.5 rounded">
                      {transparentColors.size} transparent
                    </span>
                  )}
                </p>
                {(fixedPalette || keep || Object.keys(colorOverrides).length > 0 || transparentColors.size > 0) && (
                  <button
                    onClick={resetColors}
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white transition-colors"
                  >
                    <RotateCcw className="w-3 h-3" /> Reset Palette
                  </button>
                )}
              </div>

              {basePalette.length > 1 && (
                <input
                  type="range"
                  min={1}
                  max={basePalette.length}
                  value={chosenColors.length}
                  onChange={(e) => setColorCount(Number(e.target.value))}
                  className="w-full accent-[#C1FF00] h-1.5 bg-white/10 rounded-lg cursor-pointer"
                  aria-label="Number of colors"
                />
              )}

              <div className="flex flex-wrap gap-2 mt-3">
                {basePalette.map((entry) => {
                  const origColor = entry.color.toUpperCase();
                  const displayColor = colorOverrides[origColor] ?? origColor;
                  const kept = chosenColors.includes(origColor);
                  const isTransparent = transparentColors.has(origColor);
                  const target = swatchTargets.get(origColor);
                  const pct = entry.area * 100;

                  return (
                    <div
                      key={origColor}
                      className={`flex items-center gap-1.5 rounded-xl border px-2 py-1.5 transition-all ${
                        isTransparent
                          ? 'border-rose-500/40 bg-rose-500/10 opacity-75'
                          : kept
                            ? 'border-white/15 bg-white/5'
                            : 'border-dashed border-white/15 opacity-55'
                      }`}
                    >
                      {/* Color Picker Swatch */}
                      <label
                        title={`Click to recolor ${origColor}`}
                        className="relative w-6 h-6 rounded-md border border-white/25 cursor-pointer overflow-hidden flex-shrink-0"
                        style={{
                          background: isTransparent
                            ? 'repeating-conic-gradient(#555 0% 25%, #222 0% 50%) 50% / 8px 8px'
                            : displayColor,
                        }}
                      >
                        <input
                          type="color"
                          value={displayColor}
                          onChange={(e) => changeColorOverride(origColor, e.target.value)}
                          className="opacity-0 absolute inset-0 w-full h-full cursor-pointer"
                        />
                      </label>

                      {/* Merge toggle button */}
                      <button
                        onClick={() => toggleColor(origColor)}
                        title={
                          kept
                            ? `${origColor} (${pct.toFixed(1)}%) — click to merge into nearest neighbor`
                            : `${origColor} → ${target} — click to restore`
                        }
                        className="flex items-center gap-1 text-left"
                      >
                        {!kept && target && (
                          <>
                            <span className="text-[10px] text-white/40">→</span>
                            <span
                              className="w-3.5 h-3.5 rounded border border-white/20"
                              style={{ background: colorOverrides[target] ?? target }}
                            />
                          </>
                        )}
                        <span className="text-[10px] font-mono text-white/60">
                          {pct < 0.1 ? '<0.1' : pct.toFixed(pct < 10 ? 1 : 0)}%
                        </span>
                      </button>

                      {/* Transparency / Background Knockout button */}
                      <button
                        onClick={(e) => toggleColorTransparency(origColor, e)}
                        title={
                          isTransparent
                            ? 'Restore this color layer'
                            : 'Knock out / make this color transparent (remove background)'
                        }
                        className={`p-1 rounded hover:bg-white/10 transition-colors ${
                          isTransparent ? 'text-rose-400' : 'text-white/35 hover:text-white'
                        }`}
                      >
                        {isTransparent ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  );
                })}
              </div>

              {colorsPending ? (
                <button
                  onClick={applyColors}
                  disabled={isTracing}
                  className="mt-3 w-full flex items-center justify-center gap-2 bg-[#C1FF00] hover:bg-[#a6db00] disabled:opacity-50 text-black py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-colors"
                >
                  {isTracing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  Re-Trace with {chosenColors.length} {chosenColors.length === 1 ? 'Color' : 'Colors'}
                </button>
              ) : null}
              <p className="text-[9px] text-white/30 mt-2">
                Click any color square to change its hex color · Click the eye icon to knock out a background color · Click % to merge shades.
              </p>
            </div>
          )}

          {/* Bottom Export & Stats Bar (SVG, EPS, PDF, DXF, PNG) */}
          <div className="flex flex-wrap items-center justify-between gap-3 mt-4 pt-4 border-t border-white/10 min-h-[44px]">
            <div className="text-[10px] font-mono text-white/45 uppercase tracking-wider">
              {stats && (
                <>
                  {stats.paths} paths · {stats.colors - transparentColors.size} colors · {formatKb(stats.bytes)} ·{' '}
                  {stats.durationMs}ms
                </>
              )}
            </div>

            {finalSvg && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={handleCopy}
                  className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-3.5 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-[#C1FF00]" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy SVG'}
                </button>

                <button
                  onClick={handleDownloadPdf}
                  title="Download lossless Vector PDF (for print & Illustrator/Acrobat)"
                  className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-3.5 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                >
                  <FileText className="w-3.5 h-3.5" /> PDF
                </button>

                <button
                  onClick={handleDownloadEps}
                  title="Download Encapsulated PostScript (EPS) for Adobe Illustrator & print RIPs"
                  className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-3.5 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                >
                  <FileCode2 className="w-3.5 h-3.5" /> EPS
                </button>

                <button
                  onClick={handleDownloadDxf}
                  title="Download AutoCAD R12 DXF (one layer per color for laser/CNC/cutters)"
                  className="flex items-center gap-1.5 bg-white/10 hover:bg-white/20 text-white px-3.5 py-2.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-colors"
                >
                  <Scissors className="w-3.5 h-3.5" /> DXF
                </button>

                <div className="flex items-center rounded-lg bg-white/10 overflow-hidden">
                  <select
                    value={pngWidth}
                    onChange={(e) => setPngWidth(Number(e.target.value))}
                    title="PNG width in pixels"
                    className="bg-transparent text-white text-[10px] font-bold pl-2.5 pr-1 py-2.5 outline-none cursor-pointer"
                  >
                    {PNG_WIDTHS.map((w) => (
                      <option key={w} value={w} className="bg-[#111] text-white">
                        {w}px
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={handleDownloadPng}
                    disabled={exporting === 'png'}
                    title="Download high-res transparent PNG"
                    className="flex items-center gap-1.5 hover:bg-white/10 text-white px-3 py-2.5 text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
                  >
                    {exporting === 'png' ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <ImageIcon className="w-3.5 h-3.5" />
                    )}{' '}
                    PNG
                  </button>
                </div>

                <button
                  onClick={handleDownloadSvg}
                  className="flex items-center gap-2 bg-[#C1FF00] hover:bg-[#a6db00] text-black px-5 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-colors"
                >
                  <Download className="w-4 h-4" /> Download SVG
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
