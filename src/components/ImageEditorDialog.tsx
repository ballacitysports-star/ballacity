import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
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
  SlidersHorizontal,
} from "lucide-react";
import { toast } from "sonner";
import { loadNormalizedDataUrl } from "@/lib/image-orientation";
import {
  FILTER_PRESETS,
  DEFAULT_ADJUST,
  buildFilterString,
  type Adjust,
} from "@/lib/image-filters";
import { removeBackground } from "@/lib/bg-remove.functions";
import { useIsMobile } from "@/hooks/use-mobile";
import { useCropGestures } from "@/hooks/use-crop-gestures";
import { CropOverlay } from "@/components/crop/CropOverlay";
import {
  CropAction,
  CropBottomBar,
  CropConfirmBar,
  CropHint,
  CropOptionsSheet,
  CropTopBar,
  CropUploadButton,
  OutputOptions,
  type CropQualityPreset,
  type CropSizePreset,
} from "@/components/crop/CropChrome";

export type { CropSizePreset, CropQualityPreset };

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
  /** Open with the whole image visible (logos) instead of filling the frame. */
  initialFit?: boolean;
  sizePresets?: CropSizePreset[];
  qualityPresets?: CropQualityPreset[];
  onCancel: () => void;
  onConfirm: (dataUrl: string) => void;
  /** When provided, shows an explicit "Upload" button to swap the source image. */
  onPickFile?: (file: File) => void;
};

