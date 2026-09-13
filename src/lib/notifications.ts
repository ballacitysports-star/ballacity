import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { isAllowed } from "@/lib/notification-prefs";
import { openDeepLink, toAbsoluteDeepLink } from "@/lib/deep-links";

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

  // Best-effort OneSignal push (background/closed-app delivery). Never blocks.
  try {
    const { sendPushToUser } = await import("@/lib/push.functions");
    void sendPushToUser({
      data: {
        userId: input.user_id,
        title: input.title,
        body: input.body ?? null,
        // Push providers need an absolute URL so tapping the alert opens the
        // exact game / chat / profile the notification refers to.
        url: toAbsoluteDeepLink(input.link ?? null, input.type),
      },
    }).catch((e) => console.warn("push send failed", e));
  } catch (e) {
    console.warn("push module load failed", e);
  }
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
  await supabase
    .from("notifications" as any)
    .update({ read_at: new Date().toISOString() } as any)
    .eq("id", id);
}

export async function markNotificationUnread(id: string) {
  await supabase
    .from("notifications" as any)
    .update({ read_at: null } as any)
    .eq("id", id);
}

export async function deleteNotification(id: string) {
  const { error } = await supabase
    .from("notifications" as any)
    .delete()
    .eq("id", id);
  if (error) throw error;
}

export async function markAllNotificationsRead() {
  const { data: u } = await supabase.auth.getUser();
  if (!u.user) return;
  await supabase
    .from("notifications" as any)
    .update({ read_at: new Date().toISOString() } as any)
    .eq("user_id", u.user.id)
    .is("read_at", null);
}

export function useUnreadNotificationCount() {
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
        .is("read_at", null);
      if (!cancelled) setCount(c ?? 0);
    };
    fetchCount();

    const channel = supabase
      .channel(`notif-count-${user.id}`)
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

export async function requestPushPermission(): Promise<NotificationPermission | "unsupported"> {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  if (window.Notification.permission === "granted") {
    // Already allowed in the browser, but the device may still lack a OneSignal
    // subscription (needed for delivery while the app is closed).
    void ensureOneSignalSubscription();
    return "granted";
  }
  if (window.Notification.permission === "denied") return "denied";
  // Prompt through OneSignal so permission AND the push subscription are created.
  const subscribed = await ensureOneSignalSubscription();
  if (subscribed) return "granted";
  try {
    const result = await window.Notification.requestPermission();
    if (result === "granted") void ensureOneSignalSubscription();
    return result;
  } catch {
    return window.Notification.permission;
  }
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
