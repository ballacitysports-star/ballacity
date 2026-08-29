import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type PublicAvatar = {
  name: string | null;
  initials: string | null;
  avatarUrl: string | null;
};

/**
 * Shared, batched cache of public avatar data (photo + initials + name) keyed by
 * auth user id. Lets any surface in the app show a user's real profile photo
 * without each component writing its own query.
 */
const cache = new Map<string, PublicAvatar>();
const pending = new Map<string, Promise<void>>();
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
  const { data } = await supabase
    .from("profiles")
    .select("id, display_name, avatar_initials, avatar_url")
    .in("id", ids);
  const rows = (data ?? []) as Array<{
    id: string;
    display_name: string | null;
    avatar_initials: string | null;
    avatar_url: string | null;
  }>;
  ids.forEach((id) => {
    const row = rows.find((r) => r.id === id);
    cache.set(id, {
      name: row?.display_name ?? null,
      initials: row?.avatar_initials ?? null,
      avatarUrl: row?.avatar_url ?? null,
    });
    pending.delete(id);
  });
  notify();
}

function request(id: string) {
  if (cache.has(id) || pending.has(id)) return;
  queue.add(id);
  const p = new Promise<void>((resolve) => {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      void flush().finally(resolve);
    }, 30);
  });
  pending.set(id, p);
}

/** Drops cached entries so a freshly-saved photo is picked up app-wide. */
export function invalidateUserAvatar(userId?: string | null) {
  if (userId) cache.delete(userId);
  else cache.clear();
  notify();
}

export function useUserAvatar(userId?: string | null): PublicAvatar | undefined {
  const [value, setValue] = useState<PublicAvatar | undefined>(() =>
    userId ? cache.get(userId) : undefined,
  );

  useEffect(() => {
    if (!userId) {
      setValue(undefined);
      return;
    }
    const sync = () => setValue(cache.get(userId));
    listeners.add(sync);
    request(userId);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, [userId]);

  return value;
}
