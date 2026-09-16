import type { ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { ClipConversionFailedError, ConverterUnavailableError } from "@/lib/video-transcode";
import { UPLOAD_REJECTED } from "@/lib/video-validation";

/**
 * What went wrong, at the only granularity an athlete can act on.
 *
 * These look identical from the outside — the upload just stops — but the next
 * step is different for each, and naming the wrong one sends someone off to
 * re-encode a clip over an outage, or to retry forever over a file that will
 * never be accepted.
 */
export type VideoErrorKind =
  | "converter_outage"
  | "unsupported_format"
  | "too_large"
  | "network"
  | "unknown";

export type VideoErrorInfo = { kind: VideoErrorKind; message: string };

const ADVICE: Record<VideoErrorKind, string> = {
  converter_outage:
    "This is on our side, not your device — retrying right now won't help. Only uploads that need converting are affected; everything else still works.",
  unsupported_format:
    "Export the clip as an H.264 MP4 and upload that — re-saving it from your Photos app does this for you. Converting also works best in desktop Chrome.",
  // The limit itself comes from UPLOAD_REJECTED.tooLarge on the line above this
  // one, so it is deliberately not repeated here where it would go stale.
  too_large:
    "Trim the clip down to the moment you want, or export it at a lower resolution, then upload again.",
  network:
    "This clip didn't finish uploading. Once your connection is back, sending the same one again is all it takes.",
  unknown: "Try again, or pick a different clip if it keeps stopping here.",
};

/** True for the transient failures where re-sending the same file is the fix. */
export function isRetryableVideoError(kind: VideoErrorKind): boolean {
  return kind === "network" || kind === "converter_outage";
}

function isNetworkFailure(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  const message = e instanceof Error ? e.message : String(e ?? "");
  return /failed to fetch|network\s?error|load failed|connection|offline|timed? ?out/i.test(message);
}

/**
 * Maps whatever the upload threw onto the advice we can actually give for it.
 * Everything falls through to `unknown` rather than being swallowed, because a
 * failure nobody explains reads as the app freezing.
 */
export function classifyUploadError(e: unknown): VideoErrorInfo {
  if (e instanceof ConverterUnavailableError) {
    return {
      kind: "converter_outage",
      message: "Video conversion is temporarily unavailable. Nothing was uploaded.",
    };
  }
  if (e instanceof ClipConversionFailedError) {
    return { kind: "unsupported_format", message: "We couldn't make this clip play everywhere." };
  }

  // Only an Error's own message is fit to show; String()-ing anything else
  // puts "[object Object]" in front of an athlete.
  const message = (e instanceof Error ? e.message : "").trim();

  // `includes` rather than equality: both of these are raised by
  // finalizeVideoUpload on the server, where only the text survives the
  // server-function boundary — a wrapper around it would defeat an exact match.
  if (message.includes(UPLOAD_REJECTED.unplayable)) {
    return {
      kind: "unsupported_format",
      message: "This clip isn't in a format every device can play.",
    };
  }
  if (message.includes(UPLOAD_REJECTED.tooLarge)) {
    return { kind: "too_large", message: UPLOAD_REJECTED.tooLarge };
  }
  if (isNetworkFailure(e)) {
    return { kind: "network", message: "The upload lost its connection before it finished." };
  }
  return { kind: "unknown", message: message || "That upload didn't finish." };
}

/**
 * Persistent, actionable banner for a failed upload — a toast fades in a few
 * seconds, which is long enough to notice something went wrong but not long
 * enough to read what to do about it.
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
        <p className="mt-1 text-xs text-amber-300/80">{ADVICE[error.kind]}</p>
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
