/**
 * Placeholders that mirror <GameCard> and <GameListRow> block for block — the
 * image band, the status pill row, the title, the meta line, the host row and
 * the fill bar. The dimensions are deliberately the card's own, so a feed does
 * not shuffle its rows the moment real games arrive.
 */
export function GameCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-3xl border border-border bg-surface animate-pulse">
      <div className="relative h-28 w-full bg-secondary/60">
        <div className="absolute top-2 left-2 flex gap-1">
          <div className="h-4 w-20 rounded-full bg-background/50" />
          <div className="h-4 w-14 rounded-full bg-background/50" />
        </div>
        <div className="absolute top-2 right-2 h-4 w-10 rounded-full bg-background/50" />
        <div className="absolute bottom-2 left-3 right-3 h-4 w-2/3 rounded bg-background/50" />
      </div>
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-3">
          <div className="h-3 w-24 rounded bg-secondary/60" />
          <div className="h-3 w-16 rounded bg-secondary/60" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <div className="h-5 w-5 rounded-full bg-secondary/60" />
            <div className="h-3 w-28 rounded bg-secondary/60" />
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-7 w-7 rounded-full bg-secondary/60" />
            <div className="h-3 w-10 rounded bg-secondary/60" />
          </div>
        </div>
        <div className="h-1 rounded-full bg-secondary/60" />
      </div>
    </div>
  );
}

export function GameListRowSkeleton() {
  return (
    <div className="flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-border bg-surface p-2 pr-3 animate-pulse">
      <div className="h-14 w-14 shrink-0 rounded-xl bg-secondary/60" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="h-3.5 w-2/3 rounded bg-secondary/60" />
        <div className="flex items-center gap-2">
          <div className="h-3 w-14 rounded bg-secondary/60" />
          <div className="h-3 w-10 rounded bg-secondary/60" />
          <div className="h-3 w-10 rounded bg-secondary/60" />
        </div>
      </div>
      <div className="h-6 w-12 rounded-full bg-secondary/60" />
    </div>
  );
}
