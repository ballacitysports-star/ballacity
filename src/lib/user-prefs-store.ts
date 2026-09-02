import { useEffect, useState, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import { ME, type Sport } from "@/lib/sample-data";
import { earnedBadgeIds, makeBadgeStats } from "@/lib/badges";
import { getDetectedDistanceUnit, type DistanceUnit } from "@/lib/measurement-system";
import { clampDistanceMi } from "@/lib/distance";

import { parseSportLevels, type SportLevel } from "@/lib/sport-levels";
import {
  reliabilityPercent,
  toBadgeStats,
  usePlayerActivityStats,
  EMPTY_PLAYER_STATS,
} from "@/lib/player-stats";


/** Engine-earned badges first, stored override extras appended (deduped). */
function mergeBadges(earned: string[], overrides?: string[]): string[] {
  return Array.from(new Set([...earned, ...(overrides ?? [])]));
}

import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

// ---------- Profile overrides ----------
export type ProfileLinkType =
  | "perfect_game"
  | "pbr"
  | "hudl"
  | "instagram"
  | "twitter"
  | "tiktok"
  | "youtube"
  | "website";

export type ProfileLink = {
  type: ProfileLinkType;
  url: string;
  label?: string;
};

export type ProfileOverrides = {
  name?: string;
  username?: string;
  avatar?: string; // initials
  avatarUrl?: string; // data URL or remote URL
  coverUrl?: string; // hero/cover image data URL or remote URL
  bio?: string;
  city?: string;
  birthday?: string; // ISO date (YYYY-MM-DD)
  graduatingClass?: number;
  /** Saved search radius in miles (location preference). */
  searchRadiusMi?: number;
  sports?: { name: Sport; positions?: string[]; level?: SportLevel | null }[];
  badges?: string[];
  links?: ProfileLink[];
};

export type MyProfile = {
  name: string;
  username: string;
  avatar: string;
  avatarUrl?: string;
  coverUrl?: string;
  bio: string;
  city: string;
  birthday?: string;
  graduatingClass?: number;
  /** Saved search radius in miles (location preference). */
  searchRadiusMi?: number;
  stats: typeof ME.stats;
  sports: { name: Sport; positions?: string[]; level?: SportLevel | null }[];
  badges: string[];
  links: ProfileLink[];
};

const PROFILE_KEY_PREFIX = "openrun.profile.v2.";
const PREFS_KEY = "openrun.feedPrefs.v1";

// ---------- Feed prefs ----------
/** Display-only toggles: which sections the feed renders. */
export type FeedSectionToggles = {
  showUrgent: boolean;
  showForYou: boolean;
};

export type FeedSortBy = "nearest" | "soonest";

export type DistanceUnitPref = "auto" | DistanceUnit;

/** Mutually exclusive price filter — replaces the old freeOnly/paidOnly pair. */
export type FeedMoneyFilter = "all" | "free" | "paid";
/** Mutually exclusive ownership filter — replaces hostedByMeOnly/joinedOnly. */
export type FeedMineFilter = "all" | "hosting" | "joined";

/** Everything that narrows or orders results — the part a saved view stores. */
export type FeedFilterSnapshot = {
  preferredSports: Sport[];
  maxDistanceMi: number | null;
  distanceUnit: DistanceUnitPref;
  sortBy: FeedSortBy;
  moneyFilter: FeedMoneyFilter;
  mineFilter: FeedMineFilter;
};

export type FeedView = {
  id: string;
  name: string;
  filters: FeedFilterSnapshot;
  createdAt: string;
};

export type FeedPrefs = FeedFilterSnapshot & {
  sections: FeedSectionToggles;
  savedViews: FeedView[];
  activeViewId: string | null;
};

export const DEFAULT_FILTERS: FeedFilterSnapshot = {
  preferredSports: [],
  maxDistanceMi: null,
  distanceUnit: "auto",
  sortBy: "nearest",
  moneyFilter: "all",
  mineFilter: "all",
};

export const DEFAULT_PREFS: FeedPrefs = {
  ...DEFAULT_FILTERS,
  sections: {
    showUrgent: true,
    showForYou: true,
  },
  savedViews: [],
  activeViewId: null,
};

/**
 * Normalizes any stored/remote prefs blob into the current shape, mapping the
 * legacy `sections.freeOnly / paidOnly / hostedByMeOnly / joinedOnly` booleans
 * forward so existing users keep their setup.
 */
export function normalizeFeedPrefs(raw: unknown): FeedPrefs {
  const parsed = (raw ?? {}) as Record<string, any>;
  const legacy = (parsed.sections ?? {}) as Record<string, any>;

  const sections: FeedSectionToggles = {
    showUrgent: legacy.showUrgent !== false,
    showForYou: legacy.showForYou !== false,
  };
  if (!sections.showForYou && !sections.showUrgent) sections.showForYou = true;

  let moneyFilter: FeedMoneyFilter =
    parsed.moneyFilter === "free" || parsed.moneyFilter === "paid" ? parsed.moneyFilter : "all";
  if (!parsed.moneyFilter) {
    if (legacy.freeOnly && !legacy.paidOnly) moneyFilter = "free";
    else if (legacy.paidOnly && !legacy.freeOnly) moneyFilter = "paid";
  }

  let mineFilter: FeedMineFilter =
    parsed.mineFilter === "hosting" || parsed.mineFilter === "joined" ? parsed.mineFilter : "all";
  if (!parsed.mineFilter) {
    if (legacy.hostedByMeOnly && !legacy.joinedOnly) mineFilter = "hosting";
    else if (legacy.joinedOnly && !legacy.hostedByMeOnly) mineFilter = "joined";
  }

  const savedViews: FeedView[] = Array.isArray(parsed.savedViews)
    ? parsed.savedViews
        .filter((v: any) => v && typeof v.id === "string" && typeof v.name === "string")
        .map((v: any) => ({
          id: v.id,
          name: String(v.name).slice(0, 40),
          filters: { ...DEFAULT_FILTERS, ...(v.filters ?? {}) },
          createdAt: typeof v.createdAt === "string" ? v.createdAt : new Date().toISOString(),
        }))
    : [];

  return {
    preferredSports: Array.isArray(parsed.preferredSports) ? parsed.preferredSports : [],
    maxDistanceMi:
      typeof parsed.maxDistanceMi === "number" && parsed.maxDistanceMi > 0
        ? clampDistanceMi(parsed.maxDistanceMi)
        : null,
    distanceUnit:
      parsed.distanceUnit === "km" ? "km" : parsed.distanceUnit === "mi" ? "mi" : "auto",
    sortBy: parsed.sortBy === "soonest" ? "soonest" : "nearest",
    moneyFilter,
    mineFilter,
    sections,
    savedViews,
    activeViewId: typeof parsed.activeViewId === "string" ? parsed.activeViewId : null,
  };
}

// ---------- Generic JSON store ----------
function makeStore<T>(key: string, fallback: T) {
  const listeners = new Set<() => void>();
  let cache: T = fallback;
  let loaded = false;
  let snap = JSON.stringify(fallback);

  function load() {
    if (loaded || typeof window === "undefined") return;
    loaded = true;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        cache = { ...fallback, ...(JSON.parse(raw) as T) };
        snap = JSON.stringify(cache);
      }
    } catch {
      cache = fallback;
    }
  }
  function getSnapshot() {
    load();
    return snap;
  }
  function subscribe(cb: () => void) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  }
  function set(next: T) {
    cache = next;
    snap = JSON.stringify(next);
    if (typeof window !== "undefined") window.localStorage.setItem(key, snap);
    listeners.forEach((l) => l());
  }
  function get(): T {
    load();
    return cache;
  }
  return { getSnapshot, subscribe, set, get };
}

