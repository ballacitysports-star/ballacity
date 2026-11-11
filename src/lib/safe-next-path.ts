/**
 * The one filter for a `next` path: what `/auth` reads from its search, what the
 * root AuthGate puts there, and what "last visited" restores. After sign-in the
 * result is handed to `window.location.replace`, so anything it lets through is
 * followed by the browser.
 */

// A placeholder origin to resolve against. Only the comparison with it matters.
const BASE = "https://next-path.invalid";

/**
 * Returns `raw` if it is a path on this site, else `undefined`.
 *
 * Refused:
 * - anything that is not a string starting with a single `/`: absolute URLs,
 *   `javascript:` and other schemes, protocol-relative `//host`;
 * - any backslash or control character. Browsers read `\` as `/` and drop tabs
 *   and newlines, so `/\evil.com` and `/<tab>/evil.com` both become `//evil.com`;
 * - anything that still resolves to another origin;
 * - the landing page, `/auth` and `/reset-password`, which would loop back
 *   through the sign-in flow itself.
 */
export function sanitizeNextPath(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0) return undefined;
  if (!raw.startsWith("/") || raw.startsWith("//")) return undefined;
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return undefined;
  let url: URL;
  try {
    url = new URL(raw, BASE);
  } catch {
    return undefined;
  }
  if (url.origin !== BASE) return undefined;
  const path = url.pathname.toLowerCase();
  if (path === "/") return undefined;
  if (path === "/auth" || path.startsWith("/auth/")) return undefined;
  if (path === "/reset-password" || path.startsWith("/reset-password/")) return undefined;
  return raw;
}
