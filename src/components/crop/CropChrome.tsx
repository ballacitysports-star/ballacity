import * as React from "react";
import { Check, ImageUp, Loader2, X } from "lucide-react";

export type CropSizePreset = { label: string; maxSize: number };
export type CropQualityPreset = { label: string; quality: number };

/** Top bar: Cancel · title · Apply, with iOS safe-area padding and 44px targets. */
export function CropTopBar({
  title,
  onCancel,
  onDone,
  doneDisabled,
}: {
  title: string;
  onCancel: () => void;
  onDone: () => void;
  doneDisabled?: boolean;
}) {
  return (
    <div
      className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 text-white"
      style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
    >
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-11 min-w-11 items-center gap-1.5 rounded-full px-3 text-sm font-semibold text-white/90 hover:bg-white/10"
        aria-label="Cancel"
      >
        <X className="h-4 w-4" />
        <span className="hidden sm:inline">Cancel</span>
      </button>
      <h2 className="min-w-0 truncate font-display text-sm font-bold">{title}</h2>
      <button
        type="button"
        onClick={onDone}
        disabled={doneDisabled}
        className="inline-flex h-11 items-center gap-1.5 rounded-full bg-lime-gradient px-5 text-sm font-bold text-primary-foreground disabled:opacity-50"
      >
        <Check className="h-4 w-4" /> Apply
      </button>
    </div>
  );
}

/** "Drag to reposition" hint — fades out after the first touch. */
export function CropHint({ visible, text }: { visible: boolean; text?: string }) {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center transition-opacity duration-300"
      style={{ opacity: visible ? 1 : 0 }}
    >
      <span className="rounded-full bg-black/60 px-3 py-1.5 text-[11px] font-semibold text-white backdrop-blur">
        {text ?? "Drag to reposition · pinch to zoom"}
      </span>
    </div>
  );
}

/** Small dark segmented control used for size / quality pickers. */
export function Segmented({
  label,
  options,
  activeIndex,
  onSelect,
}: {
  label: string;
  options: { key: string; label: React.ReactNode }[];
  activeIndex: number;
  onSelect: (i: number) => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-wider opacity-60">
        {label}
      </span>
      <div className="flex min-w-0 flex-1 gap-1 rounded-full bg-white/5 p-1">
        {options.map((o, i) => (
          <button
            key={o.key}
            type="button"
            onClick={() => onSelect(i)}
            aria-pressed={i === activeIndex}
            className={`min-w-0 flex-1 truncate rounded-full px-2 py-2 text-[11px] font-semibold transition ${
              i === activeIndex ? "bg-white text-black" : "text-white/80 hover:bg-white/10"
            }`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function sizeOptionLabel(p: CropSizePreset, aspect: number) {
  const w = aspect >= 1 ? p.maxSize : Math.round(p.maxSize * aspect);
  const h = aspect >= 1 ? Math.round(p.maxSize / aspect) : p.maxSize;
  return (
    <>
      {p.label}{" "}
      <span className="opacity-60">
        · {w}×{h}
      </span>
    </>
  );
}

/** Size + quality pickers, rendered inline on desktop and inside the sheet on mobile. */
export function OutputOptions({
  aspect,
  sizePresets,
  sizeIdx,
  onSizeIdx,
  qualityPresets,
  qualityIdx,
  onQualityIdx,
}: {
  aspect: number;
  sizePresets: CropSizePreset[];
  sizeIdx: number;
  onSizeIdx: (i: number) => void;
  qualityPresets: CropQualityPreset[];
  qualityIdx: number;
  onQualityIdx: (i: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <Segmented
        label="Size"
        activeIndex={sizeIdx}
        onSelect={onSizeIdx}
        options={sizePresets.map((p) => ({ key: p.label, label: sizeOptionLabel(p, aspect) }))}
      />
      <Segmented
        label="Quality"
        activeIndex={qualityIdx}
        onSelect={onQualityIdx}
        options={qualityPresets.map((q) => ({ key: q.label, label: q.label }))}
      />
    </div>
  );
}

/**
 * Bottom sheet used on phones so output options don't crowd the crop surface.
 * Deliberately self-contained (no portal) so it layers inside the editor overlay.
 */
export function CropOptionsSheet({
  open,
  onClose,
  title = "Options",
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="absolute inset-0 z-10 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close options"
        onClick={onClose}
        className="absolute inset-0 bg-black/60"
      />
      <div
        className="relative rounded-t-3xl border-t border-white/10 bg-neutral-900 px-5 pt-3 text-white"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1.25rem)" }}
      >
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/25" />
        <div className="mb-3 flex items-center justify-between">
          <span className="text-sm font-bold">{title}</span>
          <button
            type="button"
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/** Bottom control bar wrapper with safe-area padding. */
export function CropBottomBar({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex shrink-0 flex-col gap-3 px-4 pt-3 text-white"
      style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 0.75rem)" }}
    >
      {children}
    </div>
  );
}

/** Round pill action used in the mobile control row. */
export function CropAction({
  onClick,
  disabled,
  icon,
  label,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex h-11 items-center gap-1.5 rounded-full bg-white/10 px-4 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
    >
      {icon} {label}
    </button>
  );
}

/**
 * Explicit "Upload" pill with its own hidden file input, so choosing a new
 * image on the crop screen is always a deliberate tap — the crop surface
 * itself never opens the OS picker.
 */
export function CropUploadButton({
  onPickFile,
  disabled,
  label = "Upload",
}: {
  onPickFile: (file: File) => void;
  disabled?: boolean;
  label?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          inputRef.current?.click();
        }}
        aria-label={label}
        className="inline-flex h-11 items-center gap-1.5 rounded-full border border-white/25 bg-white/10 px-4 text-xs font-semibold text-white transition hover:bg-white/20 disabled:opacity-50"
      >
        <ImageUp className="h-4 w-4" /> {label}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) onPickFile(f);
        }}
      />
    </>
  );
}

/**
 * Prominent Cancel / Apply pair pinned at the bottom of the crop screen so
 * finishing is unambiguous on mobile (full-width, 48px targets).
 */
export function CropConfirmBar({
  onCancel,
  onApply,
  applyDisabled,
  applyLabel = "Apply",
  cancelLabel = "Cancel",
  busy,
}: {
  onCancel: () => void;
  onApply: () => void;
  applyDisabled?: boolean;
  applyLabel?: string;
  cancelLabel?: string;
  busy?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl border border-white/25 bg-white/5 text-sm font-bold text-white transition hover:bg-white/15"
      >
        <X className="h-4 w-4" /> {cancelLabel}
      </button>
      <button
        type="button"
        onClick={onApply}
        disabled={applyDisabled || busy}
        className="inline-flex h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-2xl bg-lime-gradient text-sm font-bold text-primary-foreground transition disabled:opacity-50"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        {applyLabel}
      </button>
    </div>
  );
}
