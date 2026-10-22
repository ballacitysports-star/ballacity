/**
 * Pages a signed-out visitor may open. Each is a single page; its sub-pages
 * (pay, edit, members, manage) have a further segment and stay behind sign-in.
 *
 * The tab pages are the exception to "public data only": a signed-out visitor
 * gets a static preview with sample content (see SignedOutPreview),
 * never the signed-in page itself.
 */

/** A single game: a short public preview instead of the signed-in page. */
export function isPublicGamePath(pathname: string): boolean {
  return /^\/games\/[^/]+\/?$/.test(pathname);
}

/** A single team: a short public preview instead of the signed-in page. */
export function isPublicTeamPath(pathname: string): boolean {
  return /^\/teams\/(?!create(?:\/|$))[^/]+\/?$/.test(pathname);
}

/** A single trainer: a short public preview. `/trainers` itself is the tab preview. */
export function isPublicTrainerPath(pathname: string): boolean {
  return /^\/trainers\/(?!create(?:\/|$))[^/]+\/?$/.test(pathname);
}

/** The facility directory and a single facility's page, both built for the public. */
export function isPublicFacilityPath(pathname: string): boolean {
  return /^\/orgs\/?$/.test(pathname) || /^\/orgs\/(?!create(?:\/|$))[^/]+\/?$/.test(pathname);
}

/**
 * The tabs a signed-out visitor sees as a sample preview of the real page.
 * `/highlights` is not listed: it is already open and shows public reels only.
 * `/messages` previews only the inbox; a conversation (`/messages/<id>`) stays behind
 * sign-in. `/discover` is not listed either: it only redirects to `/feed`.
 */
export const SIGNED_OUT_PREVIEW_TABS = [
  "/feed",
  "/players",
  "/teams",
  "/trainers",
  "/reels",
  "/messages",
  "/create",
  "/profile",
  "/orgs",
] as const;

/** An exact tab path: `/teams` previews, `/teams/create` and `/profile/edit` do not. */
export function isSignedOutPreviewPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (SIGNED_OUT_PREVIEW_TABS as readonly string[]).includes(path);
}

/** Whether a signed-out visitor may open this path. */
export function isSignedOutPublicPath(pathname: string): boolean {
  return (
    isPublicGamePath(pathname) ||
    isPublicTeamPath(pathname) ||
    isPublicTrainerPath(pathname) ||
    isPublicFacilityPath(pathname) ||
    isSignedOutPreviewPath(pathname)
  );
}

/**
 * Where a signed-out visitor also gets the bottom bar: the tab previews, plus the
 * public pages that are tabs of their own or open from one (Reels is the highlights
 * feed, Venues is part of Discover, and a venue opens from it). Without this the bar vanishes the moment a
 * visitor taps Reels.
 */
export function showsSignedOutBar(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return (
    isSignedOutPreviewPath(pathname) || path === "/highlights" || isPublicFacilityPath(pathname)
  );
}
