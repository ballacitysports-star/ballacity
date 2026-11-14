import { sanitizeNextPath } from "@/lib/safe-next-path";

/**
 * The page a member asked for when they tapped "Continue with Google/Apple".
 *
 * It cannot ride in the provider's `redirect_uri` (that must stay a public,
 * same-origin URL or the vendor rejects it), so `/auth` stashes it in this tab's
 * sessionStorage and whoever completes the sign-in reads it back: `/auth`'s own
 * post-sign-in redirect and the root's SIGNED_IN listener (`__root.tsx`).
 */
export const OAUTH_NEXT_KEY = "openrun:oauth-next";

/** Stash `next` (sanitized) for after the provider round trip, or clear a stale one. */
export function stashOAuthNext(next: string | undefined): void {
  try {
    const safe = sanitizeNextPath(next);
    if (safe) window.sessionStorage.setItem(OAUTH_NEXT_KEY, safe);
    else window.sessionStorage.removeItem(OAUTH_NEXT_KEY);
  } catch {
    /* sessionStorage may be unavailable in private mode */
  }
}

/** The stashed page, if it is still a safe path on this site. Leaves it in place. */
export function readOAuthNext(): string | undefined {
  try {
    return sanitizeNextPath(window.sessionStorage.getItem(OAUTH_NEXT_KEY));
  } catch {
    return undefined;
  }
}

/** Forget the stashed page once it has been used. */
export function clearOAuthNext(): void {
  try {
    window.sessionStorage.removeItem(OAUTH_NEXT_KEY);
  } catch {
    /* sessionStorage unavailable */
  }
}

/**
 * The stash as one `/auth` page sees it: read once, when the page mounts, and
 * changed after that only through this object.
 *
 * `/auth` decides where to go from several callbacks for one sign-in (the
 * session check, the auth listener, a fresh user), and the root's SIGNED_IN
 * listener removes the stash from storage when it uses it, which can happen
 * between two of them. Reading storage per call let a later call find it gone
 * and send the member to the feed while an earlier one sent them to the page
 * they asked for; the last full-page navigation won.
 */
export function oauthNextForPage() {
  let value = readOAuthNext();
  return {
    /** The page this sign-in should go to, if one was stashed. */
    get: (): string | undefined => value,
    /** The Google/Apple button on this page stashes (or clears) a new one. */
    stash(next: string | undefined) {
      stashOAuthNext(next);
      value = readOAuthNext();
    },
    /** Used: remove it from storage so a later sign-in in this tab cannot go there. */
    used() {
      clearOAuthNext();
    },
  };
}
