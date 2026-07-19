import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  X,
  Check,
  ZoomIn,
  ZoomOut,
  RotateCw,
  RotateCcw,
  FlipHorizontal,
  FlipVertical,
  Maximize2,
  Crop as CropIcon,
  Wand2,
  Sliders,
  Sparkles,
  Loader2,
  Scissors,
} from "lucide-react";
import { toast } from "sonner";
import { loadNormalizedDataUrl } from "@/lib/image-orientation";
import {
  FILTER_PRESETS,
  DEFAULT_ADJUST,
  buildFilterString,
  type FilterPreset,
  type Adjust,
} from "@/lib/image-filters";
import { removeBackground } from "@/lib/bg-remove.functions";

export type CropSizePreset = { label: string; maxSize: number };
export type CropQualityPreset = { label: string; quality: number };

const DEFAULT_SIZE_PRESETS: CropSizePreset[] = [
  { label: "S", maxSize: 512 },
  { label: "M", maxSize: 1024 },
  { label: "L", maxSize: 1600 },
];
const DEFAULT_QUALITY_PRESETS: CropQualityPreset[] = [
  { label: "Standard", quality: 0.8 },
  { label: "High", quality: 0.9 },
  { label: "Max", quality: 0.95 },
];

type Tab = "crop" | "transform" | "adjust" | "filter" | "bg";

type Props = {
  open: boolean;
  file: File | null;
  aspect: number;
  outputMaxSize: number;
  shape?: "square" | "rect" | "circle";
  title?: string;
  allowBgRemoval?: boolean;
  sizePresets?: CropSizePreset[];
  qualityPresets?: CropQualityPreset[];
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
};

