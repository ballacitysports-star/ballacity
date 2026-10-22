/**
 * Pages a signed-out visitor may open. Each is a single page; its sub-pages
 * (pay, edit, members, manage) have a further segment and stay behind sign-in.
 */

/** A single game: a short public preview instead of the signed-in page. */
export function isPublicGamePath(pathname: string): boolean {
  return /^\/games\/[^/]+\/?$/.test(pathname);
}

/** A single team: a short public preview instead of the signed-in page. */
export function isPublicTeamPath(pathname: string): boolean {
  return /^\/teams\/(?!create(?:\/|$))[^/]+\/?$/.test(pathname);
}

/** The facility directory and a single facility's page, both built for the public. */
export function isPublicFacilityPath(pathname: string): boolean {
  return /^\/orgs\/?$/.test(pathname) || /^\/orgs\/(?!create(?:\/|$))[^/]+\/?$/.test(pathname);
}

/** Whether a signed-out visitor may open this path. */
export function isSignedOutPublicPath(pathname: string): boolean {
  return isPublicGamePath(pathname) || isPublicTeamPath(pathname) || isPublicFacilityPath(pathname);
}
