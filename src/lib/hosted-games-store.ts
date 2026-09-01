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
  ends_at?: string | null;
  all_day?: boolean | null;
  timezone?: string | null;
  location: string;
  neighborhood: string;
  distance_mi: number | string | null;
  lat: number | string | null;
  lng: number | string | null;
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
  signup_cutoff_min?: number | null;
  min_age?: number | null;
  max_age?: number | null;
  host_snapshot: { name?: string; username?: string; avatar?: string; rating?: number } | null;
  positions_needed?: Record<string, number> | null;
  team_id?: string | null;
  org_id?: string | null;
  series_id?: string | null;
  min_players?: number | null;
  allow_waitlist?: boolean | null;
  cancellation_policy?: string | null;
  cancellation_notes?: string | null;
  game_rules?: string | null;

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
    distanceMi: r.distance_mi == null ? null : Number(r.distance_mi),
    lat: r.lat == null ? null : Number(r.lat),
    lng: r.lng == null ? null : Number(r.lng),
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
    signupCutoffMin: Number(r.signup_cutoff_min ?? 0) || 0,
    minAge: r.min_age ?? null,
    maxAge: r.max_age ?? null,
    positionsNeeded: (r.positions_needed ?? {}) as Record<string, number>,
    teamId: r.team_id ?? undefined,
    orgId: r.org_id ?? undefined,
    seriesId: r.series_id ?? null,
    endsAt: r.ends_at ?? null,
    allDay: !!r.all_day,
    timezone: r.timezone ?? null,
    minPlayers: Number(r.min_players ?? 0) || 0,
    allowWaitlist: r.allow_waitlist ?? true,
    cancellationPolicy: r.cancellation_policy ?? "flexible",
    cancellationNotes: r.cancellation_notes ?? null,
    gameRules: r.game_rules ?? null,

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
    distance_mi: g.distanceMi ?? null,
    lat: g.lat ?? null,
    lng: g.lng ?? null,
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
    signup_cutoff_min: Number((g as { signupCutoffMin?: number }).signupCutoffMin ?? 0) || 0,
    min_age: (g as { minAge?: number | null }).minAge ?? null,
    max_age: (g as { maxAge?: number | null }).maxAge ?? null,
    host_snapshot: (g.host ?? {}) as TablesInsert<"hosted_games">["host_snapshot"],
    positions_needed: (g.positionsNeeded ?? {}) as TablesInsert<"hosted_games">["positions_needed"],
    ...(g.teamId ? { team_id: g.teamId } : {}),
    ...(g.orgId ? { org_id: g.orgId } : {}),
    ...(g.seriesId ? { series_id: g.seriesId } : {}),
    ...(g.endsAt ? { ends_at: g.endsAt } : {}),
    all_day: !!g.allDay,
    ...(g.timezone ? { timezone: g.timezone } : {}),
    min_players: Number(g.minPlayers ?? 0) || 0,
    allow_waitlist: g.allowWaitlist ?? true,
    cancellation_policy: g.cancellationPolicy || "flexible",
    cancellation_notes: g.cancellationNotes ?? null,
    game_rules: g.gameRules ?? null,
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
  duration?: string; // e.g. "90 min"
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
  orgId?: string;
  signupCutoffMin?: number;
  minAge?: number | null;
  maxAge?: number | null;
  /** Shared id linking sessions of one multi-day event so the feed shows one card. */
  seriesId?: string | null;
  /** Exact end instant; the source of truth for length and "finished" checks. */
  endsAt?: string | null;
  allDay?: boolean;
  /** IANA zone the host set the wall-clock times in. */
  timezone?: string | null;
  /** Real venue coordinates from the address autocomplete / geocoder. */
  lat?: number | null;
  lng?: number | null;
  /** Game policy: minimum turnout, waitlist, cancellation terms, house rules. */
  minPlayers?: number;
  allowWaitlist?: boolean;
  cancellationPolicy?: string | null;
  cancellationNotes?: string | null;
  gameRules?: string | null;

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
    duration: input.duration?.trim() || "90 min",
    location: input.location || "TBD",
    neighborhood: "",
    distanceMi: null,
    lat: input.lat ?? null,
    lng: input.lng ?? null,
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
    teamId: input.teamId,
    orgId: input.orgId,
    signupCutoffMin: input.signupCutoffMin ?? 0,
    minAge: input.minAge ?? null,
    maxAge: input.maxAge ?? null,
    seriesId: input.seriesId ?? null,
    endsAt: input.endsAt ?? null,
    allDay: !!input.allDay,
    timezone: input.timezone ?? null,
    minPlayers: Math.max(0, Number(input.minPlayers ?? 0) || 0),
    allowWaitlist: input.allowWaitlist ?? true,
    cancellationPolicy: input.cancellationPolicy || "flexible",
    cancellationNotes: input.cancellationNotes ?? null,
    gameRules: input.gameRules ?? null,
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
  // Venue coordinates: real geo from the autocomplete/geocoder, or null when
  // the host cleared/changed the address to something we couldn't resolve.
  if (patch.lat !== undefined) dbPatch.lat = patch.lat ?? null;
  if (patch.lng !== undefined) dbPatch.lng = patch.lng ?? null;
  if (patch.date !== undefined) dbPatch.date = patch.date;
  if (patch.duration !== undefined) dbPatch.duration = patch.duration;
  if ((patch as { endsAt?: string | null }).endsAt !== undefined) {
    (dbPatch as TablesUpdate<"hosted_games"> & { ends_at?: string | null }).ends_at =
      (patch as { endsAt?: string | null }).endsAt ?? null;
  }
  if ((patch as { allDay?: boolean }).allDay !== undefined) {
    (dbPatch as TablesUpdate<"hosted_games"> & { all_day?: boolean }).all_day = !!(
      patch as { allDay?: boolean }
    ).allDay;
  }
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
  if ((patch as { signupCutoffMin?: number }).signupCutoffMin !== undefined) {
    dbPatch.signup_cutoff_min = Number((patch as { signupCutoffMin?: number }).signupCutoffMin) || 0;
  }
  if ((patch as { minAge?: number | null }).minAge !== undefined) {
    dbPatch.min_age = (patch as { minAge?: number | null }).minAge ?? null;
  }
  if ((patch as { maxAge?: number | null }).maxAge !== undefined) {
    dbPatch.max_age = (patch as { maxAge?: number | null }).maxAge ?? null;
  }
  if ((patch as { minPlayers?: number }).minPlayers !== undefined) {
    dbPatch.min_players = Math.max(0, Number((patch as { minPlayers?: number }).minPlayers) || 0);
  }
  if ((patch as { allowWaitlist?: boolean }).allowWaitlist !== undefined) {
    dbPatch.allow_waitlist = !!(patch as { allowWaitlist?: boolean }).allowWaitlist;
  }
  if ((patch as { cancellationPolicy?: string | null }).cancellationPolicy !== undefined) {
    dbPatch.cancellation_policy =
      (patch as { cancellationPolicy?: string | null }).cancellationPolicy || "flexible";
  }
  if ((patch as { cancellationNotes?: string | null }).cancellationNotes !== undefined) {
    dbPatch.cancellation_notes =
      (patch as { cancellationNotes?: string | null }).cancellationNotes ?? null;
  }
  if ((patch as { gameRules?: string | null }).gameRules !== undefined) {
    dbPatch.game_rules = (patch as { gameRules?: string | null }).gameRules ?? null;
  }
  if (patch.positionsNeeded !== undefined) {
    dbPatch.positions_needed = patch.positionsNeeded as TablesUpdate<"hosted_games">["positions_needed"];
  }
  if ((patch as { teamId?: string | null }).teamId !== undefined) {
    const v = (patch as { teamId?: string | null }).teamId;
    (dbPatch as TablesUpdate<"hosted_games"> & { team_id?: string | null }).team_id = v ?? null;
  }
  if ((patch as { orgId?: string | null }).orgId !== undefined) {
    const v = (patch as { orgId?: string | null }).orgId;
    (dbPatch as TablesUpdate<"hosted_games"> & { org_id?: string | null }).org_id = v ?? null;
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
