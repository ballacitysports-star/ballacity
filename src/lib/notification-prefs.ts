import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Notification preferences — one canonical set of categories for the whole app.
 *
 * Rules that must not drift:
 * - Every toggle is phrased positively ("Game reminders" on = you get them). No
 *   double negatives, no "opt out of not receiving".
 * - Marketing is its own category and is OFF by default. It is never bundled
 *   with product or safety messages.
 * - Safety & security in-app alerts cannot be switched off: muting them would
 *   hide blocks, reports, account suspensions and security notices that a
 *   member materially needs to see. Push for safety stays user-controlled.
 */

export type NotifCategory =
  | "gameReminders"
  | "gameUpdates"
  | "nearbyGames"
  | "messages"
  | "invitations"
  | "payments"
  | "safety"
  | "social"
  | "general"
  | "marketing";

export type NotifChannel = "inApp" | "push";

export type NotifPrefs = Record<NotifCategory, Record<NotifChannel, boolean>>;

export const NOTIF_CATEGORIES: NotifCategory[] = [
  "gameReminders",
  "gameUpdates",
  "nearbyGames",
  "messages",
  "invitations",
  "payments",
  "safety",
  "social",
  "general",
  "marketing",
];

export const DEFAULT_NOTIF_PREFS: NotifPrefs = {
  gameReminders: { inApp: true, push: true },
  gameUpdates: { inApp: true, push: true },
  nearbyGames: { inApp: true, push: false },
  messages: { inApp: true, push: true },
  invitations: { inApp: true, push: true },
  payments: { inApp: true, push: true },
  safety: { inApp: true, push: true },
  social: { inApp: true, push: false },
  general: { inApp: true, push: false },
  marketing: { inApp: false, push: false },
};

/**
 * Channels that stay on no matter what the stored prefs say. Keep this list as
 * small as it can possibly be — it is the only place the app overrides a member.
 */
export const LOCKED_CHANNELS: Partial<Record<NotifCategory, NotifChannel[]>> = {
  safety: ["inApp"],
};

export function isLockedChannel(category: NotifCategory, channel: NotifChannel): boolean {
  return (LOCKED_CHANNELS[category] ?? []).includes(channel);
}

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
      "Changes to games you're part of: approvals, declines, join requests, time or venue changes, and cancellations.",
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
    description: "New followers, and comments or reactions on your highlight reels.",
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

/** Old category names → current ones, so stored prefs keep their meaning. */
const LEGACY_CATEGORY_MAP: Record<string, NotifCategory> = {
  approvals: "gameUpdates",
  joinRequests: "gameUpdates",
  follows: "social",
  trainerAvailability: "gameUpdates",
  messages: "messages",
  general: "general",
};

export function categoryFor(type: string): NotifCategory {
  if (type === "game_reminder") return "gameReminders";
  if (type === "message") return "messages";
  if (type === "game_invite" || type === "org_membership" || type === "team_invite")
    return "invitations";
  if (type.startsWith("payment")) return "payments";
  if (
    type === "moderation" ||
    type === "report" ||
    type.startsWith("safety") ||
    type.startsWith("security") ||
    type === "account_suspended" ||
    type === "account_warning" ||
    type === "guardian_approval_needed"
  )
    return "safety";
  if (type === "nearby_game" || type === "new_nearby_game") return "nearbyGames";
  if (
    type === "join_request" ||
    type === "join_approved" ||
    type === "join_declined" ||
    type === "availability_updated" ||
    type === "trainer_availability" ||
    type.startsWith("game_")
  )
    return "gameUpdates";
  if (
    type === "follow" ||
    type === "unfollow" ||
    type === "comment" ||
    type === "reaction" ||
    type.startsWith("reel_")
  )
    return "social";
  if (type === "announcement" || type === "marketing") return "marketing";
  return "general";
}

function applyLocks(prefs: NotifPrefs): NotifPrefs {
  const next = { ...prefs };
  for (const [cat, channels] of Object.entries(LOCKED_CHANNELS) as Array<
    [NotifCategory, NotifChannel[]]
  >) {
    next[cat] = { ...next[cat] };
    for (const ch of channels) next[cat][ch] = true;
  }
  return next;
}

function merge(partial: Record<string, unknown> | null | undefined): NotifPrefs {
  const p = (partial ?? {}) as Record<string, Partial<Record<NotifChannel, boolean>>>;
  const out = {} as NotifPrefs;
  for (const cat of NOTIF_CATEGORIES) {
    out[cat] = { ...DEFAULT_NOTIF_PREFS[cat] };
  }
  // Legacy shape first, so an explicit current-shape value always wins.
  for (const [legacy, target] of Object.entries(LEGACY_CATEGORY_MAP)) {
    const row = p[legacy];
    if (row && typeof row === "object" && !NOTIF_CATEGORIES.includes(legacy as NotifCategory)) {
      out[target] = { ...out[target], ...row };
    }
  }
  for (const cat of NOTIF_CATEGORIES) {
    const row = p[cat];
    if (row && typeof row === "object") out[cat] = { ...out[cat], ...row };
  }
  return applyLocks(out);
}

function readLocal(): NotifPrefs {
  if (typeof window === "undefined") return DEFAULT_NOTIF_PREFS;
  try {
    const raw = window.localStorage.getItem(KEY) ?? window.localStorage.getItem(LEGACY_KEY);
    if (!raw) return DEFAULT_NOTIF_PREFS;
    return merge(JSON.parse(raw) as Record<string, unknown>);
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
      commit(merge(prefs));
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
  const cat = categoryFor(type);
  if (isLockedChannel(cat, channel)) return true;
  return getNotifPrefs()[cat][channel];
}
