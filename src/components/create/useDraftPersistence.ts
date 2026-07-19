import { useEffect, useRef } from "react";

/**
 * Persist a JSON-serializable draft to localStorage with debounced writes.
 * Returns a `clear()` fn to remove the draft on submit success.
 * Call `loadDraft(key)` at mount time to hydrate initial state.
 */
export function loadDraft<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function useDraftPersistence<T>(key: string, value: T, delay = 400) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
      } catch {
        // Ignore quota errors — draft persistence is best-effort.
      }
    }, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, value, delay]);

  return {
    clear: () => {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Ignore.
      }
    },
  };
}
