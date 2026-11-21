import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { isAllowed } from "@/lib/notification-prefs";
import { openDeepLink } from "@/lib/deep-links";

export type Notification = {
  id: string;
  user_id: string;
  type: string;
  title: string;
  body: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export async function createNotification(input: {
  user_id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
}) {
  try {
    const { createNotificationForUser } = await import("@/lib/notifications.functions");
    await createNotificationForUser({ data: input });
  } catch (e: any) {
    console.warn("notification insert failed", e?.message ?? e);
  }
  // The push (background/closed-app delivery) is sent by createNotificationForUser from the stored notification.
}

export async function listMyNotifications(): Promise<Notification[]> {
  const { data, error } = await supabase
    .from("notifications" as any)
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as unknown as Notification[];
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase
    .from("notifications" as any)
    .update({ read_at: new Date().toISOString() } as any)
    .eq("id", id);
  if (error) throw error;
}

export async function markNotificationUnread(id: string) {
  const { error } = await supabase
    .from("notifications" as any)
    .update({ read_at: null } as any)
    .eq("id", id);
  if (error) throw error;
}

export async function deleteNotification(id: string) {
  const { error } = await supabase
    .from("notifications" as any)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

/**
 * Marks every unread notification of the signed-in user as read, not just the rows on screen: one update on the
 * server, filtered by user and `read_at is null`. RLS ("Users update own notifications") limits it to the caller's
 * own rows. Returns how many rows it changed; throws the PostgREST error so the caller can word it.
 */
export async function markAllNotificationsRead(userId?: string): Promise<number> {
  let uid = userId;
  if (!uid) {
    const { data: u } = await supabase.auth.getUser();
    uid = u.user?.id;
  }
  if (!uid) throw new Error("AUTH_REQUIRED");
  const { error, count } = await supabase
    .from("notifications" as any)
    .update({ read_at: new Date().toISOString() } as any, { count: "exact" })
    .eq("user_id", uid)
    .is("read_at", null);
  if (error) throw error;
  return count ?? 0;
}

/** The signed-in user's true number of unread notifications, counted on the server (not the loaded rows). */
export async function countUnreadNotifications(
  userId: string,
  opts: { excludeType?: string } = {},
): Promise<number> {
  let q = supabase
    .from("notifications" as any)
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  if (opts.excludeType) q = q.neq("type", opts.excludeType);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

/**
 * The signed-in user's unread notification count from the server, kept fresh by realtime, with `refresh` and
 * `setCount` so a screen that changes read state can update it at once. `count` is null while unknown (not
 * answered yet, or the first read failed).
 *
 * `scope` keeps each caller's realtime channel separate: two components asking
 * for the same channel name at once would subscribe to it twice.
 */
export function useUnreadNotificationCountState(
  scope = "",
  opts: { excludeType?: string } = {},
): { count: number | null; refresh: () => void; setCount: (next: number | null) => void } {
  const excludeType = opts.excludeType;
  const { user } = useAuth();
  // null until the server has answered: "unknown" is not "nothing unread".
  const [count, setCount] = useState<number | null>(null);
  const fetchRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!user) {
      setCount(0);
      fetchRef.current = () => {};
      return;
    }
    let cancelled = false;
    setCount(null);
    const fetchCount = async () => {
      try {
        const c = await countUnreadNotifications(user.id, { excludeType });
        if (!cancelled) setCount(c);
      } catch {
        // Keep the last known count (or null, "unknown"): a failed read is not "nothing unread".
      }
    };
    fetchRef.current = () => void fetchCount();
    fetchCount();

    const channel = supabase
      .channel(`notif-count-${scope}${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        fetchCount,
      )
      .subscribe();
    return () => {
      cancelled = true;
      fetchRef.current = () => {};
      supabase.removeChannel(channel);
    };
  }, [user?.id, excludeType]);

  const refresh = useCallback(() => fetchRef.current(), []);
  return { count, refresh, setCount };
}

export function useUnreadNotificationCount(scope = "", opts: { excludeType?: string } = {}) {
  return useUnreadNotificationCountState(scope, opts).count ?? 0;
}

export function useUnreadMessageCount() {
  const { user } = useAuth();
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!user) {
      setCount(0);
      return;
    }
    let cancelled = false;
    const fetchCount = async () => {
      const { count: c } = await supabase
        .from("notifications" as any)
        .select("*", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("type", "message")
        .is("read_at", null);
      if (!cancelled) setCount(c ?? 0);
    };
    fetchCount();

    const channel = supabase
      .channel(`notif-msg-count-${user.id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        fetchCount,
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);

  return count;
}

// ----- Browser push notifications (Web Notifications API) -----

const PUSH_DISMISS_KEY = "openrun.pushPromptDismissed.v1";

export function pushPermissionState(): "granted" | "denied" | "default" | "unsupported" {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission;
}

export type PushEnableResult = {
  permission: NotificationPermission | "unsupported";
  /** Whether this device now has a push subscription, so alerts can arrive while the app is closed. */
  subscribed: boolean;
};

/**
 * The app's one way to turn push on for this device: asks the browser if needed and creates the device's push
 * subscription. A "granted" permission alone is not success: the subscription can still fail (a blocked SDK, a
 * failed opt-in), and `subscribed` says whether it exists.
 */
export async function requestPushPermission(): Promise<PushEnableResult> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return { permission: "unsupported", subscribed: false };
  }
  if (window.Notification.permission === "denied") {
    return { permission: "denied", subscribed: false };
  }
  if (window.Notification.permission === "granted") {
    // Already allowed in the browser, but the device may still lack a push subscription
    // (needed for delivery while the app is closed).
    return { permission: "granted", subscribed: await ensureOneSignalSubscription() };
  }
  // Prompt through OneSignal so permission AND the push subscription are created.
  if (await ensureOneSignalSubscription()) return { permission: "granted", subscribed: true };
  let permission: NotificationPermission;
  try {
    permission = await window.Notification.requestPermission();
  } catch {
    permission = window.Notification.permission;
  }
  // Allowed now, but the first opt-in failed: try once more and report what actually happened.
  const subscribed = permission === "granted" ? await ensureOneSignalSubscription() : false;
  return { permission, subscribed };
}

/** Best-effort opt-in to OneSignal web push for closed-app delivery. */
export async function ensureOneSignalSubscription(): Promise<boolean> {
  try {
    const { optInOneSignalPush } = await import("@/lib/onesignal");
    return await optInOneSignalPush();
  } catch (e) {
    console.warn("[push] onesignal opt-in failed", e);
    return false;
  }
}

export function dismissPushPrompt() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PUSH_DISMISS_KEY, "1");
  } catch {
    /* ignore */
  }
}

