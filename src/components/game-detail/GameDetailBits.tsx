import { formatGameEnds } from "@/lib/format";
import { gameEndsAt } from "@/lib/game-time";
import type { Game } from "@/lib/sample-data";

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="micro-label text-muted-foreground mb-1">{label}</div>
      {children}
    </label>
  );
}

/** End date + time for the meta grid; falls back to the raw length text. */
export function formatEndsAt(
  game: Pick<Game, "date" | "duration" | "allDay"> & { endsAt?: string | null },
): string {
  const end = gameEndsAt(game);
  return formatGameEnds({
    date: game.date,
    allDay: game.allDay,
    duration: game.duration,
    endsAt: Number.isFinite(end) ? new Date(end).toISOString() : null,
  });
}

export function Meta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="flex items-center gap-1.5 micro-label text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-0.5 font-semibold text-sm">{value}</div>
    </div>
  );
}
