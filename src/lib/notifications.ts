import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

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
  const { error } = await supabase.from("notifications" as any).insert(input as any);
  if (error) console.warn("notification insert failed", error.message);
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
  await supabase.from("notifications" as any).update({ read_at: new Date().toISOString() } as any).eq("id", id);
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
    if (!user) { setCount(0); return; }
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
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, fetchCount)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
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
  if (window.Notification.permission !== "default") return window.Notification.permission;
  try {
    return await window.Notification.requestPermission();
  } catch {
    return window.Notification.permission;
  }
}

export function dismissPushPrompt() {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(PUSH_DISMISS_KEY, "1"); } catch { /* ignore */ }
}

export function isPushPromptDismissed(): boolean {
  if (typeof window === "undefined") return true;
  try { return window.localStorage.getItem(PUSH_DISMISS_KEY) === "1"; } catch { return false; }
}

function showBrowserNotification(n: Pick<Notification, "title" | "body" | "link" | "type">) {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (window.Notification.permission !== "granted") return;
  if (typeof document !== "undefined" && document.visibilityState === "visible") return; // don't double-notify
  try {
    const native = new window.Notification(n.title, {
      body: n.body ?? undefined,
      icon: "/favicon.ico",
      badge: "/favicon.ico",
      tag: `openrun-${n.type}`,
    });
    native.onclick = () => {
      window.focus();
      if (n.link) window.location.assign(n.link);
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
    const channel = supabase
      .channel(`notif-push-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        (payload) => {
          if (!active) return;
          const n = payload.new as Notification;
          // Lazy import to avoid SSR issues
          import("sonner").then(({ toast }) => {
            const isApproval = n.type === "join_approved" || n.type === "join_declined";
            const fn = n.type === "join_approved" ? toast.success : n.type === "join_declined" ? toast.error : toast;
            fn(n.title, {
              description: n.body ?? undefined,
              action: n.link
                ? { label: "Open", onClick: () => { if (n.link) window.location.assign(n.link); } }
                : undefined,
              duration: isApproval ? 8000 : 5000,
            });
          });
          showBrowserNotification(n);
        },
      )
      .subscribe();
    return () => { active = false; supabase.removeChannel(channel); };
  }, [user?.id]);
}
