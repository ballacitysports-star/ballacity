import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2, Share2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Annotation } from "@/lib/motion/annotations";
import { formatClock } from "@/lib/motion/frames";
import { renderKinogramBlob, saveOrShareBlob } from "./export";

/** Builds one sheet of evenly spaced stills from the clip (or its loop), with its drawings. */
export function KinogramDialog({
  open,
  onOpenChange,
  src,
  drawings,
  fps,
  range,
  duration,
  counts,
  timesFor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  src: string | undefined;
  drawings: Annotation[];
  fps: number;
  range: { start: number; end: number };
  duration: number;
  counts: readonly number[];
  timesFor: (count: number) => number[];
}) {
  const [count, setCount] = useState<number>(counts[1] ?? counts[0]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [blob, setBlob] = useState<Blob | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // A new look every time it opens; free the last image.
  useEffect(() => {
    if (open) return;
    setBlob(null);
    setPreview((p) => {
      if (p) URL.revokeObjectURL(p);
      return null;
    });
  }, [open]);

  const make = async () => {
    if (!src) return;
    setBusy(true);
    setProgress(0);
    try {
      const out = await renderKinogramBlob({
        src,
        times: timesFor(count),
        drawings,
        fps,
        onProgress: (done, total) => setProgress(done / total),
      });
      setBlob(out);
      setPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return URL.createObjectURL(out);
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't make the kinogram.");
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!blob) return;
    try {
      const how = await saveOrShareBlob(blob, `kinogram-${count}-frames.png`);
      if (how === "saved") toast.success("Saved to your downloads.");
    } catch {
      toast.error("Couldn't save the image.");
    }
  };

  const whole = range.start <= 0 && range.end >= duration - 1 / fps;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Make a kinogram</DialogTitle>
          <DialogDescription>
            One image of the movement from {formatClock(range.start)} to {formatClock(range.end)}
            {whole ? " (the whole clip; set a loop start and end to pick a part)" : " (your loop)"},
            with any drawings you made.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div
            className="flex flex-wrap items-center gap-1.5"
            role="group"
            aria-label="Number of stills"
          >
            {counts.map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={count === n}
                onClick={() => {
                  setCount(n);
                  setBlob(null);
                  setPreview((p) => {
                    if (p) URL.revokeObjectURL(p);
                    return null;
                  });
                }}
                className={`min-h-10 rounded-full border px-4 text-sm font-semibold ${count === n ? "border-lime bg-lime/15 text-lime" : "border-border"}`}
              >
                {n} stills
              </button>
            ))}
            <button
              type="button"
              onClick={make}
              disabled={busy || !src}
              className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-full bg-lime px-5 text-sm font-bold text-primary-foreground disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {busy
                ? `Working… ${Math.round(progress * 100)}%`
                : preview
                  ? "Make again"
                  : "Make kinogram"}
            </button>
          </div>
          {preview ? (
            <>
              <img
                src={preview}
                alt="Kinogram: evenly spaced stills of the movement"
                className="w-full rounded-xl border border-border"
              />
              <button
                type="button"
                onClick={save}
                className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-4 text-sm font-semibold"
              >
                <Share2 className="h-4 w-4" aria-hidden /> Save or share image
              </button>
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
