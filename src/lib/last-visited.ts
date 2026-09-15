/**
 * Remembers the last in-app page the user visited so refreshes or
 * bookmark/OAuth returns to `/` can restore that page instead of the
 * marketing landing.
 */
import { sanitizeNextPath } from "@/routes/__root";

export const LAST_VISITED_KEY = "openrun:last-visited";

const SKIP_EXACT = new Set(["/", "/auth", "/reset-password"]);
const SKIP_PREFIXES = [
  "/auth/",
  "/reset-password/",
  "/api/",
  "/.well-known/",
  "/.mcp/",
  "/.lovable",
];

function isRecordable(pathname: string): boolean {
  if (SKIP_EXACT.has(pathname)) return false;
  return !SKIP_PREFIXES.some((p) => pathname.startsWith(p));
}

export function rememberLastVisited(href: string): void {
  try {
    if (typeof window === "undefined") return;
    // href may be a full URL or a path — normalize via URL against origin.
    const u = new URL(href, window.location.origin);
    if (u.origin !== window.location.origin) return;
    if (!isRecordable(u.pathname)) return;
    const value = `${u.pathname}${u.search}${u.hash}`;
    window.localStorage.setItem(LAST_VISITED_KEY, value);
  } catch {
    /* ignore */
  }
}

export function readLastVisited(): string | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(LAST_VISITED_KEY);
    if (!raw) return null;
    const safe = sanitizeNextPath(raw);
    if (!safe) return null;
    const pathOnly = safe.split(/[?#]/)[0] ?? "";
    if (!isRecordable(pathOnly)) return null;
    return safe;
  } catch {
    return null;
  }
}

export function clearLastVisited(): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(LAST_VISITED_KEY);
  } catch {
    /* ignore */
  }
}
