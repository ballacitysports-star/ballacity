import { useEffect, useState } from "react";
import { Check, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import type { AutosaveState } from "@/hooks/use-autosave";

function relative(ts: number, now: number): string {
  const secs = Math.max(0, Math.round((now - ts) / 1000));
  if (secs < 10) return "just now";
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs}h ago`;
}

type Props = Pick<AutosaveState, "status" | "reason" | "error" | "savedAt" | "retry"> & {
  /** Label used for the success state — "Saved" (default) or "Draft saved". */
  savedLabel?: string;
  /** "text" (default) is subtle inline text; "pill" renders a high-contrast badge. */
  variant?: "text" | "pill";
  className?: string;
};

/** Subtle inline auto-save indicator. Renders nothing while idle. */
export function SaveStatus({
  status,
  reason,
  error,
  savedAt,
  retry,
  savedLabel = "Saved",
  variant = "text",
  className = "",
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (status !== "saved") return;
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, [status, savedAt]);

  const pill =
    variant === "pill" ? "rounded-full border px-2.5 py-1 font-semibold whitespace-nowrap" : "";
  const tone = (text: string, border: string, bg: string) =>
    variant === "pill" ? `${text} ${border} ${bg}` : text;
  const base = `inline-flex items-center gap-1.5 text-xs ${pill} ${className}`;

  if (status === "saving")
    return (
      <span
        className={`${base} ${tone("text-lime", "border-lime/40", "bg-lime/10")}`}
        role="status"
        aria-live="polite"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Saving…
      </span>
    );

  if (status === "dirty")
    return (
      <span
        className={`${base} ${tone("text-muted-foreground", "border-border", "bg-surface")}`}
        role="status"
        aria-live="polite"
      >
        Unsaved changes
      </span>
    );

  if (status === "invalid")
    return (
      <span
        className={`${base} ${tone("text-coral", "border-coral/40", "bg-coral/10")}`}
        role="status"
        aria-live="polite"
      >
        <TriangleAlert className="h-3.5 w-3.5" /> Not saved — {reason ?? "fix the errors above"}
      </span>
    );

  if (status === "error")
    return (
      <span
        className={`${base} ${tone("text-destructive", "border-destructive/40", "bg-destructive/10")}`}
        role="status"
        aria-live="polite"
      >
        <CloudOff className="h-3.5 w-3.5" />
        <span className="truncate max-w-[12rem]">{error ?? "Couldn't save"}</span>
        <button
          type="button"
          onClick={() => void retry()}
          className="font-bold underline underline-offset-2"
        >
          Retry
        </button>
      </span>
    );

  if (status === "saved" && savedAt != null)
    return (
      <span
        className={`${base} ${tone("text-lime", "border-lime/40", "bg-lime/10")}`}
        role="status"
        aria-live="polite"
      >
        <Check className="h-3.5 w-3.5" /> {savedLabel} {relative(savedAt, now)}
      </span>
    );

  return null;
}
