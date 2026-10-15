/**
 * Keeps a shared link alive through first-time onboarding.
 *
 * A new member who opens a game/team link is sent to `/auth?next=…`. If they
 * still have to answer the age and profile-type questions, the sign-in page
 * sends them to onboarding first and the link would be lost. We park it here and
 * hand it back once they first reach the feed. Same-tab only, and it expires,
 * so a stale link never hijacks a later session.
 */
import { sanitizeNextPath } from "@/routes/__root";

const KEY = "openrun:pending-next";
const MAX_AGE_MS = 60 * 60 * 1000;

export function stashPendingNext(href: string | undefined): void {
  try {
    const safe = sanitizeNextPath(href);
    if (!safe) return;
    window.sessionStorage.setItem(KEY, JSON.stringify({ href: safe, at: Date.now() }));
  } catch {
    /* sessionStorage unavailable */
  }
}

/** Returns the parked link once, then forgets it. */
export function takePendingNext(): string | undefined {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    window.sessionStorage.removeItem(KEY);
    const { href, at } = JSON.parse(raw) as { href?: unknown; at?: unknown };
    if (typeof at !== "number" || Date.now() - at > MAX_AGE_MS) return undefined;
    return sanitizeNextPath(href);
  } catch {
    return undefined;
  }
}

/** `/auth` search params that bring the visitor back to the page they are on. */
export function authSearchHere(): { next?: string } {
  if (typeof window === "undefined") return {};
  const next = sanitizeNextPath(
    `${window.location.pathname}${window.location.search}${window.location.hash}`,
  );
  return next ? { next } : {};
}
