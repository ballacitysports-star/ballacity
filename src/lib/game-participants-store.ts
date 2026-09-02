import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Live per-game participant counts.
 *
 * Subscribes to `game_participants` for a given `gameId` across ALL users
 * (not just the current viewer). Any INSERT/DELETE from another device or
 * player updates the count immediately, so roster totals and "spots left"
 * badges stay in sync in real time.
 *
 * The count is fetched with an exact HEAD count on first mount for each
 * game, cached in-memory, and then adjusted via realtime deltas.
 */

const counts = new Map<string, number>();
const listeners = new Map<string, Set<() => void>>();
const channels = new Map<string, ReturnType<typeof supabase.channel>>();
const hydrated = new Set<string>();
const inFlight = new Set<string>();

function emit(gameId: string) {
  listeners.get(gameId)?.forEach((l) => l());
}

/**
 * `game_participants` is readable only by signed-in users (RLS + grants), so
 * counting rows as a visitor would return a 401 for every card on the page.
 * Signed-out viewers fall back to the static `game.joined` count instead.
 */
async function hasSession() {
  const { data } = await supabase.auth.getSession();
  return !!data.session;
}

async function hydrate(gameId: string) {
  if (inFlight.has(gameId)) return;
  inFlight.add(gameId);
  try {
    if (!(await hasSession())) return;
    const { count, error } = await supabase
      .from("game_participants")
      .select("*", { count: "exact", head: true })
      .eq("game_id", gameId);
    if (!error && typeof count === "number") {
      counts.set(gameId, count);
      hydrated.add(gameId);
      emit(gameId);
    }
  } finally {
    inFlight.delete(gameId);
  }
}

async function attachChannel(gameId: string) {
  if (channels.has(gameId) || typeof window === "undefined") return;
  if (!(await hasSession())) return;

  const channel = supabase
    .channel(`game_participants:game:${gameId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "game_participants",
        filter: `game_id=eq.${gameId}`,
      },
      () => {
        counts.set(gameId, (counts.get(gameId) ?? 0) + 1);
        emit(gameId);
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
      () => {
        counts.set(gameId, Math.max((counts.get(gameId) ?? 1) - 1, 0));
        emit(gameId);
      },
    )
    .subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Re-hydrate on initial connect AND every reconnect. Optimistic +/- 1
        // deltas can drift if events are missed during a network flap; an
        // authoritative HEAD count on every SUBSCRIBED transition keeps
        // "spots left" badges consistent across devices.
        void hydrate(gameId);
      }
    });
  channels.set(gameId, channel);
}


function detachIfIdle(gameId: string) {
  const set = listeners.get(gameId);
  if (set && set.size > 0) return;
  const ch = channels.get(gameId);
  if (ch) {
    try {
      supabase.removeChannel(ch);
    } catch {
      /* ignore */
    }
    channels.delete(gameId);
  }
  hydrated.delete(gameId);
}

/**
 * Live participant count for a single game. Returns `undefined` until the
 * first hydration completes so callers can fall back to a static count
 * (e.g. `game.joined`) without briefly showing 0.
 */
export function useLiveParticipantCount(gameId: string | undefined): number | undefined {
  useEffect(() => {
    if (!gameId) return;
    attachChannel(gameId);
    void hydrate(gameId);
  }, [gameId]);

  const snapshot = useSyncExternalStore(
    (cb) => {
      if (!gameId) return () => {};
      let set = listeners.get(gameId);
      if (!set) {
        set = new Set();
        listeners.set(gameId, set);
      }
      set.add(cb);
      return () => {
        set!.delete(cb);
        if (set!.size === 0) {
          listeners.delete(gameId);
          detachIfIdle(gameId);
        }
      };
    },
    () => (gameId && hydrated.has(gameId) ? String(counts.get(gameId) ?? 0) : ""),
    () => "",
  );

  return snapshot === "" ? undefined : Number(snapshot);
}
