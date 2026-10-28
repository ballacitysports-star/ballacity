import { useCallback, useEffect, useRef, useState } from "react";

export type AutosaveStatus = "idle" | "dirty" | "saving" | "saved" | "invalid" | "error";

export type AutosaveState = {
  status: AutosaveStatus;
  /** Reason the value can't be saved (when status === "invalid"). */
  reason: string | null;
  /** Error message from the last failed save (when status === "error"). */
  error: string | null;
  /** Timestamp (ms) of the last successful save, or null. */
  savedAt: number | null;
  /**
   * Force a save now (bypasses the debounce). Safe to call repeatedly.
   * Resolves true when nothing is left unsaved, false when the latest value was
   * refused (invalid) or failed to save.
   */
  flush: () => Promise<boolean>;
  /** Retry after an error. */
  retry: () => Promise<void>;
};

type Options<T> = {
  /** The value to persist. Compared by JSON fingerprint. */
  value: T;
  /** Persists the value. Throwing marks the save as failed. */
  save: (value: T) => Promise<void> | void;
  /** Return a human-readable reason to block saving, or null when valid. */
  validate?: (value: T) => string | null;
  /** Debounce in ms (default 800). */
  delay?: number;
  /** When false, nothing is tracked or saved (e.g. still loading). */
  enabled?: boolean;
};

function fingerprint(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return String(Date.now());
  }
}

/**
 * Debounced auto-save with fingerprint de-duplication, single-flight writes,
 * and stale-response protection.
 *
 * The first fingerprint seen while `enabled` becomes the baseline, so hydrating
 * a form from the server never triggers a write.
 */
export function useAutosave<T>({
  value,
  save,
  validate,
  delay = 800,
  enabled = true,
}: Options<T>): AutosaveState {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const saveRef = useRef(save);
  saveRef.current = save;
  const validateRef = useRef(validate);
  validateRef.current = validate;
  const valueRef = useRef(value);
  valueRef.current = value;

  const baselineRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlightRef = useRef<Promise<void> | null>(null);
  const seqRef = useRef(0);
  // Whether the most recent attempt left the latest value saved.
  const okRef = useRef(true);

  const runSave = useCallback(async (): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current;

    const snapshot = valueRef.current;
    const fp = fingerprint(snapshot);
    if (fp === baselineRef.current) {
      okRef.current = true;
      return;
    }

    const invalid = validateRef.current?.(snapshot) ?? null;
    if (invalid) {
      okRef.current = false;
      setReason(invalid);
      setStatus("invalid");
      return;
    }
    setReason(null);

    const seq = ++seqRef.current;
    setStatus("saving");

    const promise = (async () => {
      try {
        await saveRef.current(snapshot);
        if (seq !== seqRef.current) return; // a newer save superseded this one
        baselineRef.current = fp;
        okRef.current = true;
        setError(null);
        setSavedAt(Date.now());
        // Anything typed while saving keeps us dirty; the debounce picks it up.
        setStatus(fingerprint(valueRef.current) === fp ? "saved" : "dirty");
      } catch (e) {
        if (seq !== seqRef.current) return;
        okRef.current = false;
        setError(e instanceof Error ? e.message : "Couldn't save");
        setStatus("error");
      } finally {
        inFlightRef.current = null;
      }
    })();

    inFlightRef.current = promise;
    return promise;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const fp = fingerprint(value);
    if (baselineRef.current === null) {
      baselineRef.current = fp;
      return;
    }
    if (fp === baselineRef.current) return;

    const invalid = validateRef.current?.(value) ?? null;
    if (invalid) {
      setReason(invalid);
      setStatus("invalid");
    } else {
      setReason(null);
      setStatus((s) => (s === "saving" ? s : "dirty"));
    }

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void runSave();
    }, delay);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [fingerprint(value), enabled, delay, runSave]);

  // Flush pending work when the component unmounts or the tab is hidden.
  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (document.visibilityState === "hidden") void runSave();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      if (timerRef.current) clearTimeout(timerRef.current);
      void runSave();
    };
  }, [enabled, runSave]);

  const flush = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    await runSave();
    return okRef.current;
  }, [runSave]);

  const retry = useCallback(async () => {
    await flush();
  }, [flush]);

  return { status, reason, error, savedAt, flush, retry };
}
