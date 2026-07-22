import { useSyncExternalStore } from "react";
import type { Game, Sport } from "@/lib/sample-data";
import { imageFor, ME } from "@/lib/sample-data";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

const STORAGE_KEY = "openrun.hostedGames.v1";
const listeners = new Set<() => void>();
let cache: Game[] = [];
let loaded = false;
let dbHydrated = false;
let dbHydratePromise: Promise<void> | null = null;
let realtimeAttached = false;
const EMPTY = "[]";
let snapshotCache = EMPTY;

function recomputeSnapshot() {
  snapshotCache = cache.length === 0 ? EMPTY : JSON.stringify(cache);
}

function loadLocal() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    if (Array.isArray(arr)) cache = arr;
  } catch {
    cache = [];
  }
  recomputeSnapshot();
}

function saveLocal() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
  } catch {
    /* ignore quota errors */
  }
}

function emit() {
  recomputeSnapshot();
  saveLocal();
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function getSnapshot() {
  loadLocal();
  ensureDbHydrated();
  ensureRealtime();
  return snapshotCache;
}

// ---------- DB row <-> Game mapping ----------

type DbRow = {
  id: string;
  host_id: string;
  sport: string;
  title: string;
  date: string;
  duration: string;
  location: string;
  neighborhood: string;
  distance_mi: number | string;
  lat: number | string;
  lng: number | string;
  max_players: number;
  joined: number;
  skill: string;
  price: number | string;
  indoor: boolean;
  is_private: boolean;
  urgent: boolean | null;
  trending: boolean | null;
  image: string;
  description: string;
  equipment: string[] | null;
  status: string | null;
  joins_closed: boolean;
  host_snapshot: { name?: string; username?: string; avatar?: string; rating?: number } | null;
  positions_needed?: Record<string, number> | null;
  team_id?: string | null;

};


function rowToGame(r: DbRow): Game {
  const snap = r.host_snapshot ?? {};
  return {
    id: r.id,
    sport: r.sport as Sport,
    title: r.title,
    host: {
      name: snap.name ?? "Host",
      username: snap.username ?? "@host",
      avatar: snap.avatar ?? "H",
      rating: snap.rating ?? 5,
    },
    hostUserId: r.host_id,
    date: r.date,
    duration: r.duration,
    location: r.location,
    neighborhood: r.neighborhood,
    distanceMi: Number(r.distance_mi) || 0,
    lat: Number(r.lat) || 50,
    lng: Number(r.lng) || 50,
    maxPlayers: r.max_players,
    joined: r.joined,
    skill: r.skill as Game["skill"],
    price: Number(r.price) || 0,
    indoor: !!r.indoor,
    isPrivate: !!r.is_private,
    urgent: r.urgent ?? undefined,
    trending: r.trending ?? undefined,
    image: r.image || imageFor(r.sport as Sport),
    description: r.description,
    equipment: r.equipment ?? [],
    status: (r.status as Game["status"]) ?? undefined,
    joinsClosed: !!r.joins_closed,
    positionsNeeded: (r.positions_needed ?? {}) as Record<string, number>,
    teamId: r.team_id ?? undefined,

  } as Game;
}

function gameToInsertRow(g: Game): TablesInsert<"hosted_games"> {
  return {
    id: g.id,
    host_id: g.hostUserId as string,
    sport: g.sport,
    title: g.title,
    date: g.date,
    duration: g.duration,
    location: g.location,
    neighborhood: g.neighborhood ?? "",
    distance_mi: g.distanceMi ?? 0,
    lat: g.lat ?? 50,
    lng: g.lng ?? 50,
    max_players: g.maxPlayers,
    joined: g.joined ?? 0,
    skill: g.skill,
    price: g.price ?? 0,
    indoor: !!g.indoor,
    is_private: !!g.isPrivate,
    urgent: !!g.urgent,
    trending: !!g.trending,
    image: g.image && g.image !== imageFor(g.sport) ? g.image : "",
    description: g.description ?? "",
    equipment: g.equipment ?? [],
    status: g.status ?? null,
    joins_closed: !!(g as { joinsClosed?: boolean }).joinsClosed,
    host_snapshot: (g.host ?? {}) as TablesInsert<"hosted_games">["host_snapshot"],
    positions_needed: (g.positionsNeeded ?? {}) as TablesInsert<"hosted_games">["positions_needed"],
    ...(g.teamId ? { team_id: g.teamId } : {}),
  } as TablesInsert<"hosted_games">;

}

// ---------- DB hydration + realtime ----------

async function fetchAll(): Promise<void> {
  const { data, error } = await supabase
    .from("hosted_games")
    .select("*")
    .order("date", { ascending: true });
  if (error) throw error;
  const games = (data as DbRow[] | null)?.map(rowToGame) ?? [];
  // Preserve any unclaimed local-only games (no hostUserId, not in DB) as pending.
  const dbIds = new Set(games.map((g) => g.id));
  const pending = cache.filter((g) => !dbIds.has(g.id) && !g.hostUserId);
  cache = [...games, ...pending];
  emit();
}

function ensureDbHydrated() {
  if (dbHydrated || typeof window === "undefined") return;
  if (dbHydratePromise) return;
  dbHydratePromise = fetchAll()
    .then(() => {
      dbHydrated = true;
    })
    .catch(() => {
      // Silent — keep local cache; next call retries.
      dbHydratePromise = null;
    });
}

function ensureRealtime() {
  if (realtimeAttached || typeof window === "undefined") return;
  realtimeAttached = true;
  const channel = supabase
    .channel("hosted_games:all")
    .on("postgres_changes", { event: "*", schema: "public", table: "hosted_games" }, (payload) => {
      const newRow = payload.new as DbRow | null;
      const oldRow = payload.old as DbRow | null;
      if (payload.eventType === "DELETE" && oldRow) {
        cache = cache.filter((g) => g.id !== oldRow.id);
        emit();
        return;
      }
      if (newRow) {
        const g = rowToGame(newRow);
        const idx = cache.findIndex((x) => x.id === g.id);
        if (idx >= 0) cache = cache.map((x) => (x.id === g.id ? g : x));
        else cache = [g, ...cache];
        emit();
      }
    })
    .subscribe();

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    });
  }
}

