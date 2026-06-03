import { useEffect, useState, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import { ME, type Sport } from "@/lib/sample-data";
import { useAuth } from "@/hooks/use-auth";

// ---------- Profile overrides ----------
export type ProfileOverrides = {
  name?: string;
  username?: string;
  avatar?: string; // initials
  bio?: string;
  city?: string;
  sports?: { name: Sport; skill: number }[];
  badges?: string[];
};

export type MyProfile = {
  name: string;
  username: string;
  avatar: string;
  bio: string;
  city: string;
  stats: typeof ME.stats;
  sports: { name: Sport; skill: number }[];
  badges: string[];
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

export type FeedPrefs = {
  preferredSports: Sport[];
  sections: FeedSectionToggles;
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
  function getSnapshot() { load(); return snap; }
  function subscribe(cb: () => void) { listeners.add(cb); return () => listeners.delete(cb); }
  function set(next: T) {
    cache = next;
    snap = JSON.stringify(next);
    if (typeof window !== "undefined") window.localStorage.setItem(key, snap);
    listeners.forEach((l) => l());
  }
  function get(): T { load(); return cache; }
  return { getSnapshot, subscribe, set, get };
}

const prefsStore = makeStore<FeedPrefs>(PREFS_KEY, DEFAULT_PREFS);

// ---------- Per-user profile overrides ----------
function profileKey(userId: string) { return PROFILE_KEY_PREFIX + userId; }

function readOverrides(userId: string | null): ProfileOverrides {
  if (!userId || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(profileKey(userId));
    return raw ? (JSON.parse(raw) as ProfileOverrides) : {};
  } catch {
    return {};
  }
}

const overrideListeners = new Set<() => void>();
function notifyOverrides() { overrideListeners.forEach((l) => l()); }

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
    (meta.full_name as string) ||
    (meta.name as string) ||
    (user.email ? user.email.split("@")[0] : "Player");
  const username = user.email ? "@" + user.email.split("@")[0] : "@" + (user.id.slice(0, 6));
  return {
    name,
    username,
    avatar: initialsFrom(name),
    bio: "",
    city: "",
    stats: { played: 0, reliability: 100, sportsmanship: 5, friends: 0 },
    sports: [],
    badges: [],
  };
}

// ---------- Hooks ----------
export function useMyProfile(): MyProfile | null {
  const { user } = useAuth();
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const cb = () => setTick((t) => t + 1);
    overrideListeners.add(cb);
    return () => { overrideListeners.delete(cb); };
  }, []);
  if (!user) return null;
  const overrides = readOverrides(user.id);
  const base = defaultsFromUser(user);
  // touch tick so re-renders happen when overrides change
  void tick;
  return {
    name: overrides.name ?? base.name,
    username: overrides.username ?? base.username,
    avatar: overrides.avatar ?? base.avatar,
    bio: overrides.bio ?? base.bio,
    city: overrides.city ?? base.city,
    stats: base.stats,
    sports: overrides.sports ?? base.sports,
    badges: overrides.badges ?? base.badges,
  };
}

export function useFeedPrefs(): FeedPrefs {
  const s = useSyncExternalStore(
    prefsStore.subscribe,
    prefsStore.getSnapshot,
    () => JSON.stringify(DEFAULT_PREFS),
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
  return {
    preferredSports: parsed.preferredSports ?? [],
    sections,
  };
}

export function setFeedPrefs(next: FeedPrefs) {
  prefsStore.set(next);
}
