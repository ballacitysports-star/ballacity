import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toAppPath } from "@/lib/deep-links";
import { prefetchUserAvatars } from "@/lib/user-avatars";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Best-effort "who is this about?" for a notification, so alert rows can show a
 * face instead of only a category icon. Notifications don't carry an actor
 * column, so we read the person out of the deep link the alert already points
 * at (profile links, invite `from=` params, or the other side of a chat).
 */
export function actorIdFromLink(link: string | null | undefined): {
  userId: string | null;
  conversationId: string | null;
} {
  const path = toAppPath(link ?? null);
  if (!path) return { userId: null, conversationId: null };

  const [pathname, query = ""] = path.split("?");
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] === "players" && segments[1] && UUID.test(segments[1])) {
    return { userId: segments[1], conversationId: null };
  }

  const from = new URLSearchParams(query).get("from");
  if (from && UUID.test(from)) return { userId: from, conversationId: null };

  if (segments[0] === "messages" && segments[1] && UUID.test(segments[1])) {
    return { userId: null, conversationId: segments[1] };
  }

  return { userId: null, conversationId: null };
}

/** conversationId -> other participant id (null when unknown). */
const convCache = new Map<string, string | null>();
const convListeners = new Set<() => void>();
let convQueue = new Set<string>();
let convTimer: ReturnType<typeof setTimeout> | null = null;

async function flushConvs() {
  convTimer = null;
  const ids = Array.from(convQueue);
  convQueue = new Set();
  if (!ids.length) return;
  const { data: auth } = await supabase.auth.getUser();
  const me = auth.user?.id ?? null;
  const { data } = await supabase
    .from("conversation_participants" as any)
    .select("conversation_id, user_id")
    .in("conversation_id", ids);
  const rows = (data ?? []) as unknown as Array<{ conversation_id: string; user_id: string }>;
  ids.forEach((id) => {
    const other = rows.find((r) => r.conversation_id === id && r.user_id !== me);
    convCache.set(id, other?.user_id ?? null);
  });
  convListeners.forEach((l) => l());
}

function requestConv(id: string) {
  if (convCache.has(id) || convQueue.has(id)) return;
  convQueue.add(id);
  if (convTimer) clearTimeout(convTimer);
  convTimer = setTimeout(() => void flushConvs(), 40);
}

/**
 * Resolves the auth user id a notification is about, following chat links to
 * the other participant. Returns `null` when the alert isn't person-shaped
 * (payments, reminders, system messages) so callers can keep the icon.
 */
/**
 * Warms avatars for a whole page of notifications up front — including the ones
 * still below the fold — so faces are already decoded when rows scroll in.
 */
export function usePrefetchNotificationActors(notifications: Array<{ link?: string | null }>) {
  const key = notifications.map((n) => n.link ?? "").join("|");

  useEffect(() => {
    const direct: string[] = [];
    const convs: string[] = [];
    notifications.forEach((n) => {
      const { userId, conversationId } = actorIdFromLink(n.link);
      if (userId) direct.push(userId);
      else if (conversationId) convs.push(conversationId);
    });

    prefetchUserAvatars(direct);
    if (!convs.length) return;

    const pending = new Set(convs);
    const resolve = () => {
      const found: string[] = [];
      pending.forEach((id) => {
        if (!convCache.has(id)) return;
        const other = convCache.get(id);
        if (other) found.push(other);
        pending.delete(id);
      });
      if (found.length) prefetchUserAvatars(found);
      if (!pending.size) convListeners.delete(resolve);
    };
    convListeners.add(resolve);
    convs.forEach(requestConv);
    resolve();

    return () => {
      convListeners.delete(resolve);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

export function useNotificationActorId(n: { link?: string | null }): string | null {
  const { userId, conversationId } = actorIdFromLink(n.link);
  const [, bump] = useState(0);

  useEffect(() => {
    if (!conversationId) return;
    const sync = () => bump((x) => x + 1);
    convListeners.add(sync);
    requestConv(conversationId);
    return () => {
      convListeners.delete(sync);
    };
  }, [conversationId]);

  if (userId) return userId;
  if (conversationId) return convCache.get(conversationId) ?? null;
  return null;
}
