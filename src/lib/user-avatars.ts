import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type AvatarStatus = "loading" | "ready" | "error";

export type PublicAvatar = {
  name: string | null;
  initials: string | null;
  avatarUrl: string | null;
  /** True when the person has a photo but keeps it hidden from this viewer. */
  hidden: boolean;
};

export type AvatarLookup = PublicAvatar & { status: AvatarStatus; retry: () => void };

/**
 * Shared, batched cache of avatar data (photo + initials + name) keyed by auth
 * user id. Reads go through the `visible_avatars` database function so each
 * person's avatar privacy choice is enforced server-side — the photo URL is
 * only returned to viewers allowed to see it.
 */
const cache = new Map<string, PublicAvatar>();
/** When each cached entry was fetched, for TTL expiry across sessions. */
const fetchedAt = new Map<string, number>();
const failed = new Set<string>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

/**
 * Two-tier fetch queue. Rows that are on screen (or about to scroll into it)
 * go into `highQueue` and are always fetched first; speculative prefetches for
 * far-away rows wait in `lowQueue`. On slow networks this keeps the batch the
 * user is actually looking at from queueing behind hundreds of off-screen ids.
 */
export type AvatarPriority = "high" | "low";

let highQueue = new Set<string>();
let lowQueue = new Set<string>();
/** Max ids per RPC round-trip, so a huge low-priority list can't block a batch. */
const MAX_BATCH = 48;
let flushTimer: ReturnType<typeof setTimeout> | null = null;


function notify() {
  listeners.forEach((l) => l());
}

/* ------------------------------------------------------------------ *
 * Cross-session persistence
 *
 * Avatar results are viewer-specific (privacy rules depend on who is
 * asking), so the stored snapshot is stamped with the viewer's id and
 * dropped whenever the signed-in account changes. Entries expire after
 * TTL_MS so photo/privacy changes are picked up on a later visit.
 * ------------------------------------------------------------------ */

const STORE_KEY = "ballacity.avatarCache.v1";
const TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
const MAX_ENTRIES = 400;

type StoredEntry = { n: string | null; i: string | null; u: string | null; h: boolean; t: number };
type StoredShape = { viewer: string | null; entries: Record<string, StoredEntry> };

let hydrated = false;
let viewerId: string | null = null;
let viewerChecked = false;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function isFresh(t: number) {
  return Date.now() - t < TTL_MS;
}

function readStore(): StoredShape | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredShape;
    if (!parsed || typeof parsed !== "object" || !parsed.entries) return null;
    return parsed;
  } catch {
    return null;
  }
}

function persist() {
  if (typeof window === "undefined") return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      // Keep the newest entries only, so the snapshot can't grow unbounded.
      const rows = Array.from(cache.entries())
        .map(([id, v]) => [id, v, fetchedAt.get(id) ?? 0] as const)
        .filter(([, , t]) => isFresh(t))
        .sort((a, b) => b[2] - a[2])
        .slice(0, MAX_ENTRIES);

      const entries: Record<string, StoredEntry> = {};
      rows.forEach(([id, v, t]) => {
        entries[id] = { n: v.name, i: v.initials, u: v.avatarUrl, h: v.hidden, t };
      });

      const payload: StoredShape = { viewer: viewerId, entries };
      window.localStorage.setItem(STORE_KEY, JSON.stringify(payload));
    } catch {
      // Storage full or unavailable — the in-memory cache still works.
    }
  }, 400);
}

function clearStore() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
}

/** Loads the persisted snapshot (once) and verifies it belongs to this viewer. */
function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;

  const stored = readStore();
  if (stored) {
    Object.entries(stored.entries).forEach(([id, e]) => {
      if (!e || !isFresh(e.t)) return;
      cache.set(id, { name: e.n, initials: e.i, avatarUrl: e.u, hidden: !!e.h });
      fetchedAt.set(id, e.t);
    });
  }

  if (!viewerChecked) {
    viewerChecked = true;
    void supabase.auth
      .getUser()
      .then(({ data }) => {
        const me = data.user?.id ?? null;
        viewerId = me;
        if (stored && stored.viewer !== me) {
          // Different account (or signed out vs in) — privacy answers differ.
          cache.clear();
          fetchedAt.clear();
          failed.clear();
          warmed.clear();
          clearStore();
          notify();
        } else {
          persist();
        }
      })
      .catch(() => {
        /* offline — keep the snapshot we already hydrated */
      });
  }
}

