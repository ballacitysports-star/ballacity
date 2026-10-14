import type { Game } from "@/lib/sample-data";
import { gameEndsAt, hideFinishedGames, isGameFinished, onlyFinishedGames } from "@/lib/game-time";

/**
 * Collapse multi-day event series into a single card.
 *
 * Games created in "Multiple days" mode share a `seriesId`. In the Upcoming
 * tab the representative is the earliest session that hasn't finished yet; a
 * series disappears from Upcoming only once every session is finished. In the
 * Archive tab the representative is the most recently finished session.
 * Games without a series pass through untouched, preserving input order.
 */
export function collapseSeriesGames<T extends Game>(
  games: T[],
  tab: "upcoming" | "archive" = "upcoming",
  now: number = Date.now(),
): T[] {
  const bySeries = new Map<string, T[]>();
  for (const g of games) {
    if (!g.seriesId) continue;
    const list = bySeries.get(g.seriesId);
    if (list) list.push(g);
    else bySeries.set(g.seriesId, [g]);
  }
  if (bySeries.size === 0) return games;

  // Pick one representative per series for this tab.
  const reps = new Map<string, T>();
  for (const [sid, members] of bySeries) {
    const sorted = [...members].sort((a, b) => +new Date(a.date) - +new Date(b.date));
    let rep: T | undefined;
    if (tab === "archive") {
      const finished = sorted.filter((g) => isGameFinished(g, now));
      rep = finished[finished.length - 1];
    } else {
      rep = sorted.find((g) => !isGameFinished(g, now));
    }
    if (!rep) continue; // nothing to show for this tab
    reps.set(sid, { ...rep, seriesCount: members.length });
  }

  // Rebuild the list: standalone games plus one representative per series,
  // anchored at the series' first occurrence to keep ordering stable.
  const result: T[] = [];
  const emitted = new Set<string>();
  for (const g of games) {
    const sid = g.seriesId;
    if (!sid) {
      result.push(g);
      continue;
    }
    if (emitted.has(sid)) continue;
    emitted.add(sid);
    const rep = reps.get(sid);
    if (rep) result.push(rep);
  }
  return result;
}

/**
 * Split the games a user hosts or has joined into Upcoming (hosting / playing)
 * and Archive buckets, collapsing multi-day series to one card per tab so the
 * profile matches the Feed. The next unfinished session represents a series in
 * Upcoming; once every session is done the series moves to Archive.
 */
export function groupProfileGames<T extends Game & { hostUserId?: string }>(
  pool: T[],
  joinedIds: Set<string>,
  userId: string | undefined,
  now: number = Date.now(),
) {
  const isHosting = (g: T) => Boolean(userId && g.hostUserId === userId);
  const seen = new Set<string>();
  const relevant = pool
    .filter((g) => joinedIds.has(g.id) || isHosting(g))
    .filter((g) => (seen.has(g.id) ? false : (seen.add(g.id), true)))
    .sort((a, b) => +new Date(a.date) - +new Date(b.date));
  const live = hideFinishedGames(collapseSeriesGames(relevant, "upcoming", now), now).sort(
    (a, b) => +new Date(a.date) - +new Date(b.date),
  );
  const finished = onlyFinishedGames(collapseSeriesGames(relevant, "archive", now), now).sort(
    (a, b) => gameEndsAt(b) - gameEndsAt(a),
  );
  return {
    hosting: live.filter(isHosting),
    playing: live.filter((g) => !isHosting(g)),
    total: live.length,
    archiveHosting: finished.filter(isHosting),
    archivePlaying: finished.filter((g) => !isHosting(g)),
    archiveTotal: finished.length,
  };
}
