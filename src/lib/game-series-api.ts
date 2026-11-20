/**
 * Repeating games (WP 3.1). The server keeps a series going: game_series_start makes an upcoming game repeat every week or
 * every 2 weeks and creates the next dates up to 4 weeks ahead; a daily job adds the rest, each a copy of the latest date.
 * game_series_stop ends it; dates already created stay (migration 20261122100000_game_series).
 */
import { supabase } from "@/integrations/supabase/client";

export type RepeatFreq = "weekly" | "biweekly";
export type Repeat = { freq: RepeatFreq; until: string | null };
export type RepeatChoice = { freq: "none" | RepeatFreq; until: string | null };

export const REPEAT_OPTIONS: { value: RepeatChoice["freq"]; label: string }[] = [
  { value: "none", label: "Doesn't repeat" },
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
];

/** A game row's rrule as the app uses it, or null when it does not repeat (or the value is not one the server writes). */
export function repeatOf(rrule: unknown): Repeat | null {
  if (!rrule || typeof rrule !== "object") return null;
  const r = rrule as { freq?: unknown; until?: unknown };
  if (r.freq !== "weekly" && r.freq !== "biweekly") return null;
  const until = typeof r.until === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.until) ? r.until : null;
  return { freq: r.freq, until };
}

/** "Repeats every week", "Repeats every 2 weeks until Dec 20". */
export function repeatLabel(repeat: Repeat | null | undefined): string | null {
  if (!repeat) return null;
  const every = repeat.freq === "biweekly" ? "every 2 weeks" : "every week";
  if (!repeat.until) return `Repeats ${every}`;
  const [y, m, d] = repeat.until.split("-").map(Number);
  const until = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  return `Repeats ${every} until ${until}`;
}

/** Whether a "last date" is acceptable for a first game on `firstDateKey` (both "YYYY-MM-DD"). */
export function untilError(firstDateKey: string, until: string | null): string | null {
  if (!until) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return "Pick a valid last date.";
  return until < firstDateKey ? "The last date must be on or after the first game." : null;
}

export async function startGameSeries(
  gameId: string,
  choice: RepeatChoice,
): Promise<{ seriesId: string; created: number }> {
  if (choice.freq === "none") throw new Error("This game does not repeat.");
  const { data, error } = await supabase.rpc(
    "game_series_start" as never,
    {
      _game: gameId,
      _freq: choice.freq,
      _until: choice.until,
    } as never,
  );
  if (error) throw new Error(error.message);
  const d = (data ?? {}) as { series_id?: string; created?: number };
  return { seriesId: String(d.series_id ?? ""), created: Number(d.created ?? 0) };
}

export async function stopGameSeries(seriesId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc(
    "game_series_stop" as never,
    {
      _series: seriesId,
    } as never,
  );
  if (error) throw new Error(error.message);
  return !!data;
}