if (typeof window !== "undefined") {
  // Sign-in/sign-out changes who may see which photos: start clean.
  supabase.auth.onAuthStateChange((event, session) => {
    if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
    const next = session?.user?.id ?? null;
    if (next === viewerId) return;
    viewerId = next;
    cache.clear();
    fetchedAt.clear();
    failed.clear();
    warmed.clear();
    clearStore();
    notify();
  });
}


/** Pulls the next batch: everything urgent first, then filler from the low tier. */
function takeBatch(): string[] {
  const batch: string[] = [];
  for (const id of highQueue) {
    if (batch.length >= MAX_BATCH) break;
    batch.push(id);
  }
  batch.forEach((id) => highQueue.delete(id));
  if (batch.length < MAX_BATCH) {
    const filler: string[] = [];
    for (const id of lowQueue) {
      if (batch.length + filler.length >= MAX_BATCH) break;
      filler.push(id);
    }
    filler.forEach((id) => lowQueue.delete(id));
    batch.push(...filler);
  }
  return batch;
}

function schedule(delay = 30) {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), delay);
}

async function flush() {
  flushTimer = null;
  const ids = takeBatch();
  if (!ids.length) return;
  ids.forEach((id) => inflight.add(id));
  // Anything left over goes out in the next round-trip, high tier first again.
  if (highQueue.size || lowQueue.size) schedule(highQueue.size ? 0 : 120);

  const { data, error } = await supabase.rpc("visible_avatars" as never, {
    _ids: ids,
  } as never);

  ids.forEach((id) => inflight.delete(id));

  if (error) {
    // Keep any previously-good value; mark the miss so the UI can offer a retry.
    ids.forEach((id) => {
      if (!cache.has(id)) failed.add(id);
    });
    notify();
    return;
  }

  const rows = (data ?? []) as Array<{
    id: string;
    display_name: string | null;
    avatar_initials: string | null;
    avatar_url: string | null;
    avatar_hidden: boolean | null;
  }>;

  const now = Date.now();
  ids.forEach((id) => {
    const row = rows.find((r) => r.id === id);
    failed.delete(id);
    cache.set(id, {
      name: row?.display_name ?? null,
      initials: row?.avatar_initials ?? null,
      avatarUrl: row?.avatar_url ?? null,
      hidden: !!row?.avatar_hidden,
    });
    fetchedAt.set(id, now);
  });
  persist();
  notify();
}

function request(id: string, priority: AvatarPriority = "high") {
  hydrate();
  if (cache.has(id)) {
    if (isFresh(fetchedAt.get(id) ?? 0)) return;
    // Expired snapshot: drop it and fetch again.
    cache.delete(id);
    fetchedAt.delete(id);
  }
  if (inflight.has(id)) return;
  if (priority === "high") {
    if (highQueue.has(id)) return;
    lowQueue.delete(id);
    highQueue.add(id);
    schedule(30);
    return;
  }
  if (highQueue.has(id) || lowQueue.has(id)) return;
  lowQueue.add(id);
  // Speculative work waits a beat so on-screen rows win the first round-trip.
  if (!flushTimer) schedule(150);
}

/**
 * Bumps ids to the front of the fetch queue — used when a row is about to
 * enter the viewport, so its photo loads before rows still far down the list.
 */
export function promoteUserAvatars(userIds: Array<string | null | undefined>) {
  userIds.forEach((id) => {
    if (typeof id === "string" && id) request(id, "high");
  });
}


/** Drops cached entries so a freshly-saved photo or privacy change is picked up app-wide. */
export function invalidateUserAvatar(userId?: string | null) {
  if (userId) {
    cache.delete(userId);
    fetchedAt.delete(userId);
    failed.delete(userId);
    persist();
  } else {
    cache.clear();
    fetchedAt.clear();
    failed.clear();
    warmed.clear();
    clearStore();
  }
  notify();
}

/** Photo URLs already handed to the browser so it can warm its own image cache. */
const warmed = new Set<string>();

