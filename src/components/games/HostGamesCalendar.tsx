import { useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { dateKeyInZone, monthGridKeys, monthLabel, WEEKDAY_LABELS } from "@/lib/datetime";
import { formatGameWhen } from "@/lib/format";

export type HostCalendarGame = {
  id: string;
  title: string;
  date: string;
  price: number | null;
  location: string | null;
  cancelled_at: string | null;
};

/** Group games by their local date key ("" for undated rows). */
export function groupHostGames(games: HostCalendarGame[]): Map<string, HostCalendarGame[]> {
  const grouped = new Map<string, HostCalendarGame[]>();
  for (const game of games) {
    const key = dateKeyInZone(game.date);
    const day = grouped.get(key) ?? [];
    day.push(game);
    grouped.set(key, day);
  }
  return grouped;
}

/** Fee chip text: the game's price when it charges money, "Free" when it doesn't. */
export function gameFeeLabel(price: number | null): string {
  return Number(price) > 0 ? `$${Number(price).toFixed(2)}` : "Free";
}

function GameCard({ game }: { game: HostCalendarGame }) {
  const cancelled = !!game.cancelled_at;
  const paid = Number(game.price) > 0;
  return (
    <a
      href={`/games/${game.id}`}
      className={`block rounded-2xl border border-border bg-surface p-3 transition-colors hover:border-lime/40 ${
        cancelled ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{game.title}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{formatGameWhen({ date: game.date })}</span>
            {game.location && (
              <span className="inline-flex items-center gap-1 truncate">
                <MapPin className="h-3 w-3" /> {game.location}
              </span>
            )}
          </div>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${
            cancelled
              ? "border-coral/40 text-coral"
              : paid
                ? "border-lime/50 bg-lime/10 text-lime"
                : "border-border text-muted-foreground"
          }`}
        >
          {cancelled ? "Cancelled" : paid ? `Paid · ${gameFeeLabel(game.price)}` : "Free"}
        </span>
      </div>
    </a>
  );
}

export function HostGamesCalendar({ games }: { games: HostCalendarGame[] }) {
  const today = dateKeyInZone(new Date());
  const [selected, setSelected] = useState(today);
  const [cursor, setCursor] = useState(() => ({
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  }));

  const grouped = groupHostGames(games);
  const cells = monthGridKeys(cursor.year, cursor.month);
  const monthEvents = cells.flatMap((key) => (key ? grouped.get(key) ?? [] : []));
  const dayEvents = grouped.get(selected) ?? [];
  const undated = grouped.get("") ?? [];
  const active = monthEvents.filter((g) => !g.cancelled_at);
  const paidCount = active.filter((g) => Number(g.price) > 0).length;
  const shiftMonth = (delta: number) => {
    const next = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
    const year = next.getUTCFullYear();
    const month = next.getUTCMonth();
    setCursor({ year, month });
    setSelected(`${year}-${String(month + 1).padStart(2, "0")}-01`);
  };

  return (
    <section aria-label="Hosted games calendar" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold" aria-live="polite">
          {monthLabel(cursor.year, cursor.month)}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelected(today);
              setCursor({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 });
            }}
          >
            Today
          </Button>
          <Button variant="ghost" size="icon" aria-label="Previous month" title="Previous month" onClick={() => shiftMonth(-1)}>
            <ChevronLeft />
          </Button>
          <Button variant="ghost" size="icon" aria-label="Next month" title="Next month" onClick={() => shiftMonth(1)}>
            <ChevronRight />
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-y border-border py-3 text-sm">
        <span className="font-semibold">{active.length} games</span>
        <span className="text-muted-foreground">{paidCount} paid · {active.length - paidCount} free</span>
      </div>
      <div className="grid grid-cols-7" role="group" aria-label={monthLabel(cursor.year, cursor.month)}>
        {WEEKDAY_LABELS.map((day) => (
          <span key={day} className="pb-2 text-center text-[11px] font-bold text-muted-foreground">
            {day}
          </span>
        ))}
        {cells.map((key, index) => {
          if (!key) return <div key={`empty-${index}`} className="h-20 border-b border-border sm:h-24" />;
          const entries = grouped.get(key) ?? [];
          const cancelledCount = entries.filter((g) => g.cancelled_at).length;
          const dots = entries.map((g) => (Number(g.price) > 0 && !g.cancelled_at ? "paid" : "free"));
          return (
            <Button
              key={key}
              variant="ghost"
              aria-pressed={selected === key}
              aria-current={today === key ? "date" : undefined}
              aria-label={`${key}, ${entries.length} game${entries.length === 1 ? "" : "s"}${entries.some((g) => Number(g.price) > 0 && !g.cancelled_at) ? ", includes paid" : ""}`}
              onClick={() => setSelected(key)}
              className={`h-20 min-w-0 flex-col justify-start gap-0.5 overflow-hidden whitespace-normal rounded-none border-b border-border px-0.5 py-1.5 sm:h-24 sm:px-2 ${
                selected === key ? "bg-primary/10 ring-1 ring-inset ring-primary" : ""
              }`}
            >
              <span
                className={`inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs ${
                  key === today ? "bg-primary text-primary-foreground" : ""
                }`}
              >
                {Number(key.slice(8, 10))}
              </span>
              {entries.length > 0 && (
                <>
                  <span className="flex items-center gap-0.5">
                    {dots.slice(0, 4).map((d, i) => (
                      <span
                        key={i}
                        aria-hidden="true"
                        className={`size-1.5 rounded-full ${d === "paid" ? "bg-lime" : "bg-muted-foreground/50"}`}
                      />
                    ))}
                  </span>
                  <span className="w-full truncate text-[10px] text-muted-foreground">
                    {entries.length - cancelledCount > 0 ? `${entries.length - cancelledCount} game${entries.length - cancelledCount === 1 ? "" : "s"}` : ""}
                    {cancelledCount > 0 ? `${entries.length - cancelledCount > 0 ? " · " : ""}${cancelledCount} cancelled` : ""}
                  </span>
                </>
              )}
            </Button>
          );
        })}
      </div>
      {monthEvents.length === 0 && <p className="text-sm text-muted-foreground">No games scheduled this month.</p>}
      <div className="space-y-3" aria-live="polite">
        <h3 className="text-sm font-bold">
          {new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
            year: "numeric",
          })}{" "}
          · {dayEvents.length} game{dayEvents.length === 1 ? "" : "s"}
        </h3>
        {dayEvents.length ? (
          <ul className="space-y-3">
            {dayEvents.map((g) => (
              <li key={g.id}>
                <GameCard game={g} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No games on this day.</p>
        )}
      </div>
      {undated.length > 0 && (
        <div className="space-y-3">
          <h3 className="section-eyebrow text-muted-foreground">Date TBA · {undated.length}</h3>
          <ul className="space-y-3">
            {undated.map((g) => (
              <li key={g.id}>
                <GameCard game={g} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
