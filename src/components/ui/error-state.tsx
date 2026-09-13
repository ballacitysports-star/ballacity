import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one error state.
 *
 * Shows a human sentence and at most two next steps. Raw error text stays out
 * of the UI: it is useful in the console, never on screen, so `detail` is
 * rendered only when a caller passes something already written for a person.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "This didn't load. It's usually temporary — try again in a moment.",
  detail,
  onRetry,
  retryLabel = "Try again",
  secondaryAction,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  /** Extra human-readable context. Never pass a raw exception message. */
  detail?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  /** A link or button — "Go back", "Contact support". */
  secondaryAction?: ReactNode;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "rounded-3xl border border-border bg-surface px-6 py-10 text-center",
        className,
      )}
    >
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-coral/15 text-coral">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </div>
      <p className="font-semibold text-pretty">{title}</p>
      <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted-foreground text-pretty">
        {description}
      </p>
      {detail ? <p className="mt-2 text-xs text-muted-foreground text-pretty">{detail}</p> : null}
      {onRetry || secondaryAction ? (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className="rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground"
            >
              {retryLabel}
            </button>
          ) : null}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}
