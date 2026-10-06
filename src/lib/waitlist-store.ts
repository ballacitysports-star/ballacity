import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * waiting   – in the queue
 * approved  – host manually approved the request; the player can claim the spot
 * offered   – a spot opened on a paid / approval run and is held for the player
 *             until `offerExpiresAt`
 * declined  – host or the player turned it down
 * expired   – an offer lapsed unclaimed and rolled to the next player
 */
export type WaitlistStatus = "waiting" | "approved" | "declined" | "offered" | "expired";

export type WaitlistEntry = {
  id: string;
  gameId: string;
  position: string;
  userId: string;
  createdAt: string;
  status: WaitlistStatus;
  reviewedAt: string | null;
  /** When an `offered` spot goes to the next player. */
  offerExpiresAt: string | null;
  /** Set once the player confirmed the offer (paid runs still owe payment). */
  claimedAt: string | null;
};

type Row = {
  id: string;
  game_id: string;
  position: string;
  user_id: string;
  created_at: string;
  status?: string | null;
  reviewed_at?: string | null;
  offer_expires_at?: string | null;
  claimed_at?: string | null;
};

function toEntry(r: Row): WaitlistEntry {
  return {
    id: r.id,
    gameId: r.game_id,
    position: r.position,
    userId: r.user_id,
    createdAt: r.created_at,
    status: (r.status as WaitlistStatus | null) ?? "waiting",
    reviewedAt: r.reviewed_at ?? null,
    offerExpiresAt: r.offer_expires_at ?? null,
    claimedAt: r.claimed_at ?? null,
  };
}

const WAITLIST_COLUMNS =
  "id, game_id, position, user_id, created_at, status, reviewed_at, offer_expires_at, claimed_at";

/**
 * Live waitlist for one game. Fetches on mount and subscribes to
 * INSERT/DELETE so counts and viewer status stay in sync.
 */
export function useGameWaitlist(gameId: string | undefined): {
  entries: WaitlistEntry[];
  loading: boolean;
} {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gameId) {
      setEntries([]);
      setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("game_position_waitlist")
        .select(WAITLIST_COLUMNS)
        .eq("game_id", gameId)
        .order("created_at", { ascending: true });
      if (cancelled) return;
      if (!error && data) {
        setEntries((data as Row[]).map(toEntry));
      }
      setLoading(false);
    };
    void load();

    const channel = supabase
      .channel(`game_position_waitlist:${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "game_position_waitlist",
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const row = payload.new as Row;
          setEntries((prev) =>
            prev.some((e) => e.id === row.id) ? prev : [...prev, toEntry(row)],
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game_position_waitlist",
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const row = payload.new as Row;
          setEntries((prev) => prev.map((e) => (e.id === row.id ? toEntry(row) : e)));
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "game_position_waitlist",
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const old = payload.old as Partial<Row>;
          if (!old.id) return;
          setEntries((prev) => prev.filter((e) => e.id !== old.id));
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [gameId]);

  return { entries, loading };
}

export async function joinWaitlist(gameId: string, position: string): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("Sign in to join the waitlist.");
  const { error } = await supabase.from("game_position_waitlist").insert({
    game_id: gameId,
    position,
    user_id: uid,
  });
  // Duplicate = already on the list; treat as success.
  if (error && error.code !== "23505") throw error;
}

export async function leaveWaitlist(gameId: string, position: string): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) return;
  const { data: removed } = await supabase
    .from("game_position_waitlist")
    .delete()
    .eq("game_id", gameId)
    .eq("position", position)
    .eq("user_id", uid)
    .select("status");
  // Walking away from a held spot hands it to the next player right away.
  if (removed?.some((r) => r.status === "offered")) {
    void promoteWaitlistSafely(gameId);
  }
}

/**
 * Asks the server to fill any open spot from the waitlist. Fire-and-forget: the
 * roster change that triggered it has already succeeded, and the next call (any
 * roster change, or a waitlisted player opening the game) sweeps up after a miss.
 */
export async function promoteWaitlistSafely(gameId: string): Promise<void> {
  try {
    const { promoteNextWaitlistPlayer } = await import("@/lib/waitlist-promotion.functions");
    await promoteNextWaitlistPlayer({ data: { gameId } });
  } catch (e) {
    console.warn("waitlist promotion failed", (e as Error)?.message ?? e);
  }
}

/** Host action: approve or decline a waitlist entry as slots free up. */
export async function reviewWaitlistEntry(
  entryId: string,
  status: Exclude<WaitlistStatus, "waiting">,
): Promise<void> {
  const { data } = await supabase.auth.getUser();
  const uid = data.user?.id;
  if (!uid) throw new Error("Sign in to review the waitlist.");
  const { error } = await supabase
    .from("game_position_waitlist")
    .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: uid })
    .eq("id", entryId);
  if (error) throw error;
}

/** The signed-in user's waitlist entries across all games, with status. */
export function useMyWaitlist(): { entries: WaitlistEntry[]; loading: boolean } {
  const [entries, setEntries] = useState<WaitlistEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) {
        if (!cancelled) {
          setEntries([]);
          setLoading(false);
        }
        return;
      }
      const { data, error } = await supabase
        .from("game_position_waitlist")
        .select(WAITLIST_COLUMNS)
        .eq("user_id", uid)
        .order("created_at", { ascending: false });
      if (cancelled) return;
      if (!error && data) setEntries((data as Row[]).map(toEntry));
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { entries, loading };
}

export type WaitlistRank = {
  entryId: string;
  position: string;
  rank: number;
  total: number;
};

/**
 * The signed-in player's live place in line for one game. RLS hides other
 * players' rows, so the server computes the rank; we refetch on an interval and
 * whenever the player's own entries change (promotion, offer, expiry).
 */
export function useWaitlistRanks(gameId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["waitlist-ranks", gameId],
    enabled: !!gameId && enabled,
    refetchInterval: 30_000,
    queryFn: async (): Promise<WaitlistRank[]> => {
      const { data, error } = await supabase.rpc("my_waitlist_ranks", { _game_id: gameId! });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        entryId: r.entry_id,
        position: r.queue_position,
        rank: r.queue_rank,
        total: r.queue_total,
      }));
    },
  });
}
