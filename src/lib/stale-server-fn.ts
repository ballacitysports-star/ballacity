export const STALE_SERVER_FN_HEADER = "x-ballacity-stale-server-fn";

export function isStaleServerFnError(error: unknown): boolean {
  return error instanceof Error && /^Invalid server function ID:/.test(error.message);
}

/** Never retry a mutation: the stale handler was not found, so refresh its client. */
export function createStaleServerFnFetch(fetcher: typeof fetch, recover: () => void): typeof fetch {
  let recovering = false;
  return async (input, init) => {
    const response = await fetcher(input, init);
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!recovering && new URL(url, "http://localhost").pathname.startsWith("/_serverFn/")) {
      let stale = response.status === 409 && response.headers.get(STALE_SERVER_FN_HEADER) === "1";
      if (!stale && response.status === 500) {
        try {
          stale = /Invalid server function ID:/.test(await response.clone().text());
        } catch { /* A failed diagnostic read must not change the original response. */ }
      }
      if (stale) {
        recovering = true;
        recover();
      }
    }
    return response;
  };
}

export function installStaleServerFnRecovery() {
  if (typeof window === "undefined") return () => {};
  const originalFetch = window.fetch;
  const patched = createStaleServerFnFetch(originalFetch.bind(window), () => {
    // Separate from the boot watchdog: mounting the app must not clear this guard.
    const key = "ballacity:stale-server-fn-retry-at";
    try {
      const last = Number(window.sessionStorage.getItem(key) ?? "0");
      if (last && Date.now() - last < 120_000) return;
      window.sessionStorage.setItem(key, String(Date.now()));
    } catch {
      // Without persistent loop protection, leave manual retry available instead.
      return;
    }
    window.location.reload();
  });
  window.fetch = patched;
  return () => {
    if (window.fetch === patched) window.fetch = originalFetch;
  };
}