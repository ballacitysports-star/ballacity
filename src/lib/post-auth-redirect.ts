/**
 * Persist the route the user was trying to reach when we bounced them to
 * /auth, so /oauth/callback (and the email sign-in success path) can
 * restore it after authentication.
 *
 * Rules:
 * - Only same-origin relative paths (must start with a single "/").
 * - Never protocol-relative ("//host") or absolute URLs.
 * - Never /auth, /oauth/*, /reset-password (would loop).
 * - Never empty; fall back to the caller-provided default.
 */

const STORAGE_KEY = "openrun:postAuthRedirect";

const BLOCKED_PREFIXES = ["/auth", "/oauth/", "/reset-password"];

export function isSafeRedirectPath(candidate: unknown): candidate is string {
  if (typeof candidate !== "string") return false;
  if (candidate.length === 0 || candidate.length > 512) return false;
  if (!candidate.startsWith("/")) return false;
  if (candidate.startsWith("//")) return false; // protocol-relative
  if (candidate.startsWith("/\\")) return false;
  for (const p of BLOCKED_PREFIXES) {
    if (candidate === p || candidate.startsWith(`${p}/`) || candidate === `${p.replace(/\/$/, "")}`) {
      return false;
    }
  }
  return true;
}

export function savePostAuthRedirect(path: string): void {
  if (!isSafeRedirectPath(path)) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, path);
  } catch {
    // Storage may be unavailable (privacy modes); silently skip.
  }
}

/** Read without removing. Used by the OAuth call site to know the target. */
export function peekPostAuthRedirect(): string | null {
  try {
    const v = sessionStorage.getItem(STORAGE_KEY);
    return isSafeRedirectPath(v) ? v : null;
  } catch {
    return null;
  }
}

/** Read and clear. Used by the destination handler (auth success, callback). */
export function consumePostAuthRedirect(fallback: string): string {
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
  return isSafeRedirectPath(stored) ? stored : fallback;
}

export function clearPostAuthRedirect(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
