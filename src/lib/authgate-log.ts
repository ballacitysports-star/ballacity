/**
 * Structured client-side logging for AuthGate session-refresh decisions.
 *
 * Verbose per-decision logs are gated so they don't spam every user's
 * console in production. They turn on when ANY of these is true:
 *
 *   - `import.meta.env.DEV` (local dev)
 *   - `localStorage.debug_authgate === "1"`
 *   - URL contains `?debug_authgate=1` (also sticks the flag in
 *     localStorage so it survives the reloads you're debugging)
 *
 * The `redirect` decision is ALWAYS logged as `console.warn` so we can
 * spot forced /auth redirects on iOS Safari / Android Chrome even
 * without the debug flag on.
 */

const LS_KEY = "debug_authgate";

function hasQueryFlag(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const u = new URL(window.location.href);
    return u.searchParams.get(LS_KEY) === "1";
  } catch {
    return false;
  }
}

function persistQueryFlag() {
  try {
    if (hasQueryFlag()) window.localStorage.setItem(LS_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function isAuthGateDebugEnabled(): boolean {
  if (import.meta.env.DEV) return true;
  try {
    if (typeof window === "undefined") return false;
    persistQueryFlag();
    if (window.localStorage.getItem(LS_KEY) === "1") return true;
    return hasQueryFlag();
  } catch {
    return false;
  }
}

export type AuthGateDecision =
  | "public-skip"
  | "auth-route-skip"
  | "user-present"
  | "verify-start"
  | "verify-hydrated-late"
  | "verify-no-session"
  | "verify-hydrated-retry"
  | "verify-waiting-hydration"
  | "redirect";

/**
 * Reads the persisted Supabase session from localStorage without touching the
 * network. Returns `null` when there is no stored session, the payload is
 * unparseable, or the access token has already expired. Used by AuthGate to
 * decide whether a `getSession()` miss deserves a short retry (persisted
 * session may not have parsed yet on slow mobile webviews) vs. an immediate
 * redirect to /auth.
 */
export function readStoredSupabaseSession(): { expiresAt: number | null } | null {
  try {
    if (typeof window === "undefined") return null;
    const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "") as string;
    if (!projectRef) return null;
    const raw = window.localStorage.getItem(`sb-${projectRef}-auth-token`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const expiresAt: number | undefined = parsed?.expires_at;
    if (typeof expiresAt === "number" && expiresAt <= Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { expiresAt: typeof expiresAt === "number" ? expiresAt : null };
  } catch {
    return null;
  }
}

interface DecisionContext {
  pathname: string;
  loading?: boolean;
  hasUser?: boolean;
  extra?: Record<string, unknown>;
}

function envSnapshot(): Record<string, unknown> {
  const snap: Record<string, unknown> = {};
  try {
    snap.visibility = typeof document !== "undefined" ? document.visibilityState : "unknown";
    snap.online = typeof navigator !== "undefined" ? navigator.onLine : "unknown";
    snap.ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown";
    const projectRef = (import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "") as string;
    const storageKey = projectRef ? `sb-${projectRef}-auth-token` : "";
    if (storageKey && typeof window !== "undefined") {
      const raw = window.localStorage.getItem(storageKey);
      snap.hasStoredSession = !!raw;
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          const expiresAt: number | undefined = parsed?.expires_at;
          snap.sessionExpiresAt = expiresAt ?? null;
          snap.sessionExpiresInSec =
            typeof expiresAt === "number" ? expiresAt - Math.floor(Date.now() / 1000) : null;
        } catch {
          snap.storedSessionParseError = true;
        }
      }
    } else {
      snap.hasStoredSession = "unknown";
    }
  } catch {
    /* ignore */
  }
  return snap;
}

export function logAuthGateDecision(decision: AuthGateDecision, ctx: DecisionContext): void {
  const payload = {
    decision,
    pathname: ctx.pathname,
    loading: ctx.loading,
    hasUser: ctx.hasUser,
    ...envSnapshot(),
    ...(ctx.extra ?? {}),
    ts: new Date().toISOString(),
  };
  const tag = "[AuthGate]";
  // Always warn on forced redirects so we catch them without the debug flag.
  if (decision === "redirect") {
    console.warn(tag, decision, payload);
    return;
  }
  if (!isAuthGateDebugEnabled()) return;

  console.info(tag, decision, payload);
}
