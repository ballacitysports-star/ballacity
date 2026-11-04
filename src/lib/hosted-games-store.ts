import { useSyncExternalStore } from "react";
import type { Game, Sport } from "@/lib/sample-data";
import { normalizeCutoff } from "@/lib/cancel-window";
import { imageFor, ME, resolveSportAsset, toStoredCover } from "@/lib/sample-data";
import { supabase } from "@/integrations/supabase/client";
import type { TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import {
  coarsenGame,
  redactForStorage,
  withExactLocation,
  type ExactLocation,
  type ExactLocationStatus,
} from "@/lib/youth-game-location";
import { GAMES_READ } from "@/lib/organizer-access";

// v3 holds only what is safe to keep on a device: a youth-inclusive game is stored in its coarse form, never its
// exact venue or coordinates, and games come from hosted_games_public, so a minor host's account id (and cover path)
// is only stored for a viewer entitled to it (SEC-5). v1 held exact coordinates and v2 held every host id read
// straight from the table; both are deleted on first load.
const STORAGE_KEY = "openrun.hostedGames.v3";
const LEGACY_STORAGE_KEYS = ["openrun.hostedGames.v1", "openrun.hostedGames.v2"];
const listeners = new Set<() => void>();
let cache: Game[] = [];
let loaded = false;
let dbHydrated = false;
let dbHydratePromise: Promise<void> | null = null;

/** Where the first load from the database stands, so a screen can say so. */
export type HostedGamesLoad = "loading" | "ready" | "error";
let loadStatus: HostedGamesLoad = "loading";
// After a failure the next attempt waits: every read of the store would otherwise
// start another fetch, and reporting the failure re-reads the store.
const RETRY_BACKOFF_MS = 15_000;
let retryNotBefore = 0;
function setLoadStatus(next: HostedGamesLoad) {
  if (loadStatus === next) return;
  loadStatus = next;
  listeners.forEach((l) => l());
}
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
    for (const key of LEGACY_STORAGE_KEYS) window.localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    // Re-coarsen on the way in as well: a stored copy is never trusted to be coarse.
    if (Array.isArray(arr)) cache = arr.map((g) => redactForStorage(g as Game));
  } catch {
    cache = [];
  }
  recomputeSnapshot();
}

function saveLocal() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache.map(redactForStorage)));
  } catch {
    /* ignore quota errors */
  }
}

// ---------- Exact locations of youth-inclusive games (in memory only) ----------
//
// The database releases the exact venue of a youth-inclusive game only to people entitled to it (host, roster,
// their verified guardians, managers). Whatever it returns is overlaid here for this signed-in viewer, kept in
// memory only, never written to storage, and dropped on sign-out, account switch or a guardian profile switch.
const exactLocations = new Map<string, ExactLocation>();
let exactStatus: ExactLocationStatus = "idle";
let exactPromise: Promise<void> | null = null;
const exactListeners = new Set<() => void>();

function setExactStatus(next: ExactLocationStatus) {
  if (exactStatus === next) return;
  exactStatus = next;
  exactListeners.forEach((l) => l());
}

type PrivateRow = {
  game_id: string;
  location: string | null;
  lat: number | string | null;
  lng: number | string | null;
};

function toExact(r: PrivateRow): ExactLocation {
  return {
    location: r.location ?? null,
    lat: r.lat == null ? null : Number(r.lat),
    lng: r.lng == null ? null : Number(r.lng),
  };
}

function reapplyExact() {
  cache = cache.map((g) => withExactLocation(coarsenGame(g), exactLocations.get(g.id)));
  emit();
}

async function hydrateExact(): Promise<void> {
  if (typeof window === "undefined") return;
  if (exactPromise) return exactPromise;
  setExactStatus("loading");
  exactPromise = (async () => {
    try {
      const { data: sess } = await supabase.auth.getSession();
      exactLocations.clear();
      if (!sess.session) {
        setExactStatus("ready"); // signed out: nothing is released, coarse is the answer
        reapplyExact();
        return;
      }
      const { data, error } = await supabase
        .from("hosted_game_private" as never)
        .select("game_id, location, lat, lng")
        .limit(2000);
      if (error) throw error;
      for (const r of (data ?? []) as unknown as PrivateRow[])
        exactLocations.set(r.game_id, toExact(r));
      setExactStatus("ready");
      reapplyExact();
    } catch {
      setExactStatus("error");
    } finally {
      exactPromise = null;
    }
  })();
  return exactPromise;
}

