export function RequestGameCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface animate-pulse">
      {/* Image placeholder */}
      <div className="relative h-44 bg-muted" />

      <div className="p-4 space-y-3">
        {/* Date / distance lines */}
        <div className="flex items-center gap-3">
          <div className="h-4 w-24 rounded bg-muted" />
          <div className="h-4 w-16 rounded bg-muted" />
        </div>
        {/* Host / spots line */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-muted" />
            <div className="h-3.5 w-20 rounded bg-muted" />
          </div>
          <div className="h-3.5 w-14 rounded bg-muted" />
        </div>
        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-secondary">
          <div className="h-full w-1/2 rounded-full bg-muted" />
        </div>
      </div>

      {/* Status footer placeholder */}
      <div className="mx-4 mb-4 rounded-2xl border border-border p-3 flex items-center gap-3">
        <div className="h-4 w-4 rounded-full bg-muted" />
        <div className="h-3.5 w-32 rounded bg-muted" />
      </div>
    </div>
  );
}