export function isPushPromptDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(PUSH_DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

function showBrowserNotification(n: Pick<Notification, "title" | "body" | "link" | "type">) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (window.Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return; // don't double-notify
  if (!isAllowed(n.type, "push")) return;

  try {
    const native = new window.Notification(n.title, {
      body: n.body ?? undefined,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: `openrun-${n.type}`,
    });
    native.onclick = () => {
      window.focus();
      openDeepLink(n.link, n.type);
      native.close();
    };
  } catch {
    /* ignore */
  }
}

/**
 * Subscribes to inserted notifications for the signed-in user and surfaces
 * them as toast + (when permitted) native browser push notifications.
 * Mount this once near the app root.
 */
export function useNotificationPush() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    let active = true;
    // Track grouped message counts per conversation (resets on unmount/page reload)
    const messageGroups = new Map<string, number>();
    const channel = supabase
      .channel(`notif-push-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (!active) return;
          const n = payload.new as Notification;

          // For message notifications, suppress popup when already viewing that thread
          let convId: string | null = null;
          if (n.type === "message" && n.link) {
            const m = n.link.match(/\/messages\/([^/?#]+)/);
            convId = m ? m[1] : null;
            if (typeof window !== "undefined" && convId) {
              const viewingThisThread =
                window.location.pathname.startsWith(`/messages/${convId}`) &&
                document.visibilityState === "visible";
              if (viewingThisThread) return; // skip toast + native push entirely
            }
          }

          if (isAllowed(n.type, "inApp")) {
            import("sonner").then(({ toast }) => {
              const isApproval = n.type === "join_approved" || n.type === "join_declined";
              const fn =
                n.type === "join_approved"
                  ? toast.success
                  : n.type === "join_declined"
                    ? toast.error
                    : toast;

              // Group consecutive messages from the same conversation under one toast
              if (n.type === "message" && convId) {
                const prev = messageGroups.get(convId) ?? 0;
                const next = prev + 1;
                messageGroups.set(convId, next);
                const toastId = `msg-${convId}`;
                const title = next > 1 ? `${next} new messages` : n.title;
                const description =
                  next > 1 ? `${n.title}${n.body ? `: ${n.body}` : ""}` : (n.body ?? undefined);
                toast(title, {
                  id: toastId,
                  description,
                  action: n.link
                    ? {
                        label: "Open",
                        onClick: () => {
                          messageGroups.delete(convId!);
                          openDeepLink(n.link, n.type);
                        },
                      }
                    : undefined,
                  duration: 5000,
                  onDismiss: () => messageGroups.delete(convId!),
                  onAutoClose: () => messageGroups.delete(convId!),
                });
              } else {
                fn(n.title, {
                  description: n.body ?? undefined,
                  action: n.link
                    ? {
                        label: "Open",
                        onClick: () => {
                          openDeepLink(n.link, n.type);
                        },
                      }
                    : undefined,
                  duration: isApproval ? 8000 : 5000,
                });
              }
            });
          }
          showBrowserNotification(n);
        },
      )
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [user?.id]);
}
