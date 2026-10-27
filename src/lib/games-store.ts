import { useMemo, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";

const joined = new Set<string>();
const listeners = new Set<() => void>();
const STORAGE_KEY = "openrun.joinedGameIds.v1";
let loaded = false;
let hydrated = false;
let hydratingPromise: Promise<void> | null = null;
let realtimeAttached = false;
let currentUserId: string | null = null;
// Games whose join is being written right now: a refresh must not take them away.
const inFlight = new Set<string>();
let lastHydratedAt = 0;
const REHYDRATE_AFTER_MS = 30_000;
const EMPTY_SNAPSHOT = "[]";

function loadJoinedGames() {
  if (loaded || typeof window === "undefined") return false;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const ids = raw ? JSON.parse(raw) : [];
    if (Array.isArray(ids)) {
      joined.clear();
      ids.forEach((id) => {
        if (typeof id === "string") joined.add(id);
      });
    }
  } catch {
    joined.clear();
  }
  return true;
}

function saveJoinedGames() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(joined)));
  } catch {
    /* ignore */
  }
}

function emit() {
  listeners.forEach((l) => l());
}

function getSnapshot() {
  loadJoinedGames();
  ensureHydrated();
  ensureRealtime();
  return JSON.stringify(Array.from(joined).sort());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

async function hydrateFromDb(userId: string) {
  const { data, error } = await supabase
    .from("game_participants")
    .select("game_id")
    .eq("user_id", userId);
  if (error) return;
  lastHydratedAt = Date.now();
  // The database is the truth. A game the host removed us from, or that we left
  // on another device, while this one was offline would otherwise read "joined"
  // for good: the saved list only ever grew. Joins still being written stay.
  const onRoster = new Set((data ?? []).map((r) => r.game_id));
  Array.from(joined).forEach((id) => {
    if (!onRoster.has(id) && !inFlight.has(id)) joined.delete(id);
  });
  onRoster.forEach((id) => joined.add(id));
  saveJoinedGames();
  emit();
}

function ensureHydrated() {
  if (hydrated || typeof window === "undefined" || hydratingPromise) return;
  hydratingPromise = (async () => {
    const { data } = await supabase.auth.getUser();
    currentUserId = data.user?.id ?? null;
    if (currentUserId) await hydrateFromDb(currentUserId);
    hydrated = true;
  })().catch(() => {
    hydratingPromise = null;
  });
}

function ensureRealtime() {
  if (realtimeAttached || typeof window === "undefined") return;
  realtimeAttached = true;

  let channel: ReturnType<typeof supabase.channel> | null = null;

  const attach = (userId: string) => {
    if (channel) supabase.removeChannel(channel);
    channel = supabase
      .channel(`game_participants:me:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "game_participants",
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const row = payload.new as { game_id: string };
            joined.add(row.game_id);
          } else if (payload.eventType === "DELETE") {
            const row = payload.old as { game_id: string };
            joined.delete(row.game_id);
          }
          saveJoinedGames();
          emit();
        },
      )
      .subscribe();
  };

  if (currentUserId) attach(currentUserId);

  // A phone that was in a pocket missed realtime events; check the roster again
  // when the app comes back (at most every 30 seconds).
  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible" || !currentUserId) return;
      if (Date.now() - lastHydratedAt < REHYDRATE_AFTER_MS) return;
      void hydrateFromDb(currentUserId);
    });
  }

  supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_IN" || event === "USER_UPDATED") {
      const uid = session?.user?.id ?? null;
      if (uid && uid !== currentUserId) {
        currentUserId = uid;
        hydrated = false;
        hydratingPromise = null;
        ensureHydrated();
        attach(uid);
      }
    } else if (event === "SIGNED_OUT") {
      currentUserId = null;
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }
      joined.clear();
      saveJoinedGames();
      emit();
    }
  });
}

/**
 * Join a game. Resolves once the server has answered: true when the player is on
 * the roster (including when they already were), false when it refused or they
 * are signed out; the player has been told why. The list updates straight away
 * so the button responds, and is put back if the join fails.
 */
export async function joinGame(id: string, position?: string): Promise<boolean> {
  loadJoinedGames();
  if (joined.has(id) && !inFlight.has(id)) return true;
  if (inFlight.has(id)) return false;
  inFlight.add(id);
  joined.add(id);
  saveJoinedGames();
  emit();

  const undo = () => {
    joined.delete(id);
    saveJoinedGames();
    emit();
  };

  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) {
      undo();
      const { toast } = await import("sonner");
      toast.error("Sign in to join games.");
      return false;
    }
    const insert: TablesInsert<"game_participants"> = { game_id: id, user_id: uid };
    if (position && position.trim()) insert.position = position.trim();
    const { error } = await supabase.from("game_participants").insert(insert);
    // A duplicate means they were already on the roster, which is the outcome they wanted.
    if (error && error.code !== "23505") {
      undo();
      // The server-side join gate rejects cancelled/ended/closed/full games and
      // anything that needs a host's or guardian's approval first. Tell the
      // player why instead of silently un-joining them.
      const { joinGateErrorMessage } = await import("@/lib/game-status");
      const { toast } = await import("sonner");
      toast.error(joinGateErrorMessage(error));
      return false;
    }
    return true;
  } catch {
    undo();
    const { toast } = await import("sonner");
    toast.error("Couldn't reach BallaCity. Check your connection and try again.");
    return false;
  } finally {
    inFlight.delete(id);
  }
}

export function leaveGame(id: string) {
  loadJoinedGames();
  // Clear local optimistic state (may be a no-op for confirmed players who
  // got onto the roster server-side via approval/payment auto-join).
  const wasJoined = joined.has(id);
  if (wasJoined) {
    joined.delete(id);
    saveJoinedGames();
    emit();
  }
  // Always attempt the DB delete — confirmed players are on the roster
  // even when the local set never tracked them.
  void (async () => {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    const { error } = await supabase
      .from("game_participants")
      .delete()
      .eq("game_id", id)
      .eq("user_id", uid);
    if (error && wasJoined) {
      // Roll back optimistic local removal on real failure.
      joined.add(id);
      saveJoinedGames();
      emit();
    }
  })();
}

export function isJoined(id: string): boolean {
  loadJoinedGames();
  return joined.has(id);
}

export function useIsJoined(id: string): boolean {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);
  return useMemo(() => JSON.parse(snapshot).includes(id), [id, snapshot]);
}

export function useJoinedGameIds(): string[] {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);
  return useMemo(() => JSON.parse(snapshot), [snapshot]);
}
