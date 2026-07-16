export function GameCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface animate-pulse">
      <div className="h-28 w-full bg-secondary/60" />
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-3 w-20 rounded bg-secondary/60" />
          <div className="h-3 w-14 rounded bg-secondary/60" />
        </div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="h-5 w-5 rounded-full bg-secondary/60" />
            <div className="h-3 w-24 rounded bg-secondary/60" />
          </div>
          <div className="h-3 w-10 rounded bg-secondary/60" />
        </div>
        <div className="h-1 rounded-full bg-secondary/60" />
        <div className="h-8 w-full rounded-2xl bg-secondary/60" />
      </div>
    </div>
  );
}

export function GameListRowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-2 pr-3 animate-pulse">
      <div className="h-14 w-14 shrink-0 rounded-xl bg-secondary/60" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3.5 w-2/3 rounded bg-secondary/60" />
        <div className="flex items-center gap-2">
          <div className="h-3 w-14 rounded bg-secondary/60" />
          <div className="h-3 w-10 rounded bg-secondary/60" />
          <div className="h-3 w-10 rounded bg-secondary/60" />
        </div>
      </div>
      <div className="h-5 w-10 rounded-full bg-secondary/60" />
    </div>
  );
}
