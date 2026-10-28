import { useEffect } from "react";
import { cn } from "@/lib/utils";
import { isChunkLoadError } from "@/lib/chunk-error";

/**
 * What a route shows when it cannot render: a not-found, or a loader that
 * threw.
 *
 * The router swaps these in *instead of* the route's component, so whatever
 * chrome that component would have drawn — headers, tab bars, back arrows —
 * is gone. A fallback that is only a line of text therefore strands the
 * reader with no way onward except the browser's own back button, which an
 * installed PWA does not show. So every fallback offers somewhere to go.
 *
 * The action is a slot rather than a `to` prop because TanStack types link
 * targets against the real route tree; keeping the `<Link>` at the call site
 * means a typo in a destination is a type error rather than a dead link.
 */

/** Styling for the primary way out, so the fallbacks look like each other. */
export const FALLBACK_ACTION_CLASS =
  "inline-block rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground";

/** Styling for a secondary action next to the primary one. */
export const FALLBACK_SECONDARY_CLASS =
  "inline-block rounded-full border border-border px-5 py-2.5 text-sm font-bold hover:bg-surface";

export type RouteFallbackProps = {
  title: string;
  message?: string;
  /** Usually a `<Link>` carrying FALLBACK_ACTION_CLASS. */
  action?: React.ReactNode;
  /** Wire to the router's `reset` when the failure is worth retrying. */
  onRetry?: () => void;
  /**
   * What actually went wrong, when the route has it. A page open across an update
   * gets a Reload button (retrying cannot fix a missing file); any other error is
   * logged and its message shown small, so a report says what failed.
   */
  error?: unknown;
  className?: string;
};

export function RouteFallback({
  title,
  message,
  action,
  onRetry,
  error,
  className,
}: RouteFallbackProps) {
  const stale = isChunkLoadError(error);
  useEffect(() => {
    if (error) console.error("[route-error]", error);
  }, [error]);
  const detail =
    !stale && error instanceof Error && error.message && error.message !== message
      ? error.message.slice(0, 160)
      : null;
  return (
    <div className={cn("grid min-h-dvh place-items-center px-6 text-center", className)}>
      <div className="max-w-sm">
        <h1 className="font-display text-2xl font-bold text-balance">
          {stale ? "BallaCity was updated" : title}
        </h1>
        {stale || message ? (
          <p className="mt-2 text-sm text-muted-foreground text-pretty">
            {stale
              ? "This page was open during an update. Reload to get the latest version."
              : message}
          </p>
        ) : null}
        {detail ? (
          <p className="mt-2 break-words text-[11px] text-muted-foreground/70">Details: {detail}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {stale ? (
            <button
              type="button"
              onClick={() => window.location.reload()}
              className={FALLBACK_ACTION_CLASS}
            >
              Reload
            </button>
          ) : onRetry ? (
            <button type="button" onClick={onRetry} className={FALLBACK_ACTION_CLASS}>
              Try again
            </button>
          ) : null}
          {action}
        </div>
      </div>
    </div>
  );
}
