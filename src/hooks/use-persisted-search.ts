import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Persist a route's validated search params to localStorage so the screen
 * always comes back exactly the way the user left it — including choices
 * that happen to equal a default (e.g. switching density back to "list",
 * or clearing every sport). Refreshing with a populated URL still wins;
 * this hook only fills in the "no explicit params" case.
 *
 * - On mount (before paint): if the URL carries no explicit key from the
 *   snapshot, replace the URL with the stored snapshot.
 * - On change: writes a FULL snapshot of every key back to `storageKey`.
 *
 * Returns `hydrated`, which callers can use to hold off data fetching
 * until the restored state is actually in the URL.
 */

const SNAPSHOT_VERSION = 2;

type Snapshot = Record<string, unknown>;

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function readSnapshot(storageKey: string): Snapshot | null {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const obj = parsed as Record<string, unknown>;
    // v2: { v: 2, s: {...} }. Anything else is a legacy partial snapshot,
    // which is still safe to merge on top of the defaults.
    if (obj.v === SNAPSHOT_VERSION && obj.s && typeof obj.s === "object") {
      return obj.s as Snapshot;
    }
    return obj;
  } catch {
    return null;
  }
}

// Note: the initial URL cannot be used to detect an explicit link — the
// router canonicalises the query string (adding every default key) before
// route code runs, so an "explicit params" test against the URL always
// passes. Instead, saved state is restored only when the state we arrive
// with is exactly the route defaults.
function isAtDefaults(search: Record<string, unknown>, defaults: Record<string, unknown>) {
  for (const k of Object.keys(defaults)) {
    const a = search[k];
    const b = defaults[k];
    if (a === b) continue;
    if (a == null && b == null) continue;
    return false;
  }
  return true;
}

export function usePersistedSearch<T extends Record<string, unknown>>(
  storageKey: string,
  search: T,
  navigatePath: string,
  defaults: Partial<T>,
) {
  const navigate = useNavigate({ from: navigatePath as never });
  const startedRef = useRef(false);
  const [hydrated, setHydrated] = useState(false);

  useIsomorphicLayoutEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    try {
      const keys = Array.from(new Set([...Object.keys(search), ...Object.keys(defaults)]));
      // An explicit link (shared URL, deep link) always beats saved state.
      // On a full page load, look at the URL the document was opened with —
      // the router canonicalises the live URL to include every default key.
      // On a client-side navigation, "no explicit params" means the arriving
      // state matches the defaults.
      // Anything other than the plain defaults is a deliberate link or an
      // in-session state, and always wins over the saved snapshot.
      const hasExplicit = !isAtDefaults(search, defaults as Record<string, unknown>);
      if (hasExplicit) {
        setHydrated(true);
        return;
      }

      const stored = readSnapshot(storageKey);
      if (!stored || Object.keys(stored).length === 0) {
        setHydrated(true);
        return;
      }
      const patch: Snapshot = {};
      for (const k of keys) {
        if (k in stored) patch[k] = stored[k];
      }
      if (Object.keys(patch).length === 0) {
        setHydrated(true);
        return;
      }
      const result = navigate({
        search: (prev: Record<string, unknown>) => ({ ...prev, ...patch }),
        replace: true,
      } as never) as unknown as Promise<void> | void;
      if (result && typeof (result as Promise<void>).then === "function") {
        (result as Promise<void>).then(
          () => setHydrated(true),
          () => setHydrated(true),
        );
      } else {
        setHydrated(true);
      }
    } catch {
      setHydrated(true);
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (typeof window === "undefined") return;
    try {
      const snapshot: Snapshot = {};
      for (const [k, v] of Object.entries(search)) {
        if (v === undefined) continue;
        snapshot[k] = v;
      }
      window.localStorage.setItem(storageKey, JSON.stringify({ v: SNAPSHOT_VERSION, s: snapshot }));
    } catch {
      /* ignore */
    }
    // `defaults` is intentionally not a dependency: a full snapshot is
    // stored regardless of which values match a default.
  }, [storageKey, search, hydrated]);

  return { hydrated };
}
