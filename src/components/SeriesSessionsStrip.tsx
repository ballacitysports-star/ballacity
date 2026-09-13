import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import type { Game } from "@/lib/sample-data";

type SessionRow = { id: string; date: string; duration: string; all_day?: boolean | null };

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
 * "More dates" strip for multi-day events: when a game belongs to a series,
 * list every session so players can switch between days.
 */
export function SeriesSessionsStrip({ game }: { game: Game }) {
  const seriesId = game.seriesId;
  const { data: sessions } = useQuery({
    queryKey: ["game-series-sessions", seriesId],
    enabled: !!seriesId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("hosted_games")
        .select("id, date, duration, all_day")
        .eq("series_id", seriesId as string)
        .order("date", { ascending: true });
      if (error) throw error;
      return (data ?? []) as SessionRow[];
    },
  });

  if (!seriesId || !sessions || sessions.length <= 1) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-1.5 section-eyebrow text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5 text-lime" />
        Multi-day event · {sessions.length} sessions
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
    </div>
  );
}