export function ImageEditorDialog({
  open,
  file,
  aspect,
  outputMaxSize,
  shape = "rect",
  title = "Edit image",
  allowBgRemoval = false,
  initialFit = false,
  sizePresets = DEFAULT_SIZE_PRESETS,
  qualityPresets = DEFAULT_QUALITY_PRESETS,
  onCancel,
  onConfirm,
  onPickFile,
}: Props) {
  const isMobile = useIsMobile();
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [hasAlpha, setHasAlpha] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  // minScale: whole image visible (letterboxed). fillScale: image covers the frame.
  const [minScale, setMinScale] = useState(1);
  const [fillScale, setFillScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });

  // Transform / adjust / filter state
  const [rotation90, setRotation90] = useState(0); // multiples of 90, in degrees
  const [straighten, setStraighten] = useState(0); // -45..45
  const [flipH, setFlipH] = useState(false);
  const [flipV, setFlipV] = useState(false);
  const [adjust, setAdjust] = useState<Adjust>(DEFAULT_ADJUST);
  const [filterId, setFilterId] = useState<string>("original");
  const [bgRemoving, setBgRemoving] = useState(false);

  const [tab, setTab] = useState<Tab>("crop");
  const [showOptions, setShowOptions] = useState(false);
  const [touched, setTouched] = useState(false);

  const initialSizeIndex = (() => {
    let best = 0;
    let bestDiff = Infinity;
    sizePresets.forEach((p, i) => {
      const d = Math.abs(p.maxSize - outputMaxSize);
      if (d < bestDiff) {
        bestDiff = d;
        best = i;
      }
    });
    return best;
  })();
  const [sizeIdx, setSizeIdx] = useState(initialSizeIndex);
  const [qualityIdx, setQualityIdx] = useState(1);
  const outMax = sizePresets[sizeIdx]?.maxSize ?? outputMaxSize;
  const outQuality = qualityPresets[qualityIdx]?.quality ?? 0.9;

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
    setShowOptions(false);
    setTouched(false);
    let cancelled = false;
    loadNormalizedDataUrl(file)
      .then((url) => {
        if (!cancelled) setImgSrc(url);
      })
      .catch(() => {
        if (!cancelled) setImgSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, file]);

  useEffect(() => {
    if (!imgSrc) return;
    const el = new Image();
    el.style.imageOrientation = "from-image";
    el.onload = () => setImg(el);
    el.src = imgSrc;
  }, [imgSrc]);

  // Lock page scroll while the full-screen editor is open
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

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
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [open, tab]);

  // Effective source dims after 90° rotation
  const rotatedDims = useMemo(() => {
    if (!img) return { w: 0, h: 0 };
    const swap = rotation90 % 180 !== 0;
    return { w: swap ? img.height : img.width, h: swap ? img.width : img.height };
  }, [img, rotation90]);

  const gutter = isMobile ? 16 : 24;
  const cropW =
    containerSize.w > 0
      ? Math.min(containerSize.w - gutter, (containerSize.h - gutter) * aspect)
      : 0;
  const cropH = cropW / aspect;

  const maxScale = fillScale * 8;

  useEffect(() => {
    if (!img || cropW === 0) return;
    const fill = Math.max(cropW / rotatedDims.w, cropH / rotatedDims.h);
    setMinScale(Math.min(cropW / rotatedDims.w, cropH / rotatedDims.h));
    setFillScale(fill);
    setScale(initialFit ? Math.min(cropW / rotatedDims.w, cropH / rotatedDims.h) : fill);
    setOffset({ x: 0, y: 0 });
  }, [img, cropW, cropH, rotatedDims.w, rotatedDims.h, initialFit]);

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

  const { interacting, handlers } = useCropGestures({
    containerRef,
    scale,
    setScale,
    offset,
    setOffset,
    minScale,
    maxScale,
    clamp: clampOffset,
  });

  useEffect(() => {
    if (interacting) setTouched(true);
  }, [interacting]);

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
      try {
        (ctx as any).filter = filterString;
      } catch {}
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
    if (!ictx) {
      ctx.restore();
      return;
    }
    ictx.save();
    ictx.translate(inter.width / 2, inter.height / 2);
    ictx.rotate(angle);
    ictx.drawImage(img, -img.width / 2, -img.height / 2);
    ictx.restore();

    const scaleX = outW / sW;
    const scaleY = outH / sH;
    // Background for any letterboxed area (image zoomed out to fit) and for
    // transparent pixels, since the output is a JPEG: a solid colour sampled
    // from the image's corner, or black when that corner is transparent.
    // (A blurred copy here showed through transparent logos and looked smeared.)
    if (!hasAlpha) {
      let fill = "#000";
      try {
        const px = ictx.getImageData(0, 0, 1, 1).data;
        if (px[3] === 255) fill = `rgb(${px[0]},${px[1]},${px[2]})`;
      } catch {}
      const prevFilter = (ctx as any).filter;
      try {
        (ctx as any).filter = "none";
      } catch {}
      ctx.fillStyle = fill;
      ctx.fillRect(-outW, -outH, outW * 2, outH * 2);
      try {
        (ctx as any).filter = prevFilter;
      } catch {}
    }
    // Draw the whole image at its on-screen position so areas outside the
    // image (when fitted) are left to the background instead of clamping.
    ctx.drawImage(
      inter,
      -outW / 2 - sxRot * scaleX,
      -outH / 2 - syRot * scaleY,
      inter.width * scaleX,
      inter.height * scaleY,
    );
    ctx.restore();

    const outMime = hasAlpha ? "image/png" : "image/jpeg";
    const dataUrl = canvas.toDataURL(outMime, outQuality);
    onConfirm(dataUrl);
  }

  // "Fit" shows the whole photo; "Reset" fills the frame.
  const fitToFrame = useCallback(() => {
    setScale(minScale);
    setOffset({ x: 0, y: 0 });
  }, [minScale]);
  const fillFrame = useCallback(() => {
    setScale(fillScale);
    setOffset({ x: 0, y: 0 });
  }, [fillScale]);

  if (!open) return null;

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "crop", label: "Crop", icon: <CropIcon className="h-4 w-4" /> },
    { id: "transform", label: "Transform", icon: <RotateCw className="h-4 w-4" /> },
    { id: "adjust", label: "Adjust", icon: <Sliders className="h-4 w-4" /> },
    { id: "filter", label: "Filter", icon: <Wand2 className="h-4 w-4" /> },
    ...(allowBgRemoval
      ? [{ id: "bg" as Tab, label: "Background", icon: <Scissors className="h-4 w-4" /> }]
      : []),
  ];

  const options = (
    <OutputOptions
      aspect={aspect}
      sizePresets={sizePresets}
      sizeIdx={sizeIdx}
      onSizeIdx={setSizeIdx}
      qualityPresets={qualityPresets}
      qualityIdx={qualityIdx}
      onQualityIdx={setQualityIdx}
    />
  );

  return (
    <div className="fixed inset-0 z-[100] flex h-[100dvh] flex-col overscroll-none bg-black/95 backdrop-blur">
      <CropTopBar title={title} onCancel={onCancel} onDone={confirm} doneDisabled={!img} />

      <div
        ref={containerRef}
        className="relative min-h-0 flex-1 select-none touch-none overflow-hidden overscroll-none"
        style={{
          touchAction: "none",
          backgroundImage: hasAlpha
            ? "linear-gradient(45deg,#333 25%,transparent 25%),linear-gradient(-45deg,#333 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#333 75%),linear-gradient(-45deg,transparent 75%,#333 75%)"
            : undefined,
          backgroundSize: hasAlpha ? "20px 20px" : undefined,
          backgroundPosition: hasAlpha ? "0 0,0 10px,10px -10px,-10px 0px" : undefined,
        }}
        {...handlers}
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
                maxWidth: "none",
                maxHeight: "none",
                objectFit: "fill",
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px)) rotate(${rotation90 + straighten}deg) scale(${flipH ? -1 : 1}, ${flipV ? -1 : 1})`,
                pointerEvents: "none",
                userSelect: "none",
                willChange: "transform, filter",
                filter: filterString || undefined,
              }}
            />
            <CropOverlay width={cropW} height={cropH} shape={shape} showGrid={interacting} />
            <CropHint visible={!!img && !touched && tab === "crop"} />
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

        <CropOptionsSheet open={showOptions} onClose={() => setShowOptions(false)}>
          {options}
        </CropOptionsSheet>
      </div>

      <CropBottomBar>
        {/* Tab content */}
        {tab === "crop" && (
          <div className="flex items-center justify-center gap-2">
            {!isMobile && (
              <>
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
              </>
            )}
            {onPickFile && (
              <CropUploadButton
                onPickFile={onPickFile}
                label={isMobile ? "Upload" : "Upload new photo"}
              />
            )}
            <CropAction
              onClick={fitToFrame}
              disabled={!img}
              icon={<Maximize2 className="h-4 w-4" />}
              label="Fit"
            />
            <CropAction
              onClick={fillFrame}
              disabled={!img}
              icon={<CropIcon className="h-4 w-4" />}
              label="Fill"
            />

            {isMobile && (
              <>
                <CropAction
                  onClick={() => setRotation90((r) => (r + 90) % 360)}
                  disabled={!img}
                  icon={<RotateCw className="h-4 w-4" />}
                  label="Rotate"
                />
                <CropAction
                  onClick={() => setShowOptions(true)}
                  icon={<SlidersHorizontal className="h-4 w-4" />}
                  label="Options"
                />
              </>
            )}
          </div>
        )}

        {tab === "transform" && (
          <div className="space-y-3">
            <div className="flex items-center justify-center gap-2">
              <IconBtn
                onClick={() => setRotation90((r) => (r - 90 + 360) % 360)}
                label="Rotate left"
              >
                <RotateCcw className="h-5 w-5" />
              </IconBtn>
              <IconBtn onClick={() => setRotation90((r) => (r + 90) % 360)} label="Rotate right">
                <RotateCw className="h-5 w-5" />
              </IconBtn>
              <IconBtn onClick={() => setFlipH((v) => !v)} label="Flip horizontal" active={flipH}>
                <FlipHorizontal className="h-5 w-5" />
              </IconBtn>
              <IconBtn onClick={() => setFlipV((v) => !v)} label="Flip vertical" active={flipV}>
                <FlipVertical className="h-5 w-5" />
              </IconBtn>
            </div>
            <div className="flex items-center gap-3">
              <span className="w-16 shrink-0 micro-label opacity-60">
                Straighten
              </span>
              <input
                type="range"
                min={-45}
                max={45}
                step={0.5}
                value={straighten}
                onChange={(e) => setStraighten(parseFloat(e.target.value))}
                className="h-8 flex-1 accent-lime"
                aria-label="Straighten"
              />
              <span className="w-10 text-right text-[11px] tabular-nums">
                {straighten.toFixed(0)}°
              </span>
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
                <span className="w-20 shrink-0 micro-label opacity-60">
                  {label}
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={0.01}
                  value={adjust[key]}
                  aria-label={label}
                  onChange={(e) => setAdjust((a) => ({ ...a, [key]: parseFloat(e.target.value) }))}
                  className="h-8 flex-1 accent-lime"
                />
                <span className="w-10 text-right text-[11px] tabular-nums">
                  {adjust[key].toFixed(2)}
                </span>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setAdjust(DEFAULT_ADJUST)}
              className="mx-auto block h-9 rounded-full bg-white/10 px-4 text-[11px] font-semibold hover:bg-white/20"
            >
              Reset
            </button>
          </div>
        )}

        {tab === "filter" && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:flex-wrap sm:justify-center sm:overflow-visible">
            {FILTER_PRESETS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setFilterId(f.id)}
                className={`h-10 shrink-0 rounded-full px-4 text-[12px] font-semibold transition ${
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
              className="inline-flex h-11 items-center gap-2 rounded-full bg-lime-gradient px-5 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              <Sparkles className="h-4 w-4" />
              {hasAlpha ? "Remove background again" : "Remove background"}
            </button>
            <p className="max-w-xs text-center text-[10px] text-white/60">
              Uses AI to cut out the subject. Output will export as PNG with transparency.
            </p>
          </div>
        )}

        {/* Tab bar — scrollable, icon over label, thumb-sized targets */}
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden sm:mx-0 sm:justify-center sm:overflow-visible sm:rounded-full sm:bg-white/5 sm:p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              aria-pressed={tab === t.id}
              className={`inline-flex min-w-[68px] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl px-3 py-2 text-[11px] font-semibold transition sm:min-w-0 sm:flex-row sm:gap-1.5 sm:rounded-full sm:py-1.5 ${
                tab === t.id ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Size + quality stay inline on desktop; mobile gets them in the sheet */}
        {!isMobile && options}

        <CropConfirmBar
          onCancel={onCancel}
          onApply={confirm}
          applyDisabled={!img}
          busy={bgRemoving}
        />
      </CropBottomBar>
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
      className={`grid h-11 w-11 place-items-center rounded-full transition ${
        active
          ? "bg-lime-gradient text-primary-foreground"
          : "bg-white/10 text-white hover:bg-white/20"
      }`}
    >
      {children}
    </button>
  );
}
