/**
 * Player reputation stats, sourced from the database instead of sample data.
 *
 * `player_activity_stats` is a SECURITY DEFINER aggregate: it returns counts
 * only (games attended, no-shows, hosted totals, review averages) and never
 * PII, so it is safe to read for any profile the viewer can already see.
 * Reliability is derived here so every surface — profile header, player card,
 * badge list — reports the same number.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { makeBadgeStats, type BadgeStats, type SportsmanshipTraitCounts } from "@/lib/badges";

export type PlayerActivityStats = {
  gamesJoined: number;
  gamesAttended: number;
  gamesCompleted: number;
  noShows: number;
  hostedTotal: number;
  hostedCompleted: number;
  hostedCancelled: number;
  teamsCount: number;
  reviewCount: number;
  verifiedReviewCount: number;
  reviewAvg: number;
  firstActivityAt: string | null;
  /** AI-extracted trait mentions from reviews (zeros until reviews are analysed). */
  traits?: SportsmanshipTraitCounts;
};

export const EMPTY_PLAYER_STATS: PlayerActivityStats = {
  gamesJoined: 0,
  gamesAttended: 0,
  gamesCompleted: 0,
  noShows: 0,
  hostedTotal: 0,
  hostedCompleted: 0,
  hostedCancelled: 0,
  teamsCount: 0,
  reviewCount: 0,
  verifiedReviewCount: 0,
  reviewAvg: 0,
  firstActivityAt: null,
};

/**
 * Share of marked games the player actually showed up for, as a percent.
 *
 * Unmarked games are excluded: a host who never marks attendance must not
 * drag a player's reliability down. With nothing marked yet we report 100 so
 * new players start clean rather than looking unreliable.
 */
export function reliabilityPercent(s: PlayerActivityStats): number {
  const marked = s.gamesAttended + s.noShows;
  if (marked === 0) return 100;
  return Math.round((s.gamesAttended / marked) * 100);
}

export function toBadgeStats(s: PlayerActivityStats, verified = false): BadgeStats {
  const marked = s.gamesAttended + s.noShows;
  const showUpRate = marked === 0 ? 0 : s.gamesAttended / marked;
  return makeBadgeStats({
    gamesPlayed: s.gamesAttended,
    hosted: s.hostedCompleted,
    showUpRate,
    // Punctuality is not tracked separately yet; attendance is the honest proxy.
    onTimeRate: showUpRate,
    sportsmanshipRating: s.reviewAvg,
    reviewCount: s.reviewCount,
    ...(s.traits ? { traits: s.traits } : {}),
    verified,
  });
}

export async function fetchPlayerActivityStats(userId: string): Promise<PlayerActivityStats> {
  const { data, error } = await supabase.rpc("player_activity_stats", { _user: userId });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
  if (!row) return EMPTY_PLAYER_STATS;
  const num = (k: string) => Number(row[k] ?? 0) || 0;
  const { data: t } = await supabase.rpc("player_trait_counts", { _user: userId });
  const tr = (Array.isArray(t) ? t[0] : t) as Record<string, number> | null | undefined;
  return {
    traits: {
      respectful: Number(tr?.respectful ?? 0),
      communicative: Number(tr?.communicative ?? 0),
      fairPlay: Number(tr?.fair_play ?? 0),
      positive: Number(tr?.positive ?? 0),
      onTime: Number(tr?.on_time ?? 0),
    },
    gamesJoined: num("games_joined"),
    gamesAttended: num("games_attended"),
    gamesCompleted: num("games_completed"),
    noShows: num("no_shows"),
    hostedTotal: num("hosted_total"),
    hostedCompleted: num("hosted_completed"),
    hostedCancelled: num("hosted_cancelled"),
    teamsCount: num("teams_count"),
    reviewCount: num("review_count"),
    verifiedReviewCount: num("verified_review_count"),
    reviewAvg: num("review_avg"),
    firstActivityAt: (row["first_activity_at"] as string) ?? null,
  };
}

export function usePlayerActivityStats(userId: string | undefined) {
  return useQuery({
    queryKey: ["player-activity-stats", userId],
    queryFn: () => fetchPlayerActivityStats(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  });
}
