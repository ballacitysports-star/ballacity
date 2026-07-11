import { useEffect, useState, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import { ME, type Sport } from "@/lib/sample-data";
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
  sports?: { name: Sport; skill: number; positions?: string[] }[];
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
  stats: typeof ME.stats;
  sports: { name: Sport; skill: number }[];
  badges: string[];
  links: ProfileLink[];
};

const PROFILE_KEY_PREFIX = "openrun.profile.v2.";
const PREFS_KEY = "openrun.feedPrefs.v1";

// ---------- Feed prefs ----------
export type FeedSectionToggles = {
  showUrgent: boolean;
  showForYou: boolean;
  hostedByMeOnly: boolean;
  joinedOnly: boolean;
  paidOnly: boolean;
  freeOnly: boolean;
};

export type FeedSortBy = "nearest" | "soonest";

export type FeedPrefs = {
  preferredSports: Sport[];
  sections: FeedSectionToggles;
  maxDistanceMi: number | null;
  distanceUnit: "mi" | "km";
  sortBy: FeedSortBy;
};

export const DEFAULT_PREFS: FeedPrefs = {
  preferredSports: [],
  sections: {
    showUrgent: true,
    showForYou: true,
    hostedByMeOnly: false,
    joinedOnly: false,
    paidOnly: false,
    freeOnly: false,
  },
  maxDistanceMi: null,
  distanceUnit: "mi",
  sortBy: "nearest",
};

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
    stats: { played: 0, reliability: 100, sportsmanship: 5, friends: 0 },
    sports: [],
    badges: [],
    links: [],
  };
}

// ---------- Hooks ----------
export function useMyProfile(currentUser?: User | null): MyProfile | null {
  const { user: authUser } = useAuth();
  const user = currentUser === undefined ? authUser : currentUser;
  const [tick, setTick] = useState(0);
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
    links?: unknown;
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
      return;
    }
    let cancelled = false;
    supabase
      .from("profiles")
      .select(
        "display_name, username, avatar_initials, bio, city, avatar_url, cover_url, birthday, graduating_class, links",
      )
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setDbProfile(data as any);
      });
    return () => {
      cancelled = true;
    };
  }, [user?.id]);
  if (!user) return null;
  const overrides = readOverrides(user.id);
  const base = defaultsFromUser(user);
  void tick;
  const dbLinks: ProfileLink[] = Array.isArray(dbProfile?.links)
    ? (dbProfile!.links as ProfileLink[])
    : [];
  return {
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
    stats: base.stats,
    sports: overrides.sports ?? base.sports,
    badges: overrides.badges ?? base.badges,
    links: overrides.links?.length ? overrides.links : dbLinks,
  };
}

export function useFeedPrefs(): FeedPrefs {
  const s = useSyncExternalStore(prefsStore.subscribe, prefsStore.getSnapshot, () =>
    JSON.stringify(DEFAULT_PREFS),
  );
  const parsed = JSON.parse(s) as FeedPrefs;
  const sections = { ...DEFAULT_PREFS.sections, ...(parsed.sections ?? {}) };
  // Sanitize impossible filter combinations that would yield an empty feed forever
  if (sections.paidOnly && sections.freeOnly) {
    sections.paidOnly = false;
    sections.freeOnly = false;
  }
  if (sections.hostedByMeOnly && sections.joinedOnly) {
    sections.hostedByMeOnly = false;
    sections.joinedOnly = false;
  }
  if (!sections.showForYou && !sections.showUrgent) {
    sections.showForYou = true;
  }
  const maxDistanceMi =
    typeof parsed.maxDistanceMi === "number" && parsed.maxDistanceMi > 0
      ? parsed.maxDistanceMi
      : null;
  const distanceUnit = parsed.distanceUnit === "km" ? "km" : "mi";
  const sortBy: FeedSortBy = parsed.sortBy === "soonest" ? "soonest" : "nearest";
  return {
    preferredSports: parsed.preferredSports ?? [],
    sections,
    maxDistanceMi,
    distanceUnit,
    sortBy,
  };
}

export function setFeedPrefs(next: FeedPrefs) {
  prefsStore.set(next);
}