export function ImageEditorDialog({
  open,
  file,
  aspect,
  outputMaxSize,
  shape = "rect",
  title = "Edit image",
  allowBgRemoval = false,
  sizePresets = DEFAULT_SIZE_PRESETS,
  qualityPresets = DEFAULT_QUALITY_PRESETS,
  onCancel,
  onConfirm,
}: Props) {
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [hasAlpha, setHasAlpha] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // New transform / adjust / filter state
  const [rotation90, setRotation90] = useState(0); // multiples of 90, in degrees
  const [straighten, setStraighten] = useState(0); // -45..45
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [adjust, setAdjust] = useState<Adjust>(DEFAULT_ADJUST);
  const [filterId, setFilterId] = useState<string>("original");
  const [bgRemoving, setBgRemoving] = useState(false);

  const [tab, setTab] = useState<Tab>("crop");

  const initialSizeIndex = (() => {
    let best = 0;
    let bestDiff = Infinity;
    sizePresets.forEach((p, i) => {
      const d = Math.abs(p.maxSize - outputMaxSize);
      if (d < bestDiff) { bestDiff = d; best = i; }
    });
    return best;
  })();
  const [sizeIdx, setSizeIdx] = useState(initialSizeIndex);
  const [qualityIdx, setQualityIdx] = useState(1);
  const outMax = sizePresets[sizeIdx]?.maxSize ?? outputMaxSize;
  const outQuality = qualityPresets[qualityIdx]?.quality ?? 0.9;

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

  // Reset all state whenever the file changes
  useEffect(() => {
    if (!open || !file) {
      setImgSrc(null);
      setImg(null);
      return;
    }
    setRotation90(0);
    setStraighten(0);
    setFlipH(false);
    setFlipV(false);
    setAdjust(DEFAULT_ADJUST);
    setFilterId("original");
    setHasAlpha(false);
    setTab("crop");
    let cancelled = false;
    loadNormalizedDataUrl(file)
      .then((url) => { if (!cancelled) setImgSrc(url); })
      .catch(() => { if (!cancelled) setImgSrc(null); });
    return () => { cancelled = true; };
  }, [open, file]);

  useEffect(() => {
    if (!imgSrc) return;
    const el = new Image();
    el.style.imageOrientation = "from-image";
    el.onload = () => setImg(el);
    el.src = imgSrc;
  }, [imgSrc]);

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

  // Effective source dims after 90° rotation
  const rotatedDims = useMemo(() => {
    if (!img) return { w: 0, h: 0 };
    const swap = rotation90 % 180 !== 0;
    return { w: swap ? img.height : img.width, h: swap ? img.width : img.height };
  }, [img, rotation90]);

  const cropW = containerSize.w > 0
    ? Math.min(containerSize.w - 24, (containerSize.h - 24) * aspect)
    : 0;
  const cropH = cropW / aspect;

  const maxScale = minScale * 8;

  useEffect(() => {
    if (!img || cropW === 0) return;
    const min = Math.max(cropW / rotatedDims.w, cropH / rotatedDims.h);
    setMinScale(min);
    setScale(min);
    setOffset({ x: 0, y: 0 });
  }, [img, cropW, cropH, rotatedDims.w, rotatedDims.h]);

  const clampOffset = useCallback(
    (ox: number, oy: number, s: number) => {
      if (!img) return { x: 0, y: 0 };
      const iw = rotatedDims.w * s;
      const ih = rotatedDims.h * s;
      const maxX = Math.max(0, (iw - cropW) / 2);
      const maxY = Math.max(0, (ih - cropH) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, ox)),
        y: Math.max(-maxY, Math.min(maxY, oy)),
      };
    },
    [img, cropW, cropH, rotatedDims.w, rotatedDims.h],
  );

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
      const el = containerRef.current;
      const rect = el?.getBoundingClientRect();
      if (rect) {
        const containerCx = rect.left + rect.width / 2;
        const containerCy = rect.top + rect.height / 2;
        const focalX = (g.startCenter.x - containerCx - g.startOffset.x) / g.startScale;
        const focalY = (g.startCenter.y - containerCy - g.startOffset.y) / g.startScale;
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
    if (pointersRef.current.size === 0) gestureRef.current.mode = "none";
    else startGesture();
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.0015;
    const next = Math.max(minScale, Math.min(maxScale, scale * (1 + delta)));
    setScale(next);
    setOffset(clampOffset(offset.x, offset.y, next));
  };

  const onScale = (v: number) => {
    const ratio = v / scale;
    setScale(v);
    setOffset(clampOffset(offset.x * ratio, offset.y * ratio, v));
  };

  const filterPreset = FILTER_PRESETS.find((f) => f.id === filterId);
  const filterString = buildFilterString(filterPreset, adjust);

  async function handleBgRemove() {
    if (!img || !imgSrc || bgRemoving) return;
    setBgRemoving(true);
    try {
      // Send the currently normalized image
      const res = await removeBackground({ data: { dataUrl: imgSrc } });
      setImgSrc(res.dataUrl);
      setHasAlpha(true);
      toast.success("Background removed");
    } catch (e: any) {
      toast.error(e?.message ?? "Background removal failed");
    } finally {
      setBgRemoving(false);
    }
  }

  function confirm() {
    if (!img) return;
    const outW = aspect >= 1 ? outMax : Math.round(outMax * aspect);
    const outH = aspect >= 1 ? Math.round(outMax / aspect) : outMax;
    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";

    if (filterString) {
      try { (ctx as any).filter = filterString; } catch {}
    }

    // Source rect in the rotated coordinate space
    const sW = cropW / scale;
    const sH = cropH / scale;
    const sxRot = rotatedDims.w / 2 - sW / 2 - offset.x / scale;
    const syRot = rotatedDims.h / 2 - sH / 2 - offset.y / scale;

    // Compose transform: translate to output center → rotate (90 + straighten)
    // → flip → translate to source-crop centre. Then drawImage using source rect
    // mapped back into the original image coordinate space.
    ctx.save();
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate((straighten * Math.PI) / 180);
    ctx.scale(flipH ? -1 : 1, flipV ? -1 : 1);

    // Draw the rotated (by rotation90) image into the crop area
    const angle = (rotation90 * Math.PI) / 180;
    // We render into an intermediate to apply rotation90 easily
    const inter = document.createElement("canvas");
    inter.width = rotatedDims.w;
    inter.height = rotatedDims.h;
    const ictx = inter.getContext("2d");
    if (!ictx) { ctx.restore(); return; }
    ictx.save();
    ictx.translate(inter.width / 2, inter.height / 2);
    ictx.rotate(angle);
    ictx.drawImage(img, -img.width / 2, -img.height / 2);
    ictx.restore();

    const scaleX = outW / sW;
    const scaleY = outH / sH;
    ctx.drawImage(
      inter,
      sxRot, syRot, sW, sH,
      -outW / 2, -outH / 2, sW * scaleX, sH * scaleY,
    );
    ctx.restore();

    const outMime = hasAlpha ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(outMime, outQuality);
    onConfirm(dataUrl);
  }

  const fitToFrame = useCallback(() => {
    setScale(minScale);
    setOffset({ x: 0, y: 0 });
  }, [minScale]);

  if (!open) return null;

  const imgW = rotatedDims.w * scale;
  const imgH = rotatedDims.h * scale;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "crop", label: "Crop", icon: <CropIcon className="h-4 w-4" /> },
    { id: "transform", label: "Transform", icon: <RotateCw className="h-4 w-4" /> },
    { id: "adjust", label: "Adjust", icon: <Sliders className="h-4 w-4" /> },
    { id: "filter", label: "Filter", icon: <Wand2 className="h-4 w-4" /> },
    ...(allowBgRemoval
      ? [{ id: "bg" as Tab, label: "Background", icon: <Scissors className="h-4 w-4" /> }]
      : []),
  ];

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
        style={{
          touchAction: "none",
          backgroundImage:
            hasAlpha
              ? "linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%)"
              : undefined,
          backgroundSize: hasAlpha ? "20px 20px" : undefined,
          backgroundPosition: hasAlpha ? "0 0,0 10px,10px -10px,-10px 0px" : undefined,
        }}
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
                width: img.width * scale,
                height: img.height * scale,
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) rotate(${rotation90 + straighten}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`,
                pointerEvents: "none",
                userSelect: "none",
                willChange: "transform, filter",
                filter: filterString || undefined,
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
        {bgRemoving && (
          <div className="absolute inset-0 grid place-items-center bg-black/60">
            <div className="flex flex-col items-center gap-2 text-white">
              <Loader2 className="h-6 w-6 animate-spin text-lime" />
              <span className="text-xs font-bold">Removing background…</span>
            </div>
          </div>
        )}
        {imgW /* keep referenced for eslint */ === -1 && null}
        {imgH === -1 && null}
      </div>

      <div className="flex flex-col gap-3 px-4 py-3 text-white">
        {/* Tab content */}
        {tab === "crop" && (
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
            <button
              type="button"
              onClick={fitToFrame}
              disabled={!img}
              className="inline-flex items-center gap-1 rounded-full bg-white/10 px-3 py-1.5 text-[11px] font-semibold hover:bg-white/20 disabled:opacity-50"
            >
              <Maximize2 className="h-3.5 w-3.5" /> Fit
            </button>
          </div>
        )}

        {tab === "transform" && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2">
              <IconBtn onClick={() => setRotation90((r) => (r - 90 + 360) % 360)} label="Rotate left">
                <RotateCcw className="h-4 w-4" />
              </IconBtn>
              <IconBtn onClick={() => setRotation90((r) => (r + 90) % 360)} label="Rotate right">
                <RotateCw className="h-4 w-4" />
              </IconBtn>
              <IconBtn onClick={() => setFlipH((v) => !v)} label="Flip horizontal" active={flipH}>
                <FlipHorizontal className="h-4 w-4" />
              </IconBtn>
              <IconBtn onClick={() => setFlipV((v) => !v)} label="Flip vertical" active={flipV}>
                <FlipVertical className="h-4 w-4" />
              </IconBtn>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-16 text-[10px] uppercase tracking-wider opacity-60">Straighten</span>
              <input
                type="range"
                min={-45}
                max={45}
                step={0.5}
                value={straighten}
                onChange={(e) => setStraighten(parseFloat(e.target.value))}
                className="flex-1 accent-lime"
              />
              <span className="w-10 text-right text-[11px] tabular-nums">{straighten.toFixed(0)}°</span>
            </div>
          </div>
        )}

        {tab === "adjust" && (
          <div className="space-y-2">
            {(
              [
                ["brightness", "Brightness", 0.5, 1.5],
                ["contrast", "Contrast", 0.5, 1.5],
                ["saturation", "Saturation", 0, 2],
              ] as [keyof Adjust, string, number, number][]
            ).map(([key, label, min, max]) => (
              <div key={key} className="flex items-center gap-3">
                <span className="w-20 text-[10px] uppercase tracking-wider opacity-60">{label}</span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={0.01}
                  value={adjust[key]}
                  onChange={(e) =>
                    setAdjust((a) => ({ ...a, [key]: parseFloat(e.target.value) }))
                  }
                  className="flex-1 accent-lime"
                />
                <span className="w-10 text-right text-[11px] tabular-nums">
                  {adjust[key].toFixed(2)}
                </span>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setAdjust(DEFAULT_ADJUST)}
              className="mx-auto block rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold hover:bg-white/20"
            >
              Reset
            </button>
          </div>
        )}

        {tab === "filter" && (
          <div className="flex flex-wrap justify-center gap-2">
            {FILTER_PRESETS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterId(f.id)}
                className={`rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                  filterId === f.id
                    ? "bg-lime-gradient text-primary-foreground"
                    : "bg-white/10 text-white hover:bg-white/20"
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        )}

        {tab === "bg" && (
          <div className="flex flex-col items-center gap-2">
            <button
              type="button"
              onClick={handleBgRemove}
              disabled={bgRemoving || !img}
              className="inline-flex items-center gap-2 rounded-full bg-lime-gradient px-4 py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {hasAlpha ? "Remove background again" : "Remove background"}
            </button>
            <p className="text-[10px] text-white/60 text-center max-w-xs">
              Uses AI to cut out the subject. Output will export as PNG with transparency.
            </p>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex justify-center gap-1 rounded-full bg-white/5 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold transition ${
                tab === t.id ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Size + quality */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <span className="w-14 text-[10px] font-semibold uppercase tracking-wider opacity-60">Size</span>
            <div className="flex flex-1 gap-1 rounded-full bg-white/5 p-1">
              {sizePresets.map((p, i) => {
                const w = aspect >= 1 ? p.maxSize : Math.round(p.maxSize * aspect);
                const h = aspect >= 1 ? Math.round(p.maxSize / aspect) : p.maxSize;
                return (
                  <button
                    key={p.label}
                    type="button"
                    onClick={() => setSizeIdx(i)}
                    className={`flex-1 rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                      i === sizeIdx ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
                    }`}
                  >
                    {p.label} <span className="opacity-60">· {w}×{h}</span>
                  </button>
                );
              })}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 text-[10px] font-semibold uppercase tracking-wider opacity-60">Quality</span>
            <div className="flex flex-1 gap-1 rounded-full bg-white/5 p-1">
              {qualityPresets.map((q, i) => (
                <button
                  key={q.label}
                  type="button"
                  onClick={() => setQualityIdx(i)}
                  className={`flex-1 rounded-full px-2 py-1 text-[11px] font-semibold transition ${
                    i === qualityIdx ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`grid h-10 w-10 place-items-center rounded-full transition ${
        active ? "bg-lime-gradient text-primary-foreground" : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}
