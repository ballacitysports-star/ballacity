/**
 * Single source of truth for the Google (and future social) OAuth
 * `redirect_uri`. Always resolves to `${origin}/oauth/callback` — a public,
 * same-origin route that polls the Supabase session and forwards the user
 * to /profile or /onboarding.
 *
 * DO NOT inline `window.location.origin` at call sites: a bare origin lands
 * a full-page redirect on `/` (the marketing page), and AuthGate does not
 * auto-bounce from `/`, stranding the just-signed-in user.
 */

export const OAUTH_CALLBACK_PATH = "/oauth/callback";

export function getOAuthRedirectUri(origin?: string): string {
  const base =
    origin ??
    (typeof window !== "undefined" ? window.location.origin : "");
  if (!base) {
    throw new Error(
      "getOAuthRedirectUri: no origin available (called during SSR without an explicit origin).",
    );
  }
  // Guard against trailing slashes so the resulting URL is always canonical.
  const normalized = base.replace(/\/+$/, "");
  const uri = `${normalized}${OAUTH_CALLBACK_PATH}`;
  assertValidOAuthRedirectUri(uri);
  return uri;
}

/**
 * Runtime configuration check. Throws if a candidate `redirect_uri` is not
 * a same-origin URL pointing at `/oauth/callback`. Use to fail fast in dev
 * if a call site regresses to `window.location.origin` (or any other path).
 */
export function assertValidOAuthRedirectUri(candidate: string): void {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(
      `Invalid OAuth redirect_uri: "${candidate}" is not a valid URL.`,
    );
  }
  if (parsed.pathname !== OAUTH_CALLBACK_PATH) {
    throw new Error(
      `Invalid OAuth redirect_uri: pathname must be "${OAUTH_CALLBACK_PATH}", got "${parsed.pathname}". ` +
        `Use getOAuthRedirectUri() instead of inlining window.location.origin.`,
    );
  }
  if (parsed.search || parsed.hash) {
    throw new Error(
      `Invalid OAuth redirect_uri: must not include query or hash, got "${candidate}".`,
    );
  }
}
