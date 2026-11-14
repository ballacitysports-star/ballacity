import { useMemo, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert } from "@/integrations/supabase/types";

const joined = new Set<string>();
// Which game each of the viewer's roster rows is for, by row id. game_participants
// has REPLICA IDENTITY FULL, so Realtime can apply the user_id filter to a DELETE
// and does deliver the viewer's own leaves to this channel (and nobody else's).
// But the table has row-level security, and for such a table Realtime strips the
// DELETE's `old` down to the primary key: `{ id }`, no game_id (seen on the local
// stack). The row id is all a leave on another device tells us; this map turns it
// into the game. It is filled from the roster load, from this device's own joins
// and from realtime INSERTs.
const rowGame = new Map<string, string>();
// When each row id, and each game's joined state, was last learned or changed
// here, on one counter. A roster load that started earlier must not undo them.
let changeSeq = 0;
const rowLearnedAt = new Map<string, number>();
const gameChangedAt = new Map<string, number>();

function learnRow(rowId: string, gameId: string) {
  rowGame.set(rowId, gameId);
  rowLearnedAt.set(rowId, ++changeSeq);
}

function forgetRow(rowId: string) {
  rowGame.delete(rowId);
  rowLearnedAt.delete(rowId);
}

function markGameChanged(gameId: string) {
  gameChangedAt.set(gameId, ++changeSeq);
}
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

/**
 * Whether the viewer's places have been read from the database since this page (or this account) started: until then
 * `joined` is only what this browser saved, which can be stale either way. 'error' when that first read failed; a
 * later refresh that fails keeps the last answer. The pay page waits for 'ready' before it tells a player that only a
 * place would let them pay that they cannot (src/lib/pay-entry-gate.ts).
 */
export type RosterLoadState = "loading" | "ready" | "error";
let rosterLoad: RosterLoadState = "loading";

function setRosterLoad(next: RosterLoadState) {
  if (rosterLoad === next) return;
  rosterLoad = next;
  emit();
}

/** A failed read of the roster: an error only if it had never loaded. */
function rosterLoadFailed() {
  if (rosterLoad !== "ready") setRosterLoad("error");
}

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
  // Anything learned or changed after this point is newer than the answer, which
  // may have been read before it happened (a join on this device, a realtime
  // INSERT or DELETE): keep it rather than let the older answer undo it.
  const startedAt = changeSeq;
  const newerThanQuery = (seq: number | undefined) => seq !== undefined && seq > startedAt;
  const { data, error } = await supabase
    .from("game_participants")
    .select("id, game_id")
    .eq("user_id", userId);
  if (error) {
    if (userId === currentUserId) rosterLoadFailed();
    return;
  }
  // An answer for an account that is no longer the signed-in one (signed out, or switched while the read was out).
  if (userId !== currentUserId) return;
  lastHydratedAt = Date.now();
  const rows = data ?? [];
  const rowIds = new Set(rows.map((r) => r.id));
  Array.from(rowGame.keys()).forEach((rowId) => {
    if (!rowIds.has(rowId) && !newerThanQuery(rowLearnedAt.get(rowId))) forgetRow(rowId);
  });
  rows.forEach((r) => {
    if (r.id && !rowGame.has(r.id)) learnRow(r.id, r.game_id);
  });
  // The database is the truth. A game the host removed us from, or that we left
  // on another device, while this one was offline would otherwise read "joined"
  // for good: the saved list only ever grew. Joins still being written stay, and
  // so does any game whose state changed here while the query was out.
  const onRoster = new Set(rows.map((r) => r.game_id));
  const settled = (id: string) => !inFlight.has(id) && !newerThanQuery(gameChangedAt.get(id));
  Array.from(joined).forEach((id) => {
    if (!onRoster.has(id) && settled(id)) joined.delete(id);
  });
  onRoster.forEach((id) => {
    if (settled(id)) joined.add(id);
  });
  saveJoinedGames();
  rosterLoad = "ready";
  emit();
}

function ensureHydrated() {
  if (hydrated || typeof window === "undefined" || hydratingPromise) return;
  hydratingPromise = (async () => {
    const { data, error } = await supabase.auth.getUser();
    currentUserId = data.user?.id ?? null;
    if (!currentUserId) {
      // No signed-in account: no places. Unless asking who is signed in failed, which says nothing about the roster.
      if (error) rosterLoadFailed();
      else setRosterLoad("ready");
    }
    if (currentUserId) {
      // Subscribe as soon as we know who is signed in. Waiting for an auth event
      // is not enough: a page that mounts after the session was restored only
      // gets INITIAL_SESSION, so the channel was never opened there.
      attachRealtime(currentUserId);
      await hydrateFromDb(currentUserId);
    }
    hydrated = true;
  })().catch(() => {
    hydratingPromise = null;
    rosterLoadFailed();
  });
}