/** Re-read one game's exact location (after the game changed, or a roster change may have removed access). */
export async function refreshExactLocation(gameId: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess.session) {
      exactLocations.delete(gameId);
    } else {
      const { data, error } = await supabase
        .from("hosted_game_private" as never)
        .select("game_id, location, lat, lng")
        .eq("game_id", gameId)
        .maybeSingle();
      if (error) throw error;
      if (data) exactLocations.set(gameId, toExact(data as unknown as PrivateRow));
      else exactLocations.delete(gameId);
    }
    reapplyExact();
  } catch {
    /* keep what we have; the next full hydrate reports an error */
  }
}

/** Retry button for the "couldn't check your access" state. */
export function retryExactLocations() {
  exactPromise = null;
  void hydrateExact();
}

/** Forget everything that belongs to the signed-in viewer (sign-out, account or profile switch). */
export function resetHostedGamesClientState() {
  exactLocations.clear();
  exactPromise = null;
  exactStatus = "idle";
  cache = [];
  loaded = false;
  dbHydrated = false;
  dbHydratePromise = null;
  recomputeSnapshot();
  listeners.forEach((l) => l());
  exactListeners.forEach((l) => l());
}

export function useExactLocationStatus(): ExactLocationStatus {
  return useSyncExternalStore(
    (cb) => {
      exactListeners.add(cb);
      return () => exactListeners.delete(cb);
    },
    () => exactStatus,
    () => "idle",
  );
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

/** A row of hosted_games_public (SEC-5): host_id is null when this viewer may not know the organizer. */
export type DbRow = {
  id: string;
  host_id: string | null;
  organizer_ref?: string | null;
  viewer_is_host?: boolean | null;
  hidden_at?: string | null;

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
  cancelled_at?: string | null;
  cancellation_reason?: string | null;
  completed_at?: string | null;
  joins_closed: boolean;
  signup_cutoff_min?: number | null;
  cancel_cutoff_min?: number | null;
  min_age?: number | null;
  max_age?: number | null;
  host_snapshot: {
    name?: string;
    username?: string;
    avatar?: string;
    rating?: number;
    neutral?: boolean;
  } | null;
  positions_needed?: Record<string, number> | null;
  team_id?: string | null;
  org_id?: string | null;
  org_official?: boolean | null;
  series_id?: string | null;
  min_players?: number | null;
  allow_waitlist?: boolean | null;
  cancellation_policy?: string | null;
  cancellation_notes?: string | null;
  game_rules?: string | null;
};

/**
 * Games are publicly readable, so only intentionally public host fields may be
 * denormalized onto the row. Never contact details or private profile fields.
 */
function publicHostSnapshot(host: unknown) {
  const h = (host ?? {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const snap: { name?: string; username?: string; avatar?: string; rating?: number } = {};
  if (str(h.name)) snap.name = str(h.name);
  if (str(h.username)) snap.username = str(h.username);
  if (str(h.avatar)) snap.avatar = str(h.avatar);
  if (typeof h.rating === "number" && Number.isFinite(h.rating)) snap.rating = h.rating;
  return snap;
}

export function rowToGameRaw(r: DbRow): Game {
  const snap = r.host_snapshot ?? {};
  // A host who is not a confirmed adult is shown only as the organizer the database recorded: no username,
  // photo, rating or profile link, and no invented defaults that look like an identity.
  const neutral = snap.neutral === true;
  const organizer = (snap.name ?? "").trim() || "Youth host";
  return {
    id: r.id,
    sport: r.sport as Sport,
    title: r.title,
    host: neutral
      ? { name: organizer, username: "", avatar: organizer.slice(0, 1).toUpperCase(), rating: 0 }
      : {
          name: snap.name ?? "Host",
          username: snap.username ?? "@host",
          avatar: snap.avatar ?? "H",
          rating: snap.rating ?? 5,
        },
    hostNeutral: neutral || undefined,
    hostUserId: r.host_id ?? undefined,
    viewerIsHost: r.viewer_is_host === true,
    organizerRef: r.organizer_ref ?? undefined,
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
    hidden: !!r.hidden_at,
    urgent: r.urgent ?? undefined,
    trending: r.trending ?? undefined,
    image: resolveSportAsset(r.image) || imageFor(r.sport as Sport),
    description: r.description,
    equipment: r.equipment ?? [],
    status: (r.status as Game["status"]) ?? undefined,
    cancelledAt: r.cancelled_at ?? null,
    cancellationReason: r.cancellation_reason ?? null,
    completedAt: r.completed_at ?? null,
    joinsClosed: !!r.joins_closed,
    signupCutoffMin: Number(r.signup_cutoff_min ?? 0) || 0,
    cancelCutoffMin: normalizeCutoff(r.cancel_cutoff_min),
    minAge: r.min_age ?? null,
    maxAge: r.max_age ?? null,
    positionsNeeded: (r.positions_needed ?? {}) as Record<string, number>,
    teamId: r.team_id ?? undefined,
    orgId: r.org_id ?? undefined,
    orgOfficial: r.org_id ? !!r.org_official : undefined,
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

/** A game as this viewer may see it: coarse for a youth-inclusive game unless the database released the exact venue. */
function rowToGame(r: DbRow): Game {
  return withExactLocation(coarsenGame(rowToGameRaw(r)), exactLocations.get(r.id));
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
    image:
      g.image && resolveSportAsset(g.image) !== imageFor(g.sport) ? toStoredCover(g.image) : "",
    description: g.description ?? "",
    equipment: g.equipment ?? [],
    status: g.status ?? null,
    joins_closed: !!(g as { joinsClosed?: boolean }).joinsClosed,
    signup_cutoff_min: Number((g as { signupCutoffMin?: number }).signupCutoffMin ?? 0) || 0,
    min_age: (g as { minAge?: number | null }).minAge ?? null,
    max_age: (g as { maxAge?: number | null }).maxAge ?? null,
    host_snapshot: publicHostSnapshot(g.host) as TablesInsert<"hosted_games">["host_snapshot"],
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
    cancel_cutoff_min: normalizeCutoff(g.cancelCutoffMin),
    game_rules: g.gameRules ?? null,
  } as TablesInsert<"hosted_games">;
}

// ---------- DB hydration + realtime ----------

async function fetchAll(): Promise<void> {
  const { data, error } = await supabase
    .from(GAMES_READ)
    .select("*")
    // Moderator-hidden games must never surface in the feed or on the map.
    .is("hidden_at", null)
    .order("date", { ascending: true });
  if (error) throw error;
  const games = (data as DbRow[] | null)?.map(rowToGame) ?? [];
  // Preserve any unclaimed local-only games (no hostUserId, not in DB) as pending.
  const dbIds = new Set(games.map((g) => g.id));
  const pending = cache.filter((g) => !dbIds.has(g.id) && !g.hostUserId);
  cache = [...games, ...pending];
  emit();
  // Ask the database which exact locations this viewer is entitled to (a failure leaves the coarse form).
  void hydrateExact();
}

function ensureDbHydrated() {
  if (dbHydrated || typeof window === "undefined") return;
  if (dbHydratePromise) return;
  if (Date.now() < retryNotBefore) return;
  dbHydratePromise = fetchAll()
    .then(() => {
      dbHydrated = true;
      setLoadStatus("ready");
    })
    .catch(() => {
      // Keep the local cache, say the load failed, and try again after a pause.
      dbHydratePromise = null;
      retryNotBefore = Date.now() + RETRY_BACKOFF_MS;
      setLoadStatus("error");
    });
}

/** Try the first load again now (a Retry button). */
export function retryHostedGames() {
  if (dbHydrated) return;
  retryNotBefore = 0;
  dbHydratePromise = null;
  setLoadStatus("loading");
  ensureDbHydrated();
}

// Realtime reads the table, not the view: until phase 2 its payload still carries host_id and the cover path, and
// after phase 2 it carries neither. So a change is only a signal: the changed rows are read again through
// hosted_games_public (batched), and nothing from the payload except the id and hidden_at is used.
const pendingRealtimeIds = new Set<string>();
let realtimeFlush: ReturnType<typeof setTimeout> | null = null;
const REALTIME_BATCH_MS = 250;

async function refetchChangedGames(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { data, error } = await supabase.from(GAMES_READ).select("*").in("id", ids);
  if (error) return;
  const rows = (data as DbRow[] | null) ?? [];
  const seen = new Set(rows.map((r) => r.id));
  let next = cache.filter((g) => !ids.includes(g.id) || seen.has(g.id));
  for (const r of rows) {
    if (r.hidden_at) {
      next = next.filter((g) => g.id !== r.id);
      continue;
    }
    const g = rowToGame(r);
    const idx = next.findIndex((x) => x.id === g.id);
    next = idx >= 0 ? next.map((x) => (x.id === g.id ? g : x)) : [g, ...next];
  }
  cache = next;
  emit();
  // The venue, the roster or the age range may have changed what this viewer may see: re-check it.
  for (const r of rows) void refreshExactLocation(r.id);
}

function queueRealtimeRefetch(id: string) {
  pendingRealtimeIds.add(id);
  if (realtimeFlush) return;
  realtimeFlush = setTimeout(() => {
    realtimeFlush = null;
    const ids = [...pendingRealtimeIds];
    pendingRealtimeIds.clear();
    void refetchChangedGames(ids);
  }, REALTIME_BATCH_MS);
}

/** What the store does with one realtime event (exported for tests). */
export function realtimeAction(payload: {
  eventType: string;
  new?: { id?: string; hidden_at?: string | null } | null;
  old?: { id?: string } | null;
}): { kind: "remove"; id: string } | { kind: "refetch"; id: string } | null {
  if (payload.eventType === "DELETE")
    return payload.old?.id ? { kind: "remove", id: payload.old.id } : null;
  const id = payload.new?.id;
  if (!id) return null;
  // Just hidden by a moderator: drop it from the live cache without a read.
  if (payload.new?.hidden_at) return { kind: "remove", id };
  return { kind: "refetch", id };
}

function ensureRealtime() {
  if (realtimeAttached || typeof window === "undefined") return;
  realtimeAttached = true;
  const channel = supabase
    .channel("hosted_games:all")
    .on("postgres_changes", { event: "*", schema: "public", table: "hosted_games" }, (payload) => {
      const action = realtimeAction(payload as unknown as Parameters<typeof realtimeAction>[0]);
      if (!action) return;
      if (action.kind === "remove") {
        cache = cache.filter((g) => g.id !== action.id);
        emit();
        return;
      }
      queueRealtimeRefetch(action.id);
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
    if (event === "SIGNED_OUT") {
      // Nothing the previous viewer was entitled to may linger for the next one.
      exactLocations.clear();
      exactPromise = null;
      setExactStatus("idle");
    }
    if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
      if (event === "SIGNED_IN") {
        exactLocations.clear();
        exactPromise = null;
      }
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
  /** Minutes before start that cancelling counts as late / the refund rule changes. */
  cancelCutoffMin?: number;
  gameRules?: string | null;
  /** A 16-17 year old's hosting approval (from a guardian or an organization administrator). */
  hostingApprovalId?: string | null;
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
    cancelCutoffMin: normalizeCutoff(input.cancelCutoffMin),
    gameRules: input.gameRules ?? null,
  };

  // The host always knows their own venue: keep it for this session (in memory only).
  exactLocations.set(id, { location: game.location, lat: game.lat ?? null, lng: game.lng ?? null });

  // Optimistic local insert.
  cache = [withExactLocation(coarsenGame(game), exactLocations.get(id)), ...cache];
  emit();

  // Persist to DB when signed in.
  if (input.hostUserId) {
    try {
      const row = gameToInsertRow(game) as Record<string, unknown>;
      if (input.hostingApprovalId) row.hosting_approval_id = input.hostingApprovalId;
      const { error } = await supabase
        .from("hosted_games")
        .insert(row as TablesInsert<"hosted_games">);
      if (error) throw error;
    } catch (err) {
      // Roll back local insert on failure so UI reflects reality.
      exactLocations.delete(id);
      cache = cache.filter((g) => g.id !== id);
      emit();
      throw err;
    }
  }

  return game;
}

/**
 * Public, non-cancelled games tied to a facility (`hosted_games.org_id`).
 * A direct query rather than the global store so the facility page does not
 * depend on the whole feed having hydrated.
 */
export async function fetchHostedGamesForOrg(orgId: string): Promise<Game[]> {
  const { data, error } = await supabase
    .from(GAMES_READ)
    .select("*")
    .eq("org_id", orgId)
    .eq("is_private", false)
    .is("hidden_at", null)
    .is("org_hidden_at", null)
    .is("cancelled_at", null)
    .order("date", { ascending: true })
    .limit(100);
  if (error) throw error;
  return ((data as DbRow[] | null) ?? []).map(rowToGame);
}

/**
 * Facility owners/admins hide (or restore) a game from their facility page.
 * The RPC re-checks admin rights; the game itself stays live for its host.
 */
export async function hideGameFromOrg(gameId: string, hidden: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_game_hidden_from_org", {
    _game: gameId,
    _hidden: hidden,
  });
  if (error) throw error;
}

/**
 * Hidden games the signed-in person may still see: their own as host, and ones
 * they joined or asked to join when only the host hid them. The feed leaves
 * hidden games out, so this is how the profile keeps listing them. The database
 * decides which rows come back; nothing is filtered by owner here.
 */
export async function fetchMyHiddenGames(): Promise<Game[]> {
  const { data, error } = await supabase
    .from(GAMES_READ)
    .select("*")
    .not("hidden_at", "is", null)
    .order("date", { ascending: true })
    .limit(200);
  if (error) throw error;
  return ((data as DbRow[] | null) ?? []).map(rowToGame);
}

export function getHostedGame(id: string): Game | undefined {
  loadLocal();
  return cache.find((g) => g.id === id);
}

export async function fetchHostedGame(id: string): Promise<Game | null> {
  loadLocal();
  const local = cache.find((g) => g.id === id);
  if (local) return local;

  const { data, error } = await supabase
    .from(GAMES_READ)
    .select("*")
    .eq("id", id)
    // No `hidden_at` filter: the database already hides a hidden game from
    // everyone but its host (and, when only the host hid it, its players).
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const game = rowToGame(data as DbRow);
  const exists = cache.some((g) => g.id === game.id);
  cache = exists ? cache.map((g) => (g.id === game.id ? game : g)) : [game, ...cache];
  emit();
  await refreshExactLocation(game.id);
  return cache.find((g) => g.id === game.id) ?? game;
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
  if (patch.location !== undefined || patch.lat !== undefined || patch.lng !== undefined) {
    // Only the host can edit a venue, and the host is entitled to it: keep the new exact value in memory.
    const next = updated as Game;
    exactLocations.set(id, {
      location: next.location,
      lat: next.lat ?? null,
      lng: next.lng ?? null,
    });
    updated = withExactLocation(coarsenGame(next), exactLocations.get(id));
    cache = cache.map((g) => (g.id === id ? (updated as Game) : g));
  }
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
    dbPatch.image =
      patch.image && resolveSportAsset(patch.image) !== imageFor(updated.sport)
        ? toStoredCover(patch.image)
        : "";
  }
  if (patch.equipment !== undefined) dbPatch.equipment = patch.equipment;
  if (patch.status !== undefined) dbPatch.status = patch.status;
  if ((patch as { joinsClosed?: boolean }).joinsClosed !== undefined) {
    dbPatch.joins_closed = (patch as { joinsClosed?: boolean }).joinsClosed;
  }
  if ((patch as { signupCutoffMin?: number }).signupCutoffMin !== undefined) {
    dbPatch.signup_cutoff_min =
      Number((patch as { signupCutoffMin?: number }).signupCutoffMin) || 0;
  }
  if ((patch as { cancelCutoffMin?: number }).cancelCutoffMin !== undefined) {
    (dbPatch as Record<string, unknown>).cancel_cutoff_min = normalizeCutoff(
      (patch as { cancelCutoffMin?: number }).cancelCutoffMin,
    );
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
    dbPatch.positions_needed =
      patch.positionsNeeded as TablesUpdate<"hosted_games">["positions_needed"];
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

export type GameLocationField = "location" | "lat" | "lng";

/** What a game reads after its location was removed: the same text a new game without a location gets. */
export const REMOVED_GAME_LOCATION = "TBD";

/**
 * Remove a hosted game's location on purpose (host only; `clear_hosted_game_location`). An edit that sends an empty location is not
 * a removal: for a youth-inclusive game it cannot be told apart from an older client sending back a blank value, so the database keeps
 * the exact copy unless asked (SEC-7).
 */
export async function clearHostedGameLocation(
  id: string,
  fields: GameLocationField[] = ["location", "lat", "lng"],
): Promise<void> {
  const { error } = await (supabase.rpc as any)("clear_hosted_game_location", {
    _game: id,
    _fields: fields,
  });
  if (error) throw error;
  loadLocal();
  cache = cache.map((g) =>
    g.id !== id
      ? g
      : {
          ...g,
          ...(fields.includes("location") ? { location: REMOVED_GAME_LOCATION } : {}),
          ...(fields.includes("lat") ? { lat: null } : {}),
          ...(fields.includes("lng") ? { lng: null } : {}),
        },
  );
  exactLocations.delete(id);
  emit();
  await refreshExactLocation(id);
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

  // Save to the DB so it survives storage wipes. A plain insert: an upsert would name host_id in its ON CONFLICT update,
  // which needs SELECT on host_id (closed to clients in SEC-5 phase 2). A row that already exists is left as it is.
  supabase
    .from("hosted_games")
    .insert(gameToInsertRow(updated))
    .then(() => {
      /* noop */
    });
}

export function useHostedGamesStatus(): HostedGamesLoad {
  return useSyncExternalStore(
    subscribe,
    () => loadStatus,
    () => "loading",
  );
}

export function useHostedGames(): Game[] {
  const snap = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY);
  return snap === EMPTY ? [] : (JSON.parse(snap) as Game[]);
}
