/**
 * Private share links for family posts (a parent's clip of their under-13 child).
 *
 * A link is a long random secret in the URL. Only its SHA-256 hash is stored, so
 * a database leak never exposes a working link, and the secret is shown to the
 * parent exactly once, when it is created. A link opens one clip, nothing else:
 * no child name, no profile, no comments. It expires, and the parent can revoke it.
 *
 * Pure module: works in the browser and on the server (Web Crypto).
 */

import { knownErrorMessage } from "@/lib/user-error";

export const SHARE_LINK_DEFAULT_DAYS = 14;
export const SHARE_LINK_MAX_DAYS = 30;
export const SHARE_LINK_MAX_ACTIVE_PER_REEL = 5;

/** Whole days, clamped to 1..30; anything unusable falls back to the default. */
export function normalizeShareDays(v: unknown): number {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n < 1) return SHARE_LINK_DEFAULT_DAYS;
  return Math.min(n, SHARE_LINK_MAX_DAYS);
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** 256 bits of randomness, URL-safe (43 characters). */
export function generateShareToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

/** Cheap shape check so junk never reaches the database. */
export function isPlausibleShareToken(token: unknown): token is string {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token);
}

/** Lower-case hex SHA-256 of the token; this is what is stored and looked up. */
export async function hashShareToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function shareUrl(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/family-share/${token}`;
}

export type ShareLinkStatus = "active" | "expired" | "revoked";

export function shareLinkStatus(
  link: { expires_at: string; revoked_at?: string | null },
  now: Date = new Date(),
): ShareLinkStatus {
  if (link.revoked_at) return "revoked";
  return new Date(link.expires_at).getTime() > now.getTime() ? "active" : "expired";
}

/** A plain-words message when `err` carries a code we have words for, otherwise null. */
export function shareErrorMessage(err: unknown): string | null {
  return knownErrorMessage(err) ?? null;
}
