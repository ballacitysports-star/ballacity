/**
 * What a signed-in app may put in a notification (and push) for someone else.
 *
 * createNotificationForUser lets the app notify another member it has a relationship with (can_notify: a shared game, chat,
 * team, contact request...), and sends the push for it. Before this guard the text, the type and the link (and a separate
 * push, through sendPushToUser) were whatever the sender's app sent, so anyone with one contact request to a person could
 * send them a "safety" alert (an in-app category that cannot be switched off) or a link to any website. The guard keeps what
 * the app's own screens send and nothing else:
 *   - the type is one the app sends for another member (game, payment, waitlist, message, availability updates); never a
 *     safety, account or marketing type;
 *   - the link is a path inside the app under /games/, /messages/ or /players (absolute only on BallaCity's own hosts or a
 *     Lovable preview), never another site, a script or a protocol-relative URL;
 *   - the title and body are short.
 * Notifications the database writes itself (game invitations, reminders, safety notices) do not go through here.
 */

/** Types the app's screens send to another member. Keep in step with the createNotification call sites. */
export const CLIENT_NOTIFICATION_TYPES: ReadonlySet<string> = new Set([
  "availability_updated",
  "game_broadcast",
  "game_time_changed",
  "join_approved",
  "join_declined",
  "join_request",
  "join_resubmitted",
  "message",
  "participant_joined",
  "participant_left",
  "participant_removed",
  "payment_rejected",
  "payment_reminder",
  "payment_submitted",
  "payment_verified",
  "waitlist_approved",
  "waitlist_declined",
  "waitlist_join",
]);

export const NOTIFICATION_TITLE_MAX = 120;
export const NOTIFICATION_BODY_MAX = 500;
const LINK_MAX = 300;
const ALLOWED_PREFIXES = ["/games/", "/messages/", "/players"];
const ALLOWED_HOSTS = new Set([
  "ballacity.com",
  "www.ballacity.com",
  "ballacity.lovable.app",
  "localhost",
]);

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function allowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return ALLOWED_HOSTS.has(h) || h.endsWith(".lovable.app") || h.endsWith(".lovableproject.com");
}

/**
 * The in-app path a link points to, or null when it may not be sent to another member. Accepts "/games/g1?invite=1" or
 * "https://ballacity.lovable.app/games/g1"; refuses other sites, schemes, protocol-relative and backslash tricks, and paths
 * outside /games/, /messages/ and /players.
 */
export function appPathOf(link: string | null | undefined): string | null {
  if (link == null) return null;
  const raw = String(link).trim();
  if (!raw || raw.length > LINK_MAX) return null;
  if (/[\s\\]/.test(raw) || hasControlChar(raw) || raw.startsWith("//")) return null;
  let url: URL;
  try {
    url = new URL(raw, "https://ballacity.lovable.app");
  } catch {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
    if (!/^https?:$/.test(url.protocol) || !allowedHost(url.hostname)) return null;
    if (url.protocol === "http:" && url.hostname !== "localhost") return null;
  } else if (!raw.startsWith("/")) {
    return null;
  }
  const path = url.pathname;
  if (path.includes("//") || path.split("/").some((seg) => seg === "..")) return null;
  if (!ALLOWED_PREFIXES.some((p) => path === p.replace(/\/$/, "") || path.startsWith(p)))
    return null;
  return `${path}${url.search}`;
}

export type GuardedNotification = {
  type: string;
  title: string;
  body: string | null;
  link: string | null;
};

/**
 * The notification as it may be stored for another member, or an error code: NOTIFICATION_TYPE_NOT_ALLOWED or
 * NOTIFICATION_LINK_NOT_ALLOWED. Text is trimmed and cut to length rather than refused.
 */
export function guardNotificationForOther(input: {
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}): { ok: true; value: GuardedNotification } | { ok: false; code: string } {
  if (!CLIENT_NOTIFICATION_TYPES.has(input.type))
    return { ok: false, code: "NOTIFICATION_TYPE_NOT_ALLOWED" };
  let link: string | null = null;
  if (input.link != null && String(input.link).trim() !== "") {
    link = appPathOf(input.link);
    if (!link) return { ok: false, code: "NOTIFICATION_LINK_NOT_ALLOWED" };
  }
  const title = input.title.trim().slice(0, NOTIFICATION_TITLE_MAX);
  const body = input.body?.trim() ? input.body.trim().slice(0, NOTIFICATION_BODY_MAX) : null;
  return { ok: true, value: { type: input.type, title, body, link } };
}
