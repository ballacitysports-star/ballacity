import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";

type Props = {
  open: boolean;
  file: File | null;
  /** Crop aspect ratio (width / height). 1 = square, 16/9 = wide, etc. */
  aspect?: number;
  /** Longest output edge in px. */
  maxSize?: number;
  /** Output as PNG (transparent) or JPEG. Defaults to JPEG. */
  outputType?: "image/jpeg" | "image/png";
  /** Circular preview mask (visual only; output is still rectangular). */
  circle?: boolean;
  title?: string;
  onCancel: () => void;
  onCropped: (result: { dataUrl: string; blob: Blob }) => void;
};

/**
 * Lightweight pan + zoom image cropper. Drag to reposition, use the slider
 * (or mouse wheel) to zoom. Outputs a downscaled JPEG/PNG matching the
 * requested aspect ratio.
 */
export function ImageCropperDialog({
  open,
  file,
  aspect = 1,
  maxSize = 1024,
  outputType = "image/jpeg",
  circle = false,
  title = "Crop image",
  onCancel,
  onCropped,
}: Props) {
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [minZoom, setMinZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [busy, setBusy] = useState(false);
  const frameRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });

  // Load the selected file into an HTMLImageElement.
  useEffect(() => {
    if (!file || !open) {
      setImgUrl(null);
      setImg(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setImgUrl(url);
    const el = new Image();
    el.onload = () => setImg(el);
    el.onerror = () => setImg(null);
    el.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, open]);

  // Measure the crop frame after mount.
  useEffect(() => {
    if (!open) return;
    const measure = () => {
      const node = frameRef.current;
      if (!node) return;
      setFrameSize({ w: node.clientWidth, h: node.clientHeight });
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (frameRef.current) ro.observe(frameRef.current);
    return () => ro.disconnect();
  }, [open]);

  // Compute the smallest zoom that fully covers the frame.
  useEffect(() => {
    if (!img || !frameSize.w || !frameSize.h) return;
    const cover = Math.max(frameSize.w / img.width, frameSize.h / img.height);
    setMinZoom(cover);
    setZoom(cover);
    setOffset({ x: 0, y: 0 });
  }, [img, frameSize.w, frameSize.h]);

  const clampOffset = useCallback(
    (x: number, y: number, z: number) => {
      if (!img) return { x: 0, y: 0 };
      const dispW = img.width * z;
      const dispH = img.height * z;
      const maxX = Math.max(0, (dispW - frameSize.w) / 2);
      const maxY = Math.max(0, (dispH - frameSize.h) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, x)),
        y: Math.max(-maxY, Math.min(maxY, y)),
      };
    },
    [img, frameSize.w, frameSize.h],
  );

  useEffect(() => {
    setOffset((o) => clampOffset(o.x, o.y, zoom));
  }, [zoom, clampOffset]);

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setOffset(clampOffset(dragRef.current.ox + dx, dragRef.current.oy + dy, zoom));
  };
  const onPointerUp = () => {
    dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const next = Math.max(minZoom, Math.min(minZoom * 5, zoom * (e.deltaY > 0 ? 0.95 : 1.05)));
    setZoom(next);
  };

  const handleCrop = async () => {
    if (!img || !frameSize.w || !frameSize.h) return;
    setBusy(true);
    try {
      // Source rect (in original image px) currently visible in the frame.
      const srcW = frameSize.w / zoom;
      const srcH = frameSize.h / zoom;
      const cx = img.width / 2 - offset.x / zoom;
      const cy = img.height / 2 - offset.y / zoom;
      const sx = cx - srcW / 2;
      const sy = cy - srcH / 2;

      // Output size: cap the longer edge at maxSize while preserving aspect.
      const outW = aspect >= 1 ? maxSize : Math.round(maxSize * aspect);
      const outH = aspect >= 1 ? Math.round(maxSize / aspect) : maxSize;

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("canvas unsupported");
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, sx, sy, srcW, srcH, 0, 0, outW, outH);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          outputType,
          outputType === "image/jpeg" ? 0.9 : undefined,
        ),
      );
      const dataUrl = canvas.toDataURL(outputType, 0.9);
      onCropped({ dataUrl, blob });
    } finally {
      setBusy(false);
    }
  };

  // Frame CSS: fixed max width, height derived from aspect.
  const frameStyle = {
    aspectRatio: String(aspect),
    maxHeight: "60vh",
  } as React.CSSProperties;

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div
            ref={frameRef}
            className="relative mx-auto w-full overflow-hidden rounded-2xl border border-border bg-black touch-none select-none"
            style={frameStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
          >
            {imgUrl && img && (
              <img
                src={imgUrl}
                alt=""
                draggable={false}
                className="pointer-events-none absolute left-1/2 top-1/2 max-w-none"
                style={{
                  width: img.width * zoom,
                  height: img.height * zoom,
                  transform: `translate(calc(-50% + ${offset.x}px), calc(-50% + ${offset.y}px))`,
                }}
              />
            )}
            {circle && (
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]"
              />
            )}
          </div>

          <div className="flex items-center gap-3 px-1">
            <span className="text-xs font-semibold text-muted-foreground">Zoom</span>
            <Slider
              value={[zoom]}
              min={minZoom}
              max={minZoom * 5}
              step={(minZoom * 4) / 100 || 0.01}
              onValueChange={(v) => setZoom(v[0] ?? zoom)}
              className="flex-1"
            />
          </div>
          <p className="px-1 text-[11px] text-muted-foreground">
            Drag to reposition · scroll or use the slider to zoom
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" onClick={handleCrop} disabled={busy || !img}>
            {busy ? "Cropping…" : "Save crop"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