function warmImage(url: string | null) {
  if (!url || warmed.has(url) || typeof window === "undefined") return;
  warmed.add(url);
  const img = new Image();
  img.decoding = "async";
  img.src = url;
}

/**
 * Warms the avatar cache (and the browser image cache) for a batch of user ids
 * ahead of render, so photos are already decoded by the time a notification or
 * message row scrolls into view. Safe to call repeatedly — already-known ids and
 * already-warmed URLs are skipped.
 */
export function prefetchUserAvatars(
  userIds: Array<string | null | undefined>,
  priority: AvatarPriority = "low",
) {
  const ids = Array.from(
    new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0)),
  );
  if (!ids.length) return;
  hydrate();

  // Photos we already know about can be handed to the browser immediately.
  const pending = ids.filter((id) => {
    const known = cache.get(id);
    if (known) {
      warmImage(known.avatarUrl);
      return false;
    }
    return !failed.has(id);
  });

  if (!pending.length) return;

  const remaining = new Set(pending);
  const onResolved = () => {
    remaining.forEach((id) => {
      const known = cache.get(id);
      if (known) {
        warmImage(known.avatarUrl);
        remaining.delete(id);
      } else if (failed.has(id)) {
        remaining.delete(id);
      }
    });
    if (!remaining.size) listeners.delete(onResolved);
  };
  listeners.add(onResolved);
  pending.forEach((id) => request(id, priority));
}


/** Prefetches avatars for a list of ids whenever that list changes. */
export function usePrefetchUserAvatars(
  userIds: Array<string | null | undefined>,
  priority: AvatarPriority = "low",
) {
  const key = userIds.filter(Boolean).join(",");
  useEffect(() => {
    prefetchUserAvatars(userIds, priority);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, priority]);
}

/**
 * Viewport-priority prefetching. Attach the returned ref to each row along
 * with the user ids it shows; rows within `rootMargin` of the viewport get
 * their avatars promoted to the front of the fetch queue, so on slow networks
 * the photos you are about to see load before the rest of the list.
 */
export function useAvatarViewportPriority(rootMargin = "600px 0px") {
  const idsByEl = useRef(new WeakMap<Element, string[]>());
  const observerRef = useRef<IntersectionObserver | null>(null);

  const getObserver = () => {
    if (typeof window === "undefined" || typeof IntersectionObserver === "undefined") return null;
    if (!observerRef.current) {
      observerRef.current = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (!entry.isIntersecting) return;
            const ids = idsByEl.current.get(entry.target);
            if (ids?.length) {
              prefetchUserAvatars(ids, "high");
              promoteUserAvatars(ids);
            }
            observerRef.current?.unobserve(entry.target);
          });
        },
        { rootMargin },
      );
    }
    return observerRef.current;
  };

  useEffect(() => {
    return () => {
      observerRef.current?.disconnect();
      observerRef.current = null;
    };
  }, [rootMargin]);

  /** `ref={rowRef([userId])}` on the row element. */
  const rowRef = useCallback(
    (ids: Array<string | null | undefined>) => (el: Element | null) => {
      if (!el) return;
      const clean = ids.filter((id): id is string => typeof id === "string" && !!id);
      if (!clean.length) return;
      idsByEl.current.set(el, clean);
      getObserver()?.observe(el);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rootMargin],
  );

  return rowRef;
}


export function useUserAvatar(userId?: string | null): AvatarLookup {
  const [, bump] = useState(0);

  useEffect(() => {
    if (!userId) return;
    const sync = () => bump((n) => n + 1);
    listeners.add(sync);
    request(userId);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, [userId]);

  const value = userId ? cache.get(userId) : undefined;
  const status: AvatarStatus = !userId
    ? "ready"
    : value
      ? "ready"
      : failed.has(userId)
        ? "error"
        : "loading";

  return {
    name: value?.name ?? null,
    initials: value?.initials ?? null,
    avatarUrl: value?.avatarUrl ?? null,
    hidden: value?.hidden ?? false,
    status,
    retry: () => {
      if (!userId) return;
      failed.delete(userId);
      cache.delete(userId);
      request(userId);
      notify();
    },
  };
}
