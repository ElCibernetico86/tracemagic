import React, { useState, useRef, useEffect } from 'react';
import { Crop, Check, X, RotateCcw } from 'lucide-react';

interface CropModalProps {
  imageUrl: string;
  fileName: string;
  onCancel: () => void;
  onApply: (croppedFile: File) => void;
}

interface Box {
  x: number; // 0..1
  y: number; // 0..1
  w: number; // 0..1
  h: number; // 0..1
}

export default function CropModal({ imageUrl, fileName, onCancel, onApply }: CropModalProps) {
  const [box, setBox] = useState<Box>({ x: 0.08, y: 0.08, w: 0.84, h: 0.84 });
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<{
    mode: 'move' | 'nw' | 'ne' | 'sw' | 'se';
    startX: number;
    startY: number;
    startBox: Box;
  } | null>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const startDrag = (mode: 'move' | 'nw' | 'ne' | 'sw' | 'se') => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      mode,
      startX: e.clientX,
      startY: e.clientY,
      startBox: { ...box },
    };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const dx = (e.clientX - dragRef.current.startX) / rect.width;
    const dy = (e.clientY - dragRef.current.startY) / rect.height;
    const { mode, startBox: s } = dragRef.current;
    const MIN = 0.05;

    if (mode === 'move') {
      const nx = Math.max(0, Math.min(1 - s.w, s.x + dx));
      const ny = Math.max(0, Math.min(1 - s.h, s.y + dy));
      setBox({ x: nx, y: ny, w: s.w, h: s.h });
      return;
    }

    let x1 = s.x;
    let y1 = s.y;
    let x2 = s.x + s.w;
    let y2 = s.y + s.h;

    if (mode === 'nw' || mode === 'sw') x1 = Math.max(0, Math.min(x2 - MIN, x1 + dx));
    if (mode === 'ne' || mode === 'se') x2 = Math.min(1, Math.max(x1 + MIN, x2 + dx));
    if (mode === 'nw' || mode === 'ne') y1 = Math.max(0, Math.min(y2 - MIN, y1 + dy));
    if (mode === 'sw' || mode === 'se') y2 = Math.min(1, Math.max(y1 + MIN, y2 + dy));

    setBox({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 });
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  const confirmCrop = () => {
    const img = imgRef.current;
    if (!img || !naturalSize) return;
    const sx = Math.round(box.x * naturalSize.w);
    const sy = Math.round(box.y * naturalSize.h);
    const sw = Math.max(1, Math.round(box.w * naturalSize.w));
    const sh = Math.max(1, Math.round(box.h * naturalSize.h));

    const canvas = document.createElement('canvas');
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

    canvas.toBlob((blob) => {
      if (!blob) return;
      const base = fileName.replace(/\.[^.]+$/, '');
      onApply(new File([blob], `${base}-cropped.png`, { type: 'image/png' }));
    }, 'image/png');
  };

  const pixelW = naturalSize ? Math.round(box.w * naturalSize.w) : 0;
  const pixelH = naturalSize ? Math.round(box.h * naturalSize.h) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#111] border border-white/15 rounded-3xl max-w-3xl w-full p-6 shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="bg-[#C1FF00]/15 text-[#C1FF00] p-2 rounded-lg">
              <Crop className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-black uppercase tracking-widest text-white">Pre-Crop Bitmap</h3>
              <p className="text-[11px] text-white/40">
                Isolate the region you want to vectorize {naturalSize ? `· ${pixelW} × ${pixelH} px` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="p-2 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 bg-black rounded-2xl border border-white/10 flex items-center justify-center p-6 overflow-hidden select-none">
          <div
            ref={containerRef}
            className="relative inline-block max-w-full max-h-[58vh]"
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
          >
            <img
              ref={imgRef}
              src={imageUrl}
              alt="Crop source"
              draggable={false}
              onLoad={(e) => {
                const el = e.currentTarget;
                setNaturalSize({ w: el.naturalWidth, h: el.naturalHeight });
              }}
              className="block max-w-full max-h-[58vh] w-auto h-auto object-contain opacity-35"
            />

            {/* Highlighted crop window */}
            <div
              onPointerDown={startDrag('move')}
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              }}
              className="absolute border-2 border-[#C1FF00] shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] cursor-move overflow-hidden"
            >
              {/* Rule-of-thirds guide lines */}
              <div className="absolute inset-0 grid grid-cols-3 grid-rows-3 pointer-events-none">
                <div className="border-r border-b border-white/20" />
                <div className="border-r border-b border-white/20" />
                <div className="border-b border-white/20" />
                <div className="border-r border-b border-white/20" />
                <div className="border-r border-b border-white/20" />
                <div className="border-b border-white/20" />
                <div className="border-r border-white/20" />
                <div className="border-r border-white/20" />
                <div />
              </div>

              {/* Corner handles */}
              <div
                onPointerDown={startDrag('nw')}
                className="absolute -top-1.5 -left-1.5 w-4 h-4 bg-[#C1FF00] rounded-sm cursor-nwse-resize"
              />
              <div
                onPointerDown={startDrag('ne')}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-[#C1FF00] rounded-sm cursor-nesw-resize"
              />
              <div
                onPointerDown={startDrag('sw')}
                className="absolute -bottom-1.5 -left-1.5 w-4 h-4 bg-[#C1FF00] rounded-sm cursor-nesw-resize"
              />
              <div
                onPointerDown={startDrag('se')}
                className="absolute -bottom-1.5 -right-1.5 w-4 h-4 bg-[#C1FF00] rounded-sm cursor-nwse-resize"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 mt-5">
          <button
            onClick={() => setBox({ x: 0, y: 0, w: 1, h: 1 })}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-[10px] font-bold uppercase tracking-widest text-white/50 hover:text-white hover:bg-white/5 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Full Image
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 text-white text-[10px] font-bold uppercase tracking-widest transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={confirmCrop}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#C1FF00] hover:bg-[#a6db00] text-black text-[10px] font-black uppercase tracking-widest transition-colors"
            >
              <Check className="w-4 h-4" /> Apply Crop &amp; Trace
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
