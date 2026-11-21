import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  DEFAULT_NOTIF_PREFS,
  applyLocks,
  isAllowedIn,
  isLockedChannel,
  mergeNotifPrefs,
  type NotifCategory,
  type NotifChannel,
  type NotifPrefs,
} from "@/lib/notification-prefs-core";

/**
 * Notification preferences — one canonical set of categories for the whole app.
 *
 * The rules (categories, defaults, locked channels, how stored prefs merge) live in
 * `notification-prefs-core.ts`, which the server uses too, and are re-exported here. This
 * file is the app's side: labels, the local copy, syncing with the backend, and the hooks.
 */
export * from "@/lib/notification-prefs-core";

export const CATEGORY_META: Record<
  NotifCategory,
  { label: string; description: string; lockedNote?: string }
> = {
  gameReminders: {
    label: "Game reminders",
    description: "Heads-up before a game you joined or host starts, so you don't miss it.",
  },
  gameUpdates: {
    label: "Game updates",
    description:
      "Changes to games you're part of (approvals, declines, join requests, time or venue changes, cancellations) and announcements from your teams.",
  },
  nearbyGames: {
    label: "New nearby games",
    description: "When a new game is posted near you in a sport you play.",
  },
  messages: {
    label: "Messages",
    description: "New direct messages from players, hosts, trainers, and gyms.",
  },
  invitations: {
    label: "Invitations",
    description: "Invites to games, teams, gyms, and training sessions.",
  },
  payments: {
    label: "Payment updates",
    description:
      "When a host confirms or rejects your payment, or a player submits payment for your game.",
  },
  safety: {
    label: "Safety & security",
    description:
      "Reports and blocks about your account, moderation decisions, and sign-in or security notices.",
    lockedNote:
      "In-app safety and security alerts always stay on so you never miss a moderation or account-security notice. You can still turn off push for them.",
  },
  social: {
    label: "Followers & highlights",
    description:
      "New followers, and comments or reactions on your posts, games and highlight reels.",
  },
  general: {
    label: "Other activity",
    description: "Account activity such as data exports and highlight processing results.",
  },
  marketing: {
    label: "Marketing & product news",
    description:
      "Occasional tips, feature announcements, and offers. Off unless you turn it on — never mixed with game, message, or safety alerts.",
  },
};

const KEY = "openrun.notifPrefs.v3";
const LEGACY_KEY = "openrun.notifPrefs.v2";

function readLocal(): NotifPrefs {
  if (typeof window === "undefined") return DEFAULT_NOTIF_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY) ?? window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return DEFAULT_NOTIF_PREFS;
    return mergeNotifPrefs(JSON.parse(raw) as Record<string, unknown>);
  } catch {
    return DEFAULT_NOTIF_PREFS;
  }
}

const listeners = new Set<() => void>();
let snap = JSON.stringify(readLocal());
let hydratedFor: string | null = null;

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
function getSnapshot() {
  return snap;
}

function commit(next: NotifPrefs) {
  snap = JSON.stringify(applyLocks(next));
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(KEY, snap);
    } catch {
      /* ignore */
    }
  }
  listeners.forEach((l) => l());
}

export function getNotifPrefs(): NotifPrefs {
  return JSON.parse(snap) as NotifPrefs;
}

export function setNotifPref(category: NotifCategory, channel: NotifChannel, value: boolean) {
  if (isLockedChannel(category, channel) && !value) return;
  const current = getNotifPrefs();
  const next: NotifPrefs = { ...current, [category]: { ...current[category], [channel]: value } };
  commit(next);
  void persistToBackend(getNotifPrefs());
}

async function persistToBackend(prefs: NotifPrefs) {
  try {
    const { data } = await supabase.auth.getUser();
    const uid = data.user?.id;
    if (!uid) return;
    await supabase
      .from("notification_preferences" as never)
      .upsert({ user_id: uid, prefs } as never, { onConflict: "user_id" });
  } catch (e) {
    console.warn("notif prefs persist failed", e);
  }
}

export async function hydrateNotifPrefsFromBackend(userId: string) {
  if (hydratedFor === userId) return;
  hydratedFor = userId;
  try {
    const { data, error } = await supabase
      .from("notification_preferences" as never)
      .select("prefs")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) {
      hydratedFor = null;
      return;
    }
    const prefs = (data as { prefs?: Record<string, unknown> } | null)?.prefs;
    if (prefs) {
      commit(mergeNotifPrefs(prefs));
    } else {
      // No row yet — seed with current local prefs so devices stay in sync going forward.
      await persistToBackend(getNotifPrefs());
    }
  } catch {
    hydratedFor = null;
  }
}

export function resetNotifPrefsHydration() {
  hydratedFor = null;
}

export function useNotifPrefs(): NotifPrefs {
  const s = useSyncExternalStore(subscribe, getSnapshot, () => JSON.stringify(DEFAULT_NOTIF_PREFS));
  return JSON.parse(s) as NotifPrefs;
}

/** Hook to hydrate prefs from the DB when a user is signed in. Mount on the Alerts tab. */
export function useHydrateNotifPrefs(userId: string | undefined | null) {
  useEffect(() => {
    if (!userId) {
      resetNotifPrefsHydration();
      return;
    }
    void hydrateNotifPrefsFromBackend(userId);
  }, [userId]);
}

export function isAllowed(type: string, channel: NotifChannel): boolean {
  return isAllowedIn(getNotifPrefs(), type, channel);
}
