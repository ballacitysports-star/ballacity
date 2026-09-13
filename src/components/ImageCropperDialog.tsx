import { useEffect, useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Maximize2, SlidersHorizontal } from "lucide-react";
import { loadNormalizedDataUrl } from "@/lib/image-orientation";
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

type Props = {
  open: boolean;
  file: File | null;
  aspect: number; // width / height, e.g. 1 for avatar, 16/9 for cover
  outputMaxSize: number; // default longest edge of output
  shape?: "square" | "rect" | "circle";
  title?: string;
  sizePresets?: CropSizePreset[];
  qualityPresets?: CropQualityPreset[];
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
  sizePresets = DEFAULT_SIZE_PRESETS,
  qualityPresets = DEFAULT_QUALITY_PRESETS,
  onCancel,
  onConfirm,
}: Props) {
  const isMobile = useIsMobile();
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  const [minScale, setMinScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showOptions, setShowOptions] = useState(false);
  const [touched, setTouched] = useState(false);

  // Pick the preset closest to the parent-provided default as the initial choice
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
  const [qualityIdx, setQualityIdx] = useState(1); // default High
  const outMax = sizePresets[sizeIdx]?.maxSize ?? outputMaxSize;
  const outQuality = qualityPresets[qualityIdx]?.quality ?? 0.9;

  useEffect(() => {
    if (!open || !file) {
      setImgSrc(null);
      setImg(null);
      return;
    }
    setTouched(false);
    setShowOptions(false);
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
    window.addEventListener("orientationchange", measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
    };
  }, [open]);

  // Crop box dimensions (fit inside container while preserving aspect)
  const gutter = isMobile ? 16 : 24;
  const cropW =
    containerSize.w > 0
      ? Math.min(containerSize.w - gutter, (containerSize.h - gutter) * aspect)
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
    // Zoom around image center for the slider
    const ratio = v / scale;
    setScale(v);
    setOffset(clampOffset(offset.x * ratio, offset.y * ratio, v));
  };

  const confirm = () => {
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
    const sW = cropW / scale;
    const sH = cropH / scale;
    const sx = img.width / 2 - sW / 2 - offset.x / scale;
    const sy = img.height / 2 - sH / 2 - offset.y / scale;
    ctx.drawImage(img, sx, sy, sW, sH, 0, 0, outW, outH);
    const dataUrl = canvas.toDataURL("image/jpeg", outQuality);
    onConfirm(dataUrl);
  };

  const fitToFrame = useCallback(() => {
    setScale(minScale);
    setOffset({ x: 0, y: 0 });
  }, [minScale]);

  if (!open) return null;

  const imgW = img ? img.width * scale : 0;
  const imgH = img ? img.height * scale : 0;

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
        style={{ touchAction: "none" }}
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
                width: imgW,
                height: imgH,
                maxWidth: "none",
                maxHeight: "none",
                objectFit: "fill",
                transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                pointerEvents: "none",
                userSelect: "none",
                willChange: "transform",
              }}
            />
            <CropOverlay width={cropW} height={cropH} shape={shape} showGrid={interacting} />
            <CropHint visible={!!img && !touched} />
          </>
        )}

        <CropOptionsSheet open={showOptions} onClose={() => setShowOptions(false)}>
          {options}
        </CropOptionsSheet>
      </div>

      <CropBottomBar>
        {!isMobile && (
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
        )}

        <div className="flex items-center justify-center gap-2">
          <CropAction
            onClick={fitToFrame}
            disabled={!img}
            icon={<Maximize2 className="h-4 w-4" />}
            label="Fit"
          />
          <CropAction
            onClick={fitToFrame}
            disabled={!img}
            icon={<RotateCcw className="h-4 w-4" />}
            label="Reset"
          />
          {isMobile && (
            <CropAction
              onClick={() => setShowOptions(true)}
              icon={<SlidersHorizontal className="h-4 w-4" />}
              label="Options"
            />
          )}
        </div>

        {!isMobile && options}

        <CropConfirmBar onCancel={onCancel} onApply={confirm} applyDisabled={!img} />
      </CropBottomBar>
    </div>
  );
}
