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
  // Merge DB truth in; keep local-only entries for sample (non-DB) games.
  (data ?? []).forEach((r) => joined.add(r.game_id));
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

export function joinGame(id: string, position?: string) {
  loadJoinedGames();
  if (joined.has(id)) return;
  joined.add(id);
  saveJoinedGames();
  emit();
  // Best-effort DB write; realtime will confirm.
  void (async () => {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    const insert: TablesInsert<"game_participants"> = { game_id: id, user_id: uid };
    if (position && position.trim()) insert.position = position.trim();
    const { error } = await supabase.from("game_participants").insert(insert);
    if (error && error.code !== "23505") {
      // Roll back on real failures (e.g. FK / RLS). Duplicate is fine.
      joined.delete(id);
      saveJoinedGames();
      emit();
      // The server-side join gate rejects cancelled/ended/closed/full games.
      // Tell the player why instead of silently un-joining them.
      const { joinGateErrorMessage } = await import("@/lib/game-status");
      const { toast } = await import("sonner");
      toast.error(joinGateErrorMessage(error));
    }
  })();
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
    if (error) {
      if (wasJoined) {
        // Roll back optimistic local removal on real failure.
        joined.add(id);
        saveJoinedGames();
        emit();
      }
      return;
    }
    // The freed spot goes to the next waitlisted player (auto-join on free runs,
    // a timed offer on paid / approval runs) so it is never stranded.
    const { promoteWaitlistSafely } = await import("@/lib/waitlist-store");
    await promoteWaitlistSafely(id);
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
