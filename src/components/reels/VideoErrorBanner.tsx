import type { ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";

export type VideoErrorInfo = {
  message: string;
  /**
   * True when the ffmpeg.wasm converter itself is unreachable (an outage), as
   * opposed to a clip this specific device/browser could not encode. The two
   * look identical to an athlete but need opposite advice: one is on our
   * side and retrying now won't help, the other is genuinely about this clip.
   */
  outage: boolean;
};

/**
 * Persistent, actionable banner for video-conversion failures — a toast
 * fades in a few seconds, which is long enough to notice something went
 * wrong but not long enough to read what to do about it.
 */
export function VideoErrorBanner({
  error,
  onDismiss,
  actions,
  className = "",
}: {
  error: VideoErrorInfo | null;
  onDismiss?: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  if (!error) return null;
  return (
    <div
      role="alert"
      className={`flex items-start gap-2.5 rounded-xl border border-amber-400/40 bg-amber-50/10 px-4 py-3 text-amber-300 ${className}`}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{error.message}</p>
        <p className="mt-1 text-xs text-amber-300/80">
          {error.outage
            ? "This is on our side, not your device — trying again right now won't help. Only new uploads that need conversion are affected; everything else still works."
            : "Converting works best in desktop Chrome. You can also re-upload the clip from your Photos app, which saves it in a format every device plays."}
        </p>
        {actions && <div className="mt-2.5 flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss"
          className="shrink-0 text-amber-300/70 hover:text-amber-300"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
