/**
 * Pair a device: a one-time link a managing guardian gives a managed child so
 * the child's own phone can open their profile with no email or password.
 *
 * This module is pure (and uses only Web Crypto) so the server functions, the
 * UI and the tests share one definition of the token, its lifetime and the
 * link shape.
 */

/** How long a link works once the guardian creates it. */
export const PAIR_LINK_TTL_MINUTES = 15;

/** Links a guardian can make for one child per hour. */
export const MAX_PAIR_LINKS_PER_HOUR = 10;

/** 32 random bytes, base64url — 256 bits, so a link can't be guessed. */
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePairToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}

export function isPairToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_RE.test(value);
}

/** What the database stores. The token itself never is. */
export async function hashPairToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * The shareable link. The token rides in the URL fragment, which browsers
 * never send to a server and never put in a Referer header, so it stays out of
 * request logs and analytics.
 */
export function pairUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/pair#t=${token}`;
}

/** The token in a `/pair` URL fragment, or null when there isn't a well-formed one. */
export function tokenFromHash(hash: string): string | null {
  const m = /^#?t=([^&]*)/.exec(hash);
  return m && isPairToken(m[1]) ? m[1] : null;
}

/** A text-message link that opens the phone's messages app with the link filled in. */
export function smsHref(childFirstName: string, url: string): string {
  const body = `Tap to open ${childFirstName}'s BallaCity profile (works once, for ${PAIR_LINK_TTL_MINUTES} minutes): ${url}`;
  return `sms:?&body=${encodeURIComponent(body)}`;
}

export function pairLinkExpiry(now: number = Date.now()): Date {
  return new Date(now + PAIR_LINK_TTL_MINUTES * 60_000);
}
