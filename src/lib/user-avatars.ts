import { useEffect, useState } from "react";
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
const failed = new Set<string>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();

let queue = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  listeners.forEach((l) => l());
}

async function flush() {
  flushTimer = null;
  const ids = Array.from(queue);
  queue = new Set();
  if (!ids.length) return;
  ids.forEach((id) => inflight.add(id));

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

  ids.forEach((id) => {
    const row = rows.find((r) => r.id === id);
    failed.delete(id);
    cache.set(id, {
      name: row?.display_name ?? null,
      initials: row?.avatar_initials ?? null,
      avatarUrl: row?.avatar_url ?? null,
      hidden: !!row?.avatar_hidden,
    });
  });
  notify();
}

function request(id: string) {
  if (cache.has(id) || inflight.has(id) || queue.has(id)) return;
  queue.add(id);
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => void flush(), 30);
}

/** Drops cached entries so a freshly-saved photo or privacy change is picked up app-wide. */
export function invalidateUserAvatar(userId?: string | null) {
  if (userId) {
    cache.delete(userId);
    failed.delete(userId);
  } else {
    cache.clear();
    failed.clear();
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
export function prefetchUserAvatars(userIds: Array<string | null | undefined>) {
  const ids = Array.from(
    new Set(userIds.filter((id): id is string => typeof id === "string" && id.length > 0)),
  );
  if (!ids.length) return;

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
  pending.forEach(request);
}

/** Prefetches avatars for a list of ids whenever that list changes. */
export function usePrefetchUserAvatars(userIds: Array<string | null | undefined>) {
  const key = userIds.filter(Boolean).join(",");
  useEffect(() => {
    prefetchUserAvatars(userIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
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
