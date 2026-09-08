import { cn } from "@/lib/utils";

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
  className?: string;
};

export function RouteFallback({ title, message, action, onRetry, className }: RouteFallbackProps) {
  return (
    <div className={cn("grid min-h-dvh place-items-center px-6 text-center", className)}>
      <div className="max-w-sm">
        <h1 className="font-display text-2xl font-bold text-balance">{title}</h1>
        {message ? (
          <p className="mt-2 text-sm text-muted-foreground text-pretty">{message}</p>
        ) : null}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
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
