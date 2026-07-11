import { useEffect, useRef, useState, useCallback } from "react";
import { X, Check, ZoomIn, ZoomOut, RotateCcw, Maximize2 } from "lucide-react";

type Props = {
  open: boolean;
  file: File | null;
  aspect: number; // width / height, e.g. 1 for avatar, 16/9 for cover
  outputMaxSize: number; // longest edge of output
  shape?: "square" | "rect" | "circle";
  title?: string;
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
};

export function ImageCropperDialog({
  open,
  file,
  aspect,
  outputMaxSize,
  shape = "rect",
  title = "Crop image",
  onCancel,
  onConfirm,
}: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Multi-pointer tracking for pinch + pan
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    mode: "none" | "pan" | "pinch";
    startOffset: { x: number; y: number };
    startScale: number;
    startCenter: { x: number; y: number };
    startDist: number;
  }>({
    mode: "none",
    startOffset: { x: 0, y: 0 },
    startScale: 1,
    startCenter: { x: 0, y: 0 },
    startDist: 0,
  });

  useEffect(() => {
    if (!open || !file) {
      setImgSrc(null);
      setImg(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setImgSrc(reader.result as string);
    reader.readAsDataURL(file);
  }, [open, file]);

  useEffect(() => {
    if (!imgSrc) return;
    const el = new Image();
    el.onload = () => setImg(el);
    el.src = imgSrc;
  }, [imgSrc]);

  // Compute container / crop-box size
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setContainerSize({ w: rect.width, h: rect.height });
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  // Crop box dimensions (fit inside container while preserving aspect)
  const cropW = containerSize.w > 0
    ? Math.min(containerSize.w - 24, (containerSize.h - 24) * aspect)
    : 0;
  const cropH = cropW / aspect;

  const maxScale = minScale * 8;

  // Reset scale/offset when image or crop box changes
  useEffect(() => {
    if (!img || cropW === 0) return;
    const min = Math.max(cropW / img.width, cropH / img.height);
    setMinScale(min);
    setScale(min);
    setOffset({ x: 0, y: 0 });
  }, [img, cropW, cropH]);

  const clampOffset = useCallback(
    (ox: number, oy: number, s: number) => {
      if (!img) return { x: 0, y: 0 };
      const iw = img.width * s;
      const ih = img.height * s;
      const maxX = Math.max(0, (iw - cropW) / 2);
      const maxY = Math.max(0, (ih - cropH) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, ox)),
        y: Math.max(-maxY, Math.min(maxY, oy)),
      };
    },
    [img, cropW, cropH],
  );

  // Prevent native page pinch-zoom / scroll while cropper is open
  useEffect(() => {
    if (!open) return;
    const el = containerRef.current;
    if (!el) return;
    const prevent = (e: TouchEvent) => {
      if (e.touches.length >= 1) e.preventDefault();
    };
    el.addEventListener("touchstart", prevent, { passive: false });
    el.addEventListener("touchmove", prevent, { passive: false });
    return () => {
      el.removeEventListener("touchstart", prevent);
      el.removeEventListener("touchmove", prevent);
    };
  }, [open]);

  const getPointersArray = () => Array.from(pointersRef.current.values());

  const startGesture = useCallback(() => {
    const pts = getPointersArray();
    if (pts.length === 1) {
      gestureRef.current = {
        mode: "pan",
        startOffset: { x: offset.x, y: offset.y },
        startScale: scale,
        startCenter: { x: pts[0].x, y: pts[0].y },
        startDist: 0,
      };
    } else if (pts.length >= 2) {
      const [a, b] = pts;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      gestureRef.current = {
        mode: "pinch",
        startOffset: { x: offset.x, y: offset.y },
        startScale: scale,
        startCenter: { x: cx, y: cy },
        startDist: dist || 1,
      };
    } else {
      gestureRef.current.mode = "none";
    }
  }, [offset.x, offset.y, scale]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gestureRef.current;
    const pts = getPointersArray();

    if (g.mode === "pan" && pts.length === 1) {
      const dx = pts[0].x - g.startCenter.x;
      const dy = pts[0].y - g.startCenter.y;
      setOffset(clampOffset(g.startOffset.x + dx, g.startOffset.y + dy, scale));
    } else if (g.mode === "pinch" && pts.length >= 2) {
      const [a, b] = pts;
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ratio = dist / g.startDist;
      const nextScale = Math.max(minScale, Math.min(maxScale, g.startScale * ratio));

      // Zoom around the pinch center: keep the image point under the gesture center stable,
      // and follow the two-finger center as it moves (allows repositioning while zooming).
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      if (rect) {
        const containerCx = rect.left + rect.width / 2;
        const containerCy = rect.top + rect.height / 2;
        // Image-space point under the initial pinch center at start of gesture
        const focalX = (g.startCenter.x - containerCx - g.startOffset.x) / g.startScale;
        const focalY = (g.startCenter.y - containerCy - g.startOffset.y) / g.startScale;
        // New offset so that focal point sits under the current pinch center
        const nx = cx - containerCx - focalX * nextScale;
        const ny = cy - containerCy - focalY * nextScale;
        setScale(nextScale);
        setOffset(clampOffset(nx, ny, nextScale));
      } else {
        setScale(nextScale);
      }
    }
  };

  const endPointer = (e: React.PointerEvent) => {
    (e.target as Element).releasePointerCapture?.(e.pointerId);
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size === 0) {
      gestureRef.current.mode = "none";
    } else {
      // Re-anchor remaining pointers so transitioning pinch→pan is smooth
      startGesture();
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    const rect = el?.getBoundingClientRect();
    const delta = -e.deltaY * 0.0015;
    const next = Math.max(minScale, Math.min(maxScale, scale * (1 + delta)));
    if (rect) {
      const containerCx = rect.left + rect.width / 2;
      const containerCy = rect.top + rect.height / 2;
      const focalX = (e.clientX - containerCx - offset.x) / scale;
      const focalY = (e.clientY - containerCy - offset.y) / scale;
      const nx = e.clientX - containerCx - focalX * next;
      const ny = e.clientY - containerCy - focalY * next;
      setScale(next);
      setOffset(clampOffset(nx, ny, next));
    } else {
      setScale(next);
      setOffset(clampOffset(offset.x, offset.y, next));
    }
  };

  const onScale = (v: number) => {
    // Zoom around image center for the slider
    const ratio = v / scale;
    const nx = offset.x * ratio;
    const ny = offset.y * ratio;
    setScale(v);
    setOffset(clampOffset(nx, ny, v));
  };

  const confirm = () => {
    if (!img) return;
    const outW = aspect >= 1 ? outputMaxSize : Math.round(outputMaxSize * aspect);
    const outH = aspect >= 1 ? Math.round(outputMaxSize / aspect) : outputMaxSize;
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const sW = cropW / scale;
    const sH = cropH / scale;
    const sx = img.width / 2 - sW / 2 - offset.x / scale;
    const sy = img.height / 2 - sH / 2 - offset.y / scale;
    ctx.drawImage(img, sx, sy, sW, sH, 0, 0, outW, outH);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    onConfirm(dataUrl);
  };

  const fitToFrame = useCallback(() => {
    setScale(minScale);
    setOffset({ x: 0, y: 0 });
  }, [minScale]);

  const resetView = fitToFrame;

  if (!open) return null;

  const imgW = img ? img.width * scale : 0;
  const imgH = img ? img.height * scale : 0;

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-black/95 backdrop-blur">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <button
          type="button"
          onClick={onCancel}
          className="grid h-10 w-10 place-items-center rounded-full bg-white/10"
          aria-label="Cancel"
        >
          <X className="h-4 w-4" />
        </button>
        <h2 className="font-display text-sm font-bold">{title}</h2>
        <button
          type="button"
          onClick={confirm}
          disabled={!img}
          className="inline-flex items-center gap-1 rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
        >
          <Check className="h-3.5 w-3.5" /> Done
        </button>
      </div>

      <div
        ref={containerRef}
        className="relative flex-1 overflow-hidden touch-none select-none overscroll-none"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        onWheel={onWheel}
      >
        {img && cropW > 0 && (
          <>
            <img
              src={imgSrc!}
              alt=""
              draggable={false}
              style={{
                position: "absolute",
                left: "50%",
                top: "50%",
                width: imgW,
                height: imgH,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                pointerEvents: "none",
                userSelect: "none",
                willChange: "transform",
              }}
            />
            <div className="pointer-events-none absolute inset-0">
              <div
                className="absolute left-1/2 top-1/2"
                style={{
                  width: cropW,
                  height: cropH,
                  transform: "translate(-50%, -50%)",
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
                  borderRadius: shape === "circle" ? "9999px" : "12px",
                  border: "2px solid rgba(255,255,255,0.9)",
                }}
              />
            </div>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 px-6 py-4 text-white">
        <div className="flex items-center gap-3">
          <ZoomOut className="h-4 w-4 opacity-70" />
          <input
            type="range"
            min={minScale}
            max={maxScale}
            step={(maxScale - minScale) / 200 || 0.01}
            value={scale}
            onChange={(e) => onScale(parseFloat(e.target.value))}
            className="flex-1 accent-lime"
            aria-label="Zoom"
          />
          <ZoomIn className="h-4 w-4 opacity-70" />
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={fitToFrame}
            disabled={!img}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50"
            aria-label="Fit to frame"
          >
            <Maximize2 className="h-3.5 w-3.5" /> Fit
          </button>
          <button
            type="button"
            onClick={resetView}
            disabled={!img}
            className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/20 disabled:opacity-50"
            aria-label="Reset crop"
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reset
          </button>
        </div>
      </div>
    </div>
  );
}
