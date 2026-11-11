import { useMemo } from "react";
import { useLocation } from "@tanstack/react-router";
import { sanitizeNextPath } from "@/lib/safe-next-path";

/**
 * The `/auth` search that brings a visitor back to `href` once they have signed
 * in or up: `{ next: href }`, or `{}` when `href` is not a page to come back to.
 *
 * `href` goes through the same filter `/auth` applies to `next`
 * (`sanitizeNextPath`), so it is only ever a path on this site. Onboarding pages
 * are dropped as well: they are steps the sign-in flow sends a member through
 * itself, not somewhere to return to.
 */
export function authSearchFor(href: string | undefined): { next?: string } {
  const next = sanitizeNextPath(href);
  if (!next) return {};
  const path = new URL(next, "https://next-path.invalid").pathname.toLowerCase();
  if (path === "/onboarding" || path.startsWith("/onboarding/")) return {};
  return { next };
}

/**
 * `authSearchFor` the page being viewed (path, query and hash), for a sign-in
 * link or button: `<Link to="/auth" search={useAuthSearchHere()}>`. Read from the
 * router, so the server render and the first client render agree.
 */
export function useAuthSearchHere(): { next?: string } {
  const href = useLocation({ select: (l) => l.href });
  return useMemo(() => authSearchFor(href), [href]);
}
