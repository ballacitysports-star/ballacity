/**
 * Notification preferences: the pure rules (categories, defaults, locks, the merge of stored
 * prefs), with no browser store or client imports, so the server applies the same rules as the
 * app. `notification-prefs.ts` re-exports these for the client; the rules are written once.
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
    type === "team_announcement" ||
    type.startsWith("game_")
  )
    return "gameUpdates";
  if (
    type === "follow" ||
    type === "follow_request" ||
    type === "unfollow" ||
    type === "comment" ||
    type === "reaction" ||
    type.startsWith("reel_")
  )
    return "social";
  if (type === "announcement" || type === "marketing") return "marketing";
  return "general";
}

export function applyLocks(prefs: NotifPrefs): NotifPrefs {
  const next = { ...prefs };
  for (const [cat, channels] of Object.entries(LOCKED_CHANNELS) as Array<
    [NotifCategory, NotifChannel[]]
  >) {
    next[cat] = { ...next[cat] };
    for (const ch of channels) next[cat][ch] = true;
  }
  return next;
}

/** Stored prefs (any shape the app has written, legacy names included) over the defaults. */
export function mergeNotifPrefs(partial: Record<string, unknown> | null | undefined): NotifPrefs {
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

/** Whether `prefs` let a notification of `type` through on `channel`. Locked channels always do. */
export function isAllowedIn(prefs: NotifPrefs, type: string, channel: NotifChannel): boolean {
  const cat = categoryFor(type);
  if (isLockedChannel(cat, channel)) return true;
  return prefs[cat][channel];
}
