import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/**
 * The header every legal page wears, and the fallback shown when one cannot
 * render at all.
 *
 * Both exist for the same reason: a legal page must always be leaveable. The
 * fallback previously rendered as a bare line of text, which replaced the
 * whole page — header and back arrow included — leaving a reader with no way
 * out except the browser's own back button, which an installed PWA does not
 * show. Anything that stands in for one of these pages therefore carries the
 * same header as the page itself.
 */

export function LegalPageHeader({ title }: { title: string }) {
  return (
    <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background/95 px-2 py-2.5 backdrop-blur">
      <Link to="/" className="rounded-full p-2 hover:bg-surface" aria-label="Back">
        <ArrowLeft className="h-5 w-5" />
      </Link>
      <span className="text-sm font-medium">{title}</span>
    </header>
  );
}

/**
 * Stand-in for a legal page that could not be rendered. `onRetry` comes from
 * the router's own error boundary when there is something to retry.
 */
export function LegalPageFallback({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="min-h-dvh bg-background">
      <LegalPageHeader title={title} />
      <main className="page-shell-content py-10">
        <p className="text-sm text-muted-foreground">{message}</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full bg-lime px-4 py-2 text-sm font-bold text-primary-foreground"
            >
              Try again
            </button>
          ) : null}
          <Link
            to="/"
            className="rounded-full border border-border px-4 py-2 text-sm font-bold hover:bg-surface"
          >
            Go home
          </Link>
        </div>
      </main>
    </div>
  );
}
