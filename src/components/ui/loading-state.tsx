import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The one inline loading state, plus the list skeletons the tabs share.
 *
 * A spinner with no label leaves people guessing whether their tap landed, so
 * the label is required. Lists prefer `ListSkeleton`: shapes in the place the
 * content will occupy read as progress, a centred spinner reads as a stall.
 */
export function LoadingState({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground",
        className,
      )}
    >
      <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

/** A row of the same shape the players/teams/trainers/message lists render. */
export function ListRowSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-3 rounded-2xl border border-border bg-surface p-3">
      <div className="h-11 w-11 shrink-0 rounded-full bg-secondary/60" />
      <div className="min-w-0 flex-1 space-y-2">
        <div className="h-3.5 w-1/2 rounded bg-secondary/60" />
        <div className="h-3 w-1/3 rounded bg-secondary/60" />
      </div>
      <div className="h-7 w-16 shrink-0 rounded-full bg-secondary/60" />
    </div>
  );
}

export function ListSkeleton({ rows = 4, label = "Loading…" }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-2" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }).map((_, i) => (
        <ListRowSkeleton key={i} />
      ))}
    </div>
  );
}
