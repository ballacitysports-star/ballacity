import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";

/**
 * Persist a route's validated search params to localStorage so that
 * navigating away and back (or opening the tab fresh with no query
 * string) restores the last-applied FilterBar selections. Refresh with
 * a populated URL already works via TanStack's search validation; this
 * hook covers the "empty URL" case.
 *
 * - On mount: if the current `search` equals `defaults` (i.e. the user
 *   didn't arrive via a filtered URL), replace the URL with the stored
 *   snapshot for `storageKey`.
 * - On change: writes the current `search` back to `storageKey`,
 *   stripping keys whose value equals `defaults[key]`.
 *
 * We compare against `defaults` rather than `window.location.search`
 * length because TanStack's validated schemas canonicalise URLs to
 * include every field, so a "fresh" navigation still shows a non-empty
 * query string full of default values.
 */
export function usePersistedSearch<T extends Record<string, unknown>>(
  storageKey: string,
  search: T,
  navigatePath: string,
  defaults: T,
) {
  const navigate = useNavigate({ from: navigatePath as never });
  const hydratedRef = useRef(false);

  const isAtDefaults = (obj: Record<string, unknown>) => {
    for (const k of Object.keys(defaults)) {
      const a = obj[k];
      const b = (defaults as Record<string, unknown>)[k];
      if (a === b) continue;
      if (a == null && b == null) continue;
      return false;
    }
    return true;
  };

  useEffect(() => {
    if (hydratedRef.current) return;
    hydratedRef.current = true;
    if (typeof window === "undefined") return;
    try {
      if (!isAtDefaults(search)) return;
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const stored = JSON.parse(raw) as Record<string, unknown>;
      if (!stored || typeof stored !== "object") return;
      if (Object.keys(stored).length === 0) return;
      navigate({
        search: (prev: Record<string, unknown>) => ({ ...prev, ...stored }),
        replace: true,
      } as never);
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!hydratedRef.current) return;
    if (typeof window === "undefined") return;
    try {
      const trimmed: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(search)) {
        if (v === undefined || v === null || v === "") continue;
        if ((defaults as Record<string, unknown>)[k] === v) continue;
        trimmed[k] = v;
      }
      if (Object.keys(trimmed).length === 0) {
        window.localStorage.removeItem(storageKey);
      } else {
        window.localStorage.setItem(storageKey, JSON.stringify(trimmed));
      }
    } catch {
      /* ignore */
    }
  }, [storageKey, search, defaults]);
}
