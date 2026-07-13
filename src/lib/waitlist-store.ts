import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type WaitlistEntry = {
  id: string;
  gameId: string;
  position: string;
  userId: string;
  createdAt: string;
};

type Row = {
  id: string;
  game_id: string;
  position: string;
  user_id: string;
  created_at: string;
};

function toEntry(r: Row): WaitlistEntry {
  return {
    id: r.id,
    gameId: r.game_id,
    position: r.position,
    userId: r.user_id,
    createdAt: r.created_at,
  };
}

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
        .select("id, game_id, position, user_id, created_at")
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
  await supabase
    .from("game_position_waitlist")
    .delete()
    .eq("game_id", gameId)
    .eq("position", position)
    .eq("user_id", uid);
}