/** Read the viewer's places again after a failed first read (the pay page's Retry). */
export function retryRosterLoad() {
  if (typeof window === "undefined") return;
  if (rosterLoad === "error") setRosterLoad("loading");
  if (currentUserId) {
    void hydrateFromDb(currentUserId);
    return;
  }
  // Asking who is signed in failed (or nobody is): ask again.
  hydrated = false;
  hydratingPromise = null;
  ensureHydrated();
}

type RosterChange = {
  eventType: string;
  new?: { id?: string; game_id?: string; user_id?: string } | null;
  old?: { id?: string; game_id?: string; user_id?: string } | null;
};

/**
 * Apply one `game_participants` change from the viewer's filtered channel. An
 * INSERT carries the whole row. A DELETE carries only `{ id }` (row-level
 * security strips `old` to the primary key), so it is resolved through
 * `rowGame`; a row it does not know is ignored rather than guessed at.
 */
function applyRosterChange(payload: RosterChange) {
  if (payload.eventType === "INSERT") {
    const row = payload.new;
    if (!row?.game_id) return;
    if (currentUserId && row.user_id && row.user_id !== currentUserId) return;
    if (row.id) learnRow(row.id, row.game_id);
    joined.add(row.game_id);
    markGameChanged(row.game_id);
  } else if (payload.eventType === "DELETE") {
    const old = payload.old ?? {};
    if (currentUserId && old.user_id && old.user_id !== currentUserId) return;
    const gameId = old.game_id ?? (old.id ? rowGame.get(old.id) : undefined);
    if (!gameId) return;
    if (old.id) forgetRow(old.id);
    joined.delete(gameId);
    markGameChanged(gameId);
  } else {
    return;
  }
  saveJoinedGames();
  emit();
}

let channel: ReturnType<typeof supabase.channel> | null = null;
let channelUserId: string | null = null;

/** Open (or move) the viewer's roster channel. A no-op when it is already open for them. */
function attachRealtime(userId: string) {
  if (!realtimeAttached || (channel && channelUserId === userId)) return;
  if (channel) supabase.removeChannel(channel);
  channelUserId = userId;
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
      (payload) => applyRosterChange(payload),
    )
    .subscribe();
}

function ensureRealtime() {
  if (realtimeAttached || typeof window === "undefined") return;
  realtimeAttached = true;

  if (currentUserId) attachRealtime(currentUserId);

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
    if (event === "INITIAL_SESSION") {
      // The session this page started with; ensureHydrated loads its roster.
      if (session?.user?.id) attachRealtime(session.user.id);
    } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
      const uid = session?.user?.id ?? null;
      if (!uid) return;
      if (uid !== currentUserId) {
        currentUserId = uid;
        hydrated = false;
        hydratingPromise = null;
        setRosterLoad("loading");
        ensureHydrated();
      }
      attachRealtime(uid);
    } else if (event === "SIGNED_OUT") {
      currentUserId = null;
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
        channelUserId = null;
      }
      joined.clear();
      rowGame.clear();
      rowLearnedAt.clear();
      gameChangedAt.clear();
      saveJoinedGames();
      rosterLoad = "loading";
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
    // Ask for the new row's id: a leave on another device reaches this one as a
    // DELETE that names only that id, and the INSERT echo that would otherwise
    // teach it to the store can be missed (the channel may still be joining).
    const { data: row, error } = await supabase
      .from("game_participants")
      .insert(insert)
      .select("id")
      .single();
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
    if (row?.id) learnRow(row.id, id);
    markGameChanged(id);
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
  markGameChanged(id);
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

/** Whether the viewer's places (useIsJoined) have been read from the database yet. See RosterLoadState. */
export function useRosterLoadState(): RosterLoadState {
  return useSyncExternalStore(
    subscribe,
    () => {
      getSnapshot();
      return rosterLoad;
    },
    () => "loading",
  );
}

export function useJoinedGameIds(): string[] {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_SNAPSHOT);
  return useMemo(() => JSON.parse(snapshot), [snapshot]);
}
