import { useEffect, useRef } from "react";

/**
 * Persist window scroll position (and optionally an infinite-list "pages"
 * counter) per key across hard refresh, tab suspend/reopen, and browser
 * back/forward. TanStack Router's own `scrollRestoration` covers back/
 * forward for cached matches — this hook adds refresh/reopen support and
 * repairs paginated lists so the saved offset is actually reachable.
 */
export interface UseScrollRestoreOptions {
  /** Current visible-page count for infinite lists. Persisted alongside y. */
  pages?: number;
  /** Called once on restore so lists can rehydrate their page count. */
  onRestorePages?: (pages: number) => void;
  /** Disable persistence entirely (e.g. when list is empty / loading). */
  enabled?: boolean;
}

interface Entry {
  y: number;
  pages?: number;
  ts: number;
}

const PREFIX = "openrun:scroll:";
const TTL_MS = 30 * 60 * 1000; // 30 min
const RESTORE_MAX_MS = 1500;
const FRESH_MS = 5000;

function storageKey(key: string) {
  return `${PREFIX}${key}`;
}

function readEntry(key: string): Entry | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.sessionStorage.getItem(storageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Entry;
    if (!parsed || typeof parsed.y !== "number") return null;
    if (Date.now() - parsed.ts > TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEntry(key: string, entry: Entry) {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(storageKey(key), JSON.stringify(entry));
  } catch {
    /* ignore */
  }
}

export function clearScrollRestore(key: string) {
  try {
    if (typeof window === "undefined") return;
    window.sessionStorage.removeItem(storageKey(key));
  } catch {
    /* ignore */
  }
}

function shouldRestore(entry: Entry): boolean {
  if (typeof window === "undefined") return false;
  // Always restore if the entry is very recent (covers tab reopen and
  // scenarios where navigation type isn't classified as reload).
  if (Date.now() - entry.ts < FRESH_MS) return true;
  try {
    const nav = performance.getEntriesByType("navigation")[0] as
      PerformanceNavigationTiming | undefined;
    const t = nav?.type;
    return t === "reload" || t === "back_forward";
  } catch {
    return true;
  }
}

export function useScrollRestore(key: string, opts: UseScrollRestoreOptions = {}) {
  const { pages, onRestorePages, enabled = true } = opts;
  const pagesRef = useRef<number | undefined>(pages);
  pagesRef.current = pages;
  const restoredRef = useRef(false);

  // Restore on mount.
  useEffect(() => {
    if (!enabled) return;
    if (restoredRef.current) return;
    if (typeof window === "undefined") return;

    const entry = readEntry(key);
    if (!entry || !shouldRestore(entry)) {
      restoredRef.current = true;
      return;
    }

    if (typeof entry.pages === "number" && onRestorePages) {
      onRestorePages(entry.pages);
    }

    let cancelled = false;
    let userScrolled = false;
    const start = performance.now();
    const targetY = entry.y;

    const onUserScroll = () => {
      userScrolled = true;
    };
    // Only treat a real user gesture as an abort — programmatic scrolls
    // from our own rAF loop don't fire these events.
    window.addEventListener("wheel", onUserScroll, { passive: true, once: true });
    window.addEventListener("touchmove", onUserScroll, { passive: true, once: true });
    window.addEventListener("keydown", onUserScroll, { once: true });

    const tick = () => {
      if (cancelled || userScrolled) return;
      const doc = document.documentElement;
      const reachable = doc.scrollHeight - window.innerHeight;
      if (reachable >= targetY - 1) {
        window.scrollTo({ top: targetY, behavior: "instant" as ScrollBehavior });
        restoredRef.current = true;
        return;
      }
      if (performance.now() - start > RESTORE_MAX_MS) {
        // Best-effort: scroll as close as we can.
        window.scrollTo({
          top: Math.min(targetY, reachable),
          behavior: "instant" as ScrollBehavior,
        });
        restoredRef.current = true;
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);

    return () => {
      cancelled = true;
      window.removeEventListener("wheel", onUserScroll);
      window.removeEventListener("touchmove", onUserScroll);
      window.removeEventListener("keydown", onUserScroll);
    };
  }, [key, enabled, onRestorePages]);

  // Persist scroll (rAF-coalesced) + flush on hide/pagehide.
  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined") return;

    let rafPending = false;
    const flush = () => {
      rafPending = false;
      writeEntry(key, {
        y: window.scrollY,
        pages: pagesRef.current,
        ts: Date.now(),
      });
    };
    const onScroll = () => {
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(flush);
    };
    const onHide = () => flush();
    const onVis = () => {
      if (document.visibilityState === "hidden") flush();
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVis);
      flush();
    };
  }, [key, enabled]);
}
