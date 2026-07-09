const POST_AUTH_REDIRECT_KEY = "openrun.postAuthRedirect.v1";

export function rememberPostAuthRedirect(path = "/profile") {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(POST_AUTH_REDIRECT_KEY, path);
  } catch {
    // ignore storage errors
  }
}

export function consumePostAuthRedirect(fallback = "/profile") {
  if (typeof window === "undefined") return fallback;
  try {
    const next = window.sessionStorage.getItem(POST_AUTH_REDIRECT_KEY);
    window.sessionStorage.removeItem(POST_AUTH_REDIRECT_KEY);
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  } catch {
    // ignore storage errors
  }
  return fallback;
}

export function peekPostAuthRedirect(fallback = "/profile") {
  if (typeof window === "undefined") return fallback;
  try {
    const next = window.sessionStorage.getItem(POST_AUTH_REDIRECT_KEY);
    if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  } catch {
    // ignore storage errors
  }
  return fallback;
}