// Re-hydrate when auth state changes so newly signed-in users pull DB rows.
if (typeof window !== "undefined") {
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
      dbHydrated = false;
      dbHydratePromise = null;
      ensureDbHydrated();
    }
  });
}

// ---------- Public API ----------

export type HostedGameInput = {
  sport: Sport;
  title: string;
  date: string; // ISO
  location: string;
  skill: Game["skill"];
  maxPlayers: number;
  price: number;
  indoor: boolean;
  isPrivate: boolean;
  description: string;
  host?: { name: string; username: string; avatar: string; rating?: number };
  hostUserId?: string;
  image?: string; // optional custom cover URL
  positionsNeeded?: Record<string, number>;
  teamId?: string;

};

export async function addHostedGame(input: HostedGameInput): Promise<Game> {
  loadLocal();
  const id = `host-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const host = input.host
    ? {
        name: input.host.name,
        username: input.host.username,
        avatar: input.host.avatar,
        rating: input.host.rating ?? 5,
      }
    : { name: ME.name, username: ME.username, avatar: ME.avatar, rating: ME.stats.sportsmanship };
  const game: Game = {
    id,
    sport: input.sport,
    title: input.title || `${input.sport} pickup`,
    host,
    hostUserId: input.hostUserId,
    date: input.date,
    duration: "90 min",
    location: input.location || "TBD",
    neighborhood: "",
    distanceMi: 0,
    lat: 50,
    lng: 50,
    maxPlayers: input.maxPlayers,
    joined: 0,
    skill: input.skill,
    price: input.price,
    indoor: input.indoor,
    isPrivate: input.isPrivate,
    image: input.image?.trim() || imageFor(input.sport),
    description: input.description || "",
    equipment: [],
    positionsNeeded: input.positionsNeeded ?? {},
  };


  // Optimistic local insert.
  cache = [game, ...cache];
  emit();

  // Persist to DB when signed in.
  if (input.hostUserId) {
    try {
      const { error } = await supabase.from("hosted_games").insert(gameToInsertRow(game));
      if (error) throw error;
    } catch (err) {
      // Roll back local insert on failure so UI reflects reality.
      cache = cache.filter((g) => g.id !== id);
      emit();
      throw err;
    }
  }

  return game;
}

export function getHostedGame(id: string): Game | undefined {
  loadLocal();
  return cache.find((g) => g.id === id);
}

export async function fetchHostedGame(id: string): Promise<Game | null> {
  loadLocal();
  const local = cache.find((g) => g.id === id);
  if (local) return local;

  const { data, error } = await supabase.from("hosted_games").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const game = rowToGame(data as DbRow);
  const exists = cache.some((g) => g.id === game.id);
  cache = exists ? cache.map((g) => (g.id === game.id ? game : g)) : [game, ...cache];
  emit();
  return game;
}

/** Patch a hosted game locally, and mirror the change to the DB. */
export async function updateHostedGame(
  id: string,
  patch: Partial<Game>,
): Promise<Game | undefined> {
  loadLocal();
  let updated: Game | undefined;
  cache = cache.map((g) => {
    if (g.id !== id) return g;
    updated = { ...g, ...patch };
    return updated;
  });
  if (!updated) return undefined;
  emit();

  // Best-effort DB mirror; RLS restricts to the host.
  const dbPatch: TablesUpdate<"hosted_games"> = {};
  if (patch.title !== undefined) dbPatch.title = patch.title;
  if (patch.location !== undefined) dbPatch.location = patch.location;
  if (patch.neighborhood !== undefined) dbPatch.neighborhood = patch.neighborhood;
  if (patch.date !== undefined) dbPatch.date = patch.date;
  if (patch.duration !== undefined) dbPatch.duration = patch.duration;
  if (patch.maxPlayers !== undefined) dbPatch.max_players = patch.maxPlayers;
  if (patch.price !== undefined) dbPatch.price = patch.price;
  if (patch.description !== undefined) dbPatch.description = patch.description;
  if (patch.sport !== undefined) dbPatch.sport = patch.sport;
  if (patch.skill !== undefined) dbPatch.skill = patch.skill;
  if (patch.indoor !== undefined) dbPatch.indoor = patch.indoor;
  if (patch.isPrivate !== undefined) dbPatch.is_private = patch.isPrivate;
  if (patch.image !== undefined) {
    dbPatch.image = patch.image && patch.image !== imageFor(updated.sport) ? patch.image : "";
  }
  if (patch.equipment !== undefined) dbPatch.equipment = patch.equipment;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if ((patch as { joinsClosed?: boolean }).joinsClosed !== undefined) {
    dbPatch.joins_closed = (patch as { joinsClosed?: boolean }).joinsClosed;
  }
  if (patch.positionsNeeded !== undefined) {
    dbPatch.positions_needed = patch.positionsNeeded as TablesUpdate<"hosted_games">["positions_needed"];
  }
  if (Object.keys(dbPatch).length > 0) {
    const { error } = await supabase.from("hosted_games").update(dbPatch).eq("id", id);
    if (error) throw error;
  }
  return updated;
}


/** Delete a hosted game locally and in the DB. */
export async function deleteHostedGame(id: string): Promise<void> {
  loadLocal();
  const prev = cache;
  cache = cache.filter((g) => g.id !== id);
  emit();
  try {
    const { error } = await supabase.from("hosted_games").delete().eq("id", id);
    if (error) throw error;
  } catch (err) {
    cache = prev;
    emit();
    throw err;
  }
}

/** List locally-hosted games that have no hostUserId yet. */
export function listUnclaimedHostedGames(): Game[] {
  loadLocal();
  return cache.filter((g) => !g.hostUserId);
}

/** Stamp a single locally-hosted game with the given user id, and push to DB. */
export function claimHostedGame(gameId: string, userId: string): void {
  loadLocal();
  if (!userId) return;
  const target = cache.find((g) => g.id === gameId);
  if (!target || target.hostUserId) return;
  const updated: Game = { ...target, hostUserId: userId };
  cache = cache.map((g) => (g.id === gameId ? updated : g));
  emit();

  // Upsert into DB so it survives storage wipes.
  supabase
    .from("hosted_games")
    .upsert(gameToInsertRow(updated), { onConflict: "id" })
    .then(() => {
      /* noop */
    });
}

export function useHostedGames(): Game[] {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return snap === EMPTY ? [] : (JSON.parse(snap) as Game[]);
}
