import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type LiveParticipant = {
  userId: string;
  joinedAt: string;
  displayName: string;
  avatarInitials: string;
  avatarUrl: string | null;
  username: string | null;
  position: string | null;
  /** Host-marked attendance: true = showed up, false = no-show, null = unmarked. */
  attended: boolean | null;
};

type Row = {
  user_id: string;
  created_at: string;
  position: string | null;
  attended?: boolean | null;
};


type ProfileRow = {
  id: string;
  display_name: string | null;
  username: string | null;
  avatar_initials: string | null;
  avatar_url: string | null;
};

function initialsFrom(name: string | null | undefined, fallback = "P"): string {
  const s = (name ?? "").trim();
  if (!s) return fallback;
  const parts = s.split(/\s+/);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : s.slice(0, 2);
  return letters.toUpperCase();
}

async function fetchProfiles(userIds: string[]): Promise<Map<string, ProfileRow>> {
  const map = new Map<string, ProfileRow>();
  if (userIds.length === 0) return map;
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_initials, avatar_url")
    .in("id", userIds);
  (data ?? []).forEach((p) => map.set(p.id, p as ProfileRow));
  return map;
}

function toParticipant(row: Row, profile: ProfileRow | undefined): LiveParticipant {
  const displayName = profile?.display_name ?? "Player";
  return {
    userId: row.user_id,
    joinedAt: row.created_at,
    displayName,
    avatarInitials: profile?.avatar_initials || initialsFrom(displayName),
    avatarUrl: profile?.avatar_url ?? null,
    username: profile?.username ?? null,
    position: row.position ?? null,
    attended: row.attended ?? null,
  };
}


/**
 * Live participant list for a single game. Fetches confirmed players from
 * `game_participants`, enriches them with `profiles`, and subscribes to
 * INSERT/DELETE events (any user, any device) so the roster updates in
 * real time when someone joins or leaves.
 */
export function useLiveParticipants(gameId: string | undefined): {
  participants: LiveParticipant[];
  loading: boolean;
  refetch: () => Promise<void>;
  removeLocal: (userId: string) => void;
} {
  const reloadRef = useRef<() => Promise<void>>(async () => {});
  const [participants, setParticipants] = useState<LiveParticipant[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gameId) {
      setParticipants([]);
      setLoading(false);
      return;
    }
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("game_participants")
        .select("user_id, created_at, position, attended")
        .eq("game_id", gameId)
        .order("created_at", { ascending: true });

      if (cancelled) return;
      if (error) {
        setLoading(false);
        return;
      }
      const rows = (data ?? []) as Row[];
      const profiles = await fetchProfiles(rows.map((r) => r.user_id));
      if (cancelled) return;
      // Replace wholesale — this is the authoritative snapshot. Any realtime
      // deltas that arrived during the fetch will be reapplied on the next
      // event; the SUBSCRIBED-triggered reload guarantees we can't miss one.
      setParticipants(rows.map((r) => toParticipant(r, profiles.get(r.user_id))));
      setLoading(false);
    };
    reloadRef.current = load;

    // Subscribe FIRST, then fetch the snapshot on the SUBSCRIBED ack (initial
    // connect AND every reconnect after a network flap). This closes the race
    // where an INSERT/DELETE fires between the SELECT and the subscribe ack,
    // and it re-syncs after transient disconnects that would otherwise drop
    // events silently.
    const channel = supabase
      .channel(`game_participants:roster:${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "game_participants",
          filter: `game_id=eq.${gameId}`,
        },
        async (payload) => {
          const row = payload.new as Row;
          const profiles = await fetchProfiles([row.user_id]);
          if (cancelled) return;
          setParticipants((prev) => {
            if (prev.some((p) => p.userId === row.user_id)) return prev;
            return [...prev, toParticipant(row, profiles.get(row.user_id))];
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "game_participants",
          filter: `game_id=eq.${gameId}`,
        },
        async (payload) => {
          const row = payload.new as Row;
          const profiles = await fetchProfiles([row.user_id]);
          if (cancelled) return;
          setParticipants((prev) =>
            prev.map((p) =>
              p.userId === row.user_id ? toParticipant(row, profiles.get(row.user_id)) : p,
            ),
          );
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "game_participants",
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          const old = payload.old as Partial<Row>;
          if (!old.user_id) {
            // Replica identity may not include user_id — fall back to a full
            // resync so the row disappears everywhere.
            void reloadRef.current();
            return;
          }
          setParticipants((prev) => prev.filter((p) => p.userId !== old.user_id));
        },
      )
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") {
          // Initial connect + every reconnect: reload the authoritative list.
          void reloadRef.current();
        }
      });

    return () => {
      cancelled = true;
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    };
  }, [gameId]);


  const refetch = useCallback(async () => {
    await reloadRef.current();
  }, []);

  const removeLocal = useCallback((userId: string) => {
    setParticipants((prev) => prev.filter((p) => p.userId !== userId));
  }, []);

  return { participants, loading, refetch, removeLocal };
}

