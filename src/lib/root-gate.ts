import { isSignedOutPublicPath } from "@/lib/public-paths";
import { isPublicReelPath } from "@/lib/social-share";
import { isSportHubPath } from "@/lib/sport-hubs";

/**
 * Which pages the root AuthGate lets through without sign-in, age or account-type
 * checks. Moved out of routes/__root.tsx unchanged so it can be tested on its own.
 *
 * Everything not matched here is protected: a signed-out visitor is sent to sign in,
 * and a signed-in member passes the age and account-type steps first.
 */
export const PUBLIC_ROUTES: readonly string[] = [
  "/",
  "/auth",
  // Staff entry: signed-out visitors see the single sign-in button.
  "/staff",
  "/reset-password",
  "/.lovable/oauth/consent",
  // Legal documents must be readable before/without signing in.
  "/terms",
  "/privacy",
  "/cookies",
  "/payment-policy",
  "/ai-disclosure",
  "/youth-policy",
  // Safety Center, Trust Center, and policy pages must be readable without
  // signing in.
  "/safety",
  "/trust-center",
  "/community-guidelines",
  "/contact",
  // Sports guides are public, indexable content.
  "/guide",
  // Articles are public, indexable content.
  "/blog",
  // City pages list only public games, teams and gyms, read through the
  // allowlisted public columns (see city-pages.functions.ts), and are indexed.
  "/cities",

  // Shareable, sign-in-free surface.
  "/highlights",
  "/player-card",
  // A parent's private link to one family clip: opens without signing in, but is
  // unindexed, expires, and can be revoked.
  "/family-share",
  // The reel privacy policy: plain-language, readable without signing in.
  "/reel-privacy",
  // Tryout/camp sign-up pages are shareable; applying still requires sign-in.
  "/tryouts",
];

/** Whether the root gates let `pathname` through for this viewer without checks. */
export function isPublicForViewer(pathname: string, signedIn: boolean): boolean {
  return (
    pathname === "/" ||
    // Only a signed-out visitor gets the public game, team and facility pages. A
    // signed-in member still goes through the age and account-type steps.
    (!signedIn && isSignedOutPublicPath(pathname)) ||
    PUBLIC_ROUTES.some((p) => p !== "/" && (pathname === p || pathname.startsWith(`${p}/`))) ||
    // The public sport hubs: exactly /<sport>, nothing deeper.
    isSportHubPath(pathname) ||
    // A shared reel page; an exact match, since a /reels prefix would open the studio tab.
    isPublicReelPath(pathname)
  );
}
