/**
 * Deep-link resolution for notifications and push alerts.
 *
 * A notification carries a `link` such as `/games/abc?invite=1`. Push
 * providers (OneSignal) need an absolute URL, while in-app clicks should be
 * handled by the client router so the app never does a full reload.
 */

/** Fallback destinations when a notification has no explicit link. */
const TYPE_FALLBACKS: Record<string, string> = {
  message: "/messages",
  messages: "/messages",
  game: "/feed",
  game_invite: "/feed",
  join_request: "/notifications",
  payment: "/payments",
  review: "/reviews",
  team: "/teams",
  org: "/orgs",
  trainer: "/trainers",
  availability: "/players",
  profile: "/profile",
};

/**
 * Normalizes any notification link into a safe, same-origin app path
 * (`/path?query#hash`). External or malformed links resolve to `null` so we
 * never navigate the user off-app from a notification.
 */
export function toAppPath(link: string | null | undefined): string | null {
  if (!link) return null;
  const raw = String(link).trim();
  if (!raw) return null;
  // Reject protocol-relative and non-http(s) schemes outright.
  if (raw.startsWith("//")) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return null;

  try {
    const origin =
      typeof window !== "undefined" && window.location?.origin
        ? window.location.origin
        : "https://app.local";
    const url = new URL(raw, origin);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (/^https?:/i.test(raw) && url.origin !== origin && typeof window !== "undefined") {
      // Absolute link pointing somewhere else — not a deep link into this app.
      return null;
    }
    const path = `${url.pathname}${url.search}${url.hash}`;
    return path.startsWith("/") ? path : `/${path}`;
  } catch {
    return null;
  }
}

/**
 * Resolves the in-app path a notification should open, using the explicit link
 * when present and a type-based fallback otherwise.
 */
export function resolveNotificationTarget(n: {
  link?: string | null;
  type?: string | null;
}): string {
  return toAppPath(n.link) ?? TYPE_FALLBACKS[String(n.type ?? "")] ?? "/notifications";
}

/** Builds the absolute URL a push alert should open. */
export function toAbsoluteDeepLink(
  link: string | null | undefined,
  type?: string | null,
  origin?: string,
): string | null {
  const base =
    origin ??
    (typeof window !== "undefined" && window.location?.origin ? window.location.origin : null);
  if (!base) return null;
  const path = resolveNotificationTarget({ link, type });
  try {
    return new URL(path, base).toString();
  } catch {
    return null;
  }
}

type Navigator = (path: string) => void;

let appNavigator: Navigator | null = null;

/** Registered once from the app root so background handlers can route in-app. */
export function setDeepLinkNavigator(fn: Navigator | null) {
  appNavigator = fn;
}

/**
 * Navigates to a notification's target. Uses the client router when available
 * (registered navigator) and falls back to a hard navigation.
 */
export function openDeepLink(link: string | null | undefined, type?: string | null) {
  const path = resolveNotificationTarget({ link, type });
  if (appNavigator) {
    try {
      appNavigator(path);
      return path;
    } catch {
      /* fall through to hard navigation */
    }
  }
  if (typeof window !== "undefined") window.location.assign(path);
  return path;
}
