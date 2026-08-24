import type { Game } from "@/lib/sample-data";

/** Grace period after a game's computed end time before it counts as finished. */
const GRACE_MS = 15 * 60 * 1000;

/** Parse durations like "90 min", "1.5 h", "2 hours" into minutes (default 90). */
export function parseDurationMin(duration: string | null | undefined): number {
  if (!duration) return 90;
  const match = duration.match(/([\d.]+)/);
  const value = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(value) || value <= 0) return 90;
  return /h/i.test(duration) ? Math.round(value * 60) : Math.round(value);
}

/** Timestamp (ms) when a game is expected to end. */
export function gameEndsAt(game: Pick<Game, "date" | "duration">): number {
  const start = new Date(game.date).getTime();
  if (!Number.isFinite(start)) return Number.POSITIVE_INFINITY;
  return start + parseDurationMin(game.duration) * 60 * 1000;
}

/** True once a game's end time (plus a short grace period) has passed. */
export function isGameFinished(
  game: Pick<Game, "date" | "duration">,
  now: number = Date.now(),
): boolean {
  return gameEndsAt(game) + GRACE_MS < now;
}

/** Drop finished games from any list of games. */
export function hideFinishedGames<T extends Pick<Game, "date" | "duration">>(
  games: T[],
  now: number = Date.now(),
): T[] {
  return games.filter((g) => !isGameFinished(g, now));
}

/** Keep only finished games, for archive/history views. */
export function onlyFinishedGames<T extends Pick<Game, "date" | "duration">>(
  games: T[],
  now: number = Date.now(),
): T[] {
  return games.filter((g) => isGameFinished(g, now));
}
