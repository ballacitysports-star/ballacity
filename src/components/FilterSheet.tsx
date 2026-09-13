import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

/**
 * Unified bottom-sheet primitive used by the shared FilterBar across
 * Players, Teams, Trainers, and Feed. Rendered via a portal so it can
 * escape parent overflow contexts and always sits above the tab chrome.
 */
export function FilterSheet({
  open,
  onClose,
  title = "Filters",
  onReset,
  resetDisabled,
  footer,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: string;
  onReset?: () => void;
  resetDisabled?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-background/70 backdrop-blur-sm"
            aria-hidden
          />
          <motion.div
            key="sheet"
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 320, damping: 34 }}
            className="fixed inset-x-0 bottom-0 z-50 max-h-[85dvh] rounded-t-3xl border-t border-border bg-surface shadow-2xl flex flex-col"
          >
            <div className="flex items-center justify-between border-b border-border px-5 py-3">
              <div className="h-1 w-10 rounded-full bg-border mx-auto absolute left-0 right-0 top-1.5" />
              <h2 className="font-display text-lg font-bold">{title}</h2>
              <button
                onClick={onClose}
                className="grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground hover:text-foreground"
                aria-label="Close filters"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">{children}</div>
            <div className="border-t border-border px-5 py-3 flex items-center gap-2">
              {onReset && (
                <button
                  onClick={onReset}
                  disabled={resetDisabled}
                  className="rounded-full border border-border bg-background px-4 py-2 text-sm font-semibold text-foreground disabled:opacity-40"
                >
                  Reset
                </button>
              )}
              <div className="flex-1">{footer}</div>
              <button
                onClick={onClose}
                className="rounded-full bg-lime-gradient px-5 py-2 text-sm font-bold text-primary-foreground"
              >
                Show results
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

export function FilterSection({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between">
        <h3 className="section-eyebrow text-muted-foreground">{label}</h3>
        {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

export function ChipRow<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors ${
              active
                ? "border-lime bg-lime text-primary-foreground"
                : "border-border bg-background text-muted-foreground"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
