import { useSyncExternalStore } from "react";
import { ME, type Sport } from "@/lib/sample-data";

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

const PROFILE_KEY = "openrun.profile.v1";
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
  preferredSports: Sport[]; // empty = all
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

const profileStore = makeStore<ProfileOverrides>(PROFILE_KEY, {});
const prefsStore = makeStore<FeedPrefs>(PREFS_KEY, DEFAULT_PREFS);

export function useProfileOverrides(): ProfileOverrides {
  const s = useSyncExternalStore(profileStore.subscribe, profileStore.getSnapshot, () => "{}");
  return JSON.parse(s) as ProfileOverrides;
}

export function setProfileOverrides(next: ProfileOverrides) {
  profileStore.set(next);
}

export function useMyProfile(): MyProfile {
  const o = useProfileOverrides();
  return {
    name: o.name ?? ME.name,
    username: o.username ?? ME.username,
    avatar: o.avatar ?? ME.avatar,
    bio: o.bio ?? ME.bio,
    city: o.city ?? ME.city,
    stats: ME.stats,
    sports: o.sports ?? ME.sports,
    badges: o.badges ?? ME.badges,
  };
}

export function useFeedPrefs(): FeedPrefs {
  const s = useSyncExternalStore(
    prefsStore.subscribe,
    prefsStore.getSnapshot,
    () => JSON.stringify(DEFAULT_PREFS),
  );
  const parsed = JSON.parse(s) as FeedPrefs;
  return {
    preferredSports: parsed.preferredSports ?? [],
    sections: { ...DEFAULT_PREFS.sections, ...(parsed.sections ?? {}) },
  };
}

export function setFeedPrefs(next: FeedPrefs) {
  prefsStore.set(next);
}
