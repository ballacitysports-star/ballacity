/**
 * Host-facing reliability for a player, from real attendance data.
 *
 * Unlike the public reputation percent in `player-stats.ts` (which ignores late
 * drops), this counts late drops against the player: a host vetting a join
 * request cares that someone bailed an hour before tip-off.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type PlayerReliability = {
  attended: number;
  noShows: number;
  lateDrops: number;
};

export type ReliabilityTier = "high" | "caution" | "new";

export type ReliabilitySummary = {
  tier: ReliabilityTier;
  /** Whole-number attendance percent, or null for a player with no history. */
  percent: number | null;
  label: string;
};

/** At or above this share of commitments kept, a player reads as reliable. */
export const HIGH_RELIABILITY_PERCENT = 90;

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function summarizeReliability(r: PlayerReliability): ReliabilitySummary {
  const commitments = r.attended + r.noShows + r.lateDrops;
  if (commitments === 0) {
    return { tier: "new", percent: null, label: "First run on BallaCity" };
  }
  const percent = Math.round((r.attended / commitments) * 100);
  if (percent >= HIGH_RELIABILITY_PERCENT) {
    return {
      tier: "high",
      percent,
      label: `${percent}% Attendance · ${plural(r.attended, "game")}`,
    };
  }
  const misses = [
    r.lateDrops > 0 ? plural(r.lateDrops, "late drop") : null,
    r.noShows > 0 ? plural(r.noShows, "no-show") : null,
  ].filter(Boolean);
  return { tier: "caution", percent, label: `${percent}% Attendance · ${misses.join(", ")}` };
}

/**
 * Null when the caller may not see this player's record (the RPC returns no
 * rows unless the caller is the player, a moderator, or the host of a game the
 * player is on / has requested / is waitlisted for).
 */
export async function fetchPlayerReliability(userId: string): Promise<PlayerReliability | null> {
  const { data, error } = await supabase.rpc("player_reliability", { _user: userId });
  if (error) throw error;
  const row = data?.[0];
  if (!row) return null;
  return {
    attended: Number(row.games_attended) || 0,
    noShows: Number(row.no_shows) || 0,
    lateDrops: Number(row.late_drops) || 0,
  };
}

export function usePlayerReliability(userId: string | undefined) {
  return useQuery({
    queryKey: ["player-reliability", userId],
    queryFn: () => fetchPlayerReliability(userId!),
    enabled: !!userId,
    staleTime: 60_000,
  });
}
