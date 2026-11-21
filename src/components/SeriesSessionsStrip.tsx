import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Repeat as RepeatIcon } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Game } from "@/lib/sample-data";
import { repeatLabel, repeatOf, stopGameSeries } from "@/lib/game-series-api";
import { userErrorMessage } from "@/lib/user-error";

type SessionRow = {
  id: string;
  date: string;
  duration: string;
  all_day?: boolean | null;
  rrule?: unknown;
};

function formatSession(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(+d)) return "";
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function formatTime(dateIso: string): string {
  const d = new Date(dateIso);
  if (Number.isNaN(+d)) return "";
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

/**
 * "More dates" strip for a game with several dates: dates picked up front (a multi-day event) or a repeating series the
 * server keeps going (WP 3.1). Players switch between dates; the host of a repeating series can stop it.
 */
export function SeriesSessionsStrip({ game, isHost = false }: { game: Game; isHost?: boolean }) {
  const seriesId = game.seriesId;
  const qc = useQueryClient();
  const [stopped, setStopped] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [stopping, setStopping] = useState(false);

  const { data: sessions } = useQuery({
    queryKey: ["game-series-sessions", seriesId],
    enabled: !!seriesId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hosted_games")
        .select("id, date, duration, all_day, rrule")
        .eq("series_id", seriesId as string)
        .is("cancelled_at", null)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
  });

  // The date list is read fresh, so it knows a series started a moment ago even when the cached game does not.
  const current = sessions?.find((x) => x.id === game.id);
  const repeat = stopped ? null : current ? repeatOf(current.rrule) : (game.repeat ?? null);
  if (!seriesId || !sessions || (sessions.length <= 1 && !repeat)) return null;

  const stop = async () => {
    if (!seriesId) return;
    setStopping(true);
    try {
      await stopGameSeries(seriesId);
      setStopped(true);
      setConfirming(false);
      void qc.invalidateQueries({ queryKey: ["game-series-sessions", seriesId] });
      toast.success("Stopped repeating. Dates already added stay; cancel any you don't need.");
    } catch (e) {
      toast.error(userErrorMessage(e, "Couldn't stop the series. Please try again."));
    } finally {
      setStopping(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface p-3" data-testid="series-strip">
      <div className="mb-2 flex items-center gap-1.5 section-eyebrow text-muted-foreground">
        {repeat ? (
          <RepeatIcon className="h-3.5 w-3.5 text-lime" aria-hidden />
        ) : (
          <CalendarDays className="h-3.5 w-3.5 text-lime" aria-hidden />
        )}
        {repeat
          ? `${repeatLabel(repeat)} · ${sessions.length} ${sessions.length === 1 ? "date" : "dates"}`
          : `Multi-day event · ${sessions.length} sessions`}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {sessions.map((s) => {
          const isCurrent = s.id === game.id;
          return (
            <Link
              key={s.id}
              to="/games/$gameId"
              params={{ gameId: s.id }}
              aria-current={isCurrent ? "page" : undefined}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                isCurrent
                  ? "border-lime bg-lime text-primary-foreground"
                  : "border-border bg-background hover:border-lime/40 hover:text-lime"
              }`}
            >
              {s.all_day
                ? formatSession(s.date)
                : `${formatSession(s.date)} · ${formatTime(s.date)}`}
            </Link>
          );
        })}
      </div>
      {repeat && isHost && (
        <div className="mt-3 border-t border-border pt-3">
          {confirming ? (
            <div className="space-y-2">
              <p className="text-[12px] text-muted-foreground">
                Stop adding new dates? Dates already added stay; you can cancel any of them
                separately.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={stop}
                  disabled={stopping}
                  className="rounded-full bg-destructive-strong px-3 py-1.5 text-[12px] font-semibold text-destructive-foreground disabled:opacity-60"
                >
                  {stopping ? "Stopping…" : "Stop repeating"}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="rounded-full border border-border px-3 py-1.5 text-[12px] font-semibold"
                >
                  Keep it
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="text-[12px] font-semibold text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              Stop repeating
            </button>
          )}
        </div>
      )}
    </div>
  );
}
