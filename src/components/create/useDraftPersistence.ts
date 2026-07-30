import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Persist a JSON-serializable draft to localStorage with debounced writes.
 * Returns a `clear()` fn to remove the draft on submit success, plus a
 * status/savedAt pair shaped for <SaveStatus savedLabel="Draft saved" />.
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
  const touched = useRef(false);
  const [status, setStatus] = useState<"idle" | "dirty" | "saved">("idle");
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (timer.current) clearTimeout(timer.current);
    if (!touched.current) {
      touched.current = true;
      return;
    }
    setStatus("dirty");
    timer.current = setTimeout(() => {
      try {
        window.localStorage.setItem(key, JSON.stringify(value));
        setStatus("saved");
        setSavedAt(Date.now());
      } catch {
        // Ignore quota errors — draft persistence is best-effort.
      }
    }, delay);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [key, value, delay]);

  const clear = useCallback(() => {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore.
    }
    touched.current = false;
    setStatus("idle");
    setSavedAt(null);
  }, [key]);

  return {
    clear,
    status,
    savedAt,
    reason: undefined as string | undefined,
    error: undefined as string | undefined,
    retry: () => {},
  };
}