const prefsStore = makeStore<FeedPrefs>(PREFS_KEY, DEFAULT_PREFS);

// ---------- Per-user profile overrides ----------
function profileKey(userId: string) {
  return PROFILE_KEY_PREFIX + userId;
}

export function readOverrides(userId: string | null): ProfileOverrides {
  if (!userId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(profileKey(userId));
    return raw ? (JSON.parse(raw) as ProfileOverrides) : {};
  } catch {
    return {};
  }
}

export function useProfileOverrides(userId: string | null | undefined): ProfileOverrides {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const cb = () => setTick((t) => t + 1);
    overrideListeners.add(cb);
    return () => {
      overrideListeners.delete(cb);
    };
  }, []);
  void tick;
  return readOverrides(userId ?? null);
}

const overrideListeners = new Set<() => void>();
function notifyOverrides() {
  overrideListeners.forEach((l) => l());
}

export function setProfileOverrides(userId: string, next: ProfileOverrides) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(profileKey(userId), JSON.stringify(next));
  notifyOverrides();
}

// ---------- Defaults derived from auth user ----------
function initialsFrom(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function defaultsFromUser(user: User): MyProfile {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const name =
    (meta.display_name as string) ||
    (meta.full_name as string) ||
    (meta.name as string) ||
    (user.email ? user.email.split("@")[0] : "Player");

  const username = user.email ? "@" + user.email.split("@")[0] : "@" + user.id.slice(0, 6);
  return {
    name,
    username,
    avatar: initialsFrom(name),
    bio: "",
    city: "",
    stats: { played: 0, reliability: 100, sportsmanship: 5, friends: 0, hosted: 0, endorsements: 0 },
    sports: [],
    badges: [],
    links: [],
  };
}

// ---------- Hooks ----------

/**
 * Profile + whether the saved `profiles` row has finished loading.
 *
 * Forms must wait for `loaded` before seeding their fields: until then the
 * returned profile can be a fallback derived from the auth user (email
 * local-part as name, no sports), which would overwrite real saved data.
 */
export function useMyProfileState(currentUser?: User | null): {
  profile: MyProfile | null;
  loaded: boolean;
} {
  const { user: authUser } = useAuth();
  const user = currentUser === undefined ? authUser : currentUser;
  // Reputation numbers come from the database aggregate, never sample data.
  const activityQuery = usePlayerActivityStats(user?.id);
  const [tick, setTick] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [dbProfile, setDbProfile] = useState<{

    display_name?: string | null;
    username?: string | null;
    avatar_initials?: string | null;
    bio?: string | null;
    city?: string | null;
    avatar_url?: string | null;
    cover_url?: string | null;
    birthday?: string | null;
    graduating_class?: number | null;
    search_radius_mi?: number | null;
    links?: unknown;
    sport?: string | null;
    sport_levels?: unknown;
  } | null>(null);

  useEffect(() => {
    const cb = () => setTick((t) => t + 1);
    overrideListeners.add(cb);
    return () => {
      overrideListeners.delete(cb);
    };
  }, []);
  useEffect(() => {
    if (!user) {
      setDbProfile(null);
      setLoaded(false);
      return;
    }
    let cancelled = false;
    setLoaded(false);
    supabase
      .from("profiles")
      .select(
        "display_name, username, avatar_initials, bio, city, avatar_url, cover_url, graduating_class, search_radius_mi, links, sport, sport_levels",
      )

      .eq("id", user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (cancelled) return;
        const { data: bday } = await (supabase.rpc as any)("get_my_birthday");
        if (cancelled) return;
        setDbProfile({ ...(data as any), birthday: (bday as string | null) ?? null });
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  if (!user) return { profile: null, loaded: false };

  const overrides = readOverrides(user.id);
  const base = defaultsFromUser(user);
  void tick;
  const dbLinks: ProfileLink[] = Array.isArray(dbProfile?.links)
    ? (dbProfile!.links as ProfileLink[])
    : [];
  // Per-sport levels live in `profiles.sport_levels`, so they follow the user across devices.
  const dbLevels = parseSportLevels(dbProfile?.sport_levels);
  const localSports = overrides.sports;
  const sports = localSports
    ? localSports.map((s) => ({ ...s, level: s.level ?? dbLevels[s.name] ?? null }))
    : Object.keys(dbLevels).length
      ? (Object.keys(dbLevels) as Sport[]).map((name) => ({ name, level: dbLevels[name] }))
      : dbProfile?.sport
        ? [{ name: dbProfile.sport as Sport, level: dbLevels[dbProfile.sport] ?? null }]
        : base.sports;

  const profile: MyProfile = {
    name: overrides.name ?? dbProfile?.display_name ?? base.name,
    username:
      overrides.username ??
      (dbProfile?.username ? `@${dbProfile.username.replace(/^@/, "")}` : base.username),
    avatar: overrides.avatar ?? dbProfile?.avatar_initials ?? base.avatar,
    avatarUrl: overrides.avatarUrl ?? dbProfile?.avatar_url ?? undefined,
    coverUrl: overrides.coverUrl ?? dbProfile?.cover_url ?? undefined,
    bio: overrides.bio ?? dbProfile?.bio ?? base.bio,
    city: overrides.city ?? dbProfile?.city ?? base.city,
    birthday: overrides.birthday ?? dbProfile?.birthday ?? undefined,
    graduatingClass: overrides.graduatingClass ?? dbProfile?.graduating_class ?? undefined,
    searchRadiusMi:
      clampDistanceMi(overrides.searchRadiusMi ?? dbProfile?.search_radius_mi ?? undefined) ??
      undefined,
    stats: base.stats,
    // Per-sport levels resolved above (local overrides first, then the saved row).
    sports,
    // Earned badges come from the badge engine (reliability + sportsmanship);
    // stored overrides are merged on top as extras.
    badges: mergeBadges(
      earnedBadgeIds(
        makeBadgeStats({
          gamesPlayed: base.stats.played,
          hosted: base.stats.hosted ?? 0,
          showUpRate: (base.stats.reliability ?? 0) / 100,
          onTimeRate: (base.stats.reliability ?? 0) / 100,
          sportsmanshipRating: base.stats.sportsmanship ?? 0,
        }),
      ),
      overrides.badges,
    ),

    links: overrides.links?.length ? overrides.links : dbLinks,
  };
  return { profile, loaded };
}

export function useMyProfile(currentUser?: User | null): MyProfile | null {
  return useMyProfileState(currentUser).profile;
}


export function useFeedPrefs(): FeedPrefs {
  const s = useSyncExternalStore(prefsStore.subscribe, prefsStore.getSnapshot, () =>
    JSON.stringify(DEFAULT_PREFS),
  );
  return normalizeFeedPrefs(JSON.parse(s));
}

/** Resolve an "auto" preference into a concrete unit using device locale. */
export function resolveDistanceUnit(pref: DistanceUnitPref): DistanceUnit {
  if (pref === "mi" || pref === "km") return pref;
  return getDetectedDistanceUnit();
}

/**
 * The unit the UI should render with. Returns the stored override when the
 * user pinned one; otherwise the region-detected unit (after hydration).
 */
export function useDistanceUnit(): DistanceUnit {
  const { distanceUnit } = useFeedPrefs();
  const [detected, setDetected] = useState<DistanceUnit>("mi");
  useEffect(() => {
    setDetected(getDetectedDistanceUnit());
  }, []);
  if (distanceUnit === "mi" || distanceUnit === "km") return distanceUnit;
  return detected;
}

export function setFeedPrefs(next: FeedPrefs) {
  prefsStore.set(next);
}

export function getFeedPrefsSnapshot(): FeedPrefs {
  try {
    return JSON.parse(prefsStore.getSnapshot()) as FeedPrefs;
  } catch {
    return DEFAULT_PREFS;
  }
}
