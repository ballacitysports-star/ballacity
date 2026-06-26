import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { Logo } from "@/components/Logo";
import { Bell, BellRing, MessageCircle, Users, CreditCard, Zap, X, CheckCheck, Check, Dot, Trash2, Mail, MailOpen } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  deleteNotification,
  pushPermissionState,
  requestPushPermission,
  dismissPushPrompt,
  isPushPromptDismissed,
  type Notification,
} from "@/lib/notifications";
import {
  CATEGORY_META,
  setNotifPref,
  useNotifPrefs,
  useHydrateNotifPrefs,
  type NotifCategory,
  type NotifChannel,
} from "@/lib/notification-prefs";

import { Switch } from "@/components/ui/switch";

import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_tabs/notifications")({
  head: () => ({ meta: [{ title: "Alerts — OpenRun" }] }),
  component: Notifications,
});

const iconFor = (type: string) => {
  if (type === "message") return MessageCircle;
  if (type === "join_request" || type === "join_approved" || type === "join_declined") return Users;
  if (type === "payment") return CreditCard;
  return Zap;
};

function Notifications() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [fetching, setFetching] = useState(true);
  const nav = useNavigate();

  useEffect(() => {
    if (loading) return;
    if (!user) { setFetching(false); return; }
    let cancelled = false;
    const load = async () => {
      try { const data = await listMyNotifications(); if (!cancelled) setItems(data); }
      finally { if (!cancelled) setFetching(false); }
    };
    load();
    const channel = supabase
      .channel(`notif-list-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user?.id, loading]);

  const handleClick = async (n: Notification) => {
    if (!n.read_at) await markNotificationRead(n.id);
    if (n.link) nav({ to: n.link as any });
  };

  if (!loading && !user) {
    return (
      <div className="mx-auto max-w-md px-4 pt-10 text-center">
        <Bell className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
        <h1 className="font-display text-2xl font-bold mb-2">Sign in for alerts</h1>
        <p className="text-sm text-muted-foreground mb-4">Stay on top of join requests, payments, and messages.</p>
        <Link to="/auth" className="inline-flex rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground">Sign in</Link>
      </div>
    );
  }

  const unreadCount = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  const toggleRead = async (n: Notification) => {
    const willMarkRead = !n.read_at;
    const next = willMarkRead ? new Date().toISOString() : null;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: next } : x)));
    try {
      if (willMarkRead) await markNotificationRead(n.id);
      else await markNotificationUnread(n.id);
    } catch {
      // revert on failure
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: n.read_at } : x)));
      toast.error("Couldn't update notification");
    }
  };

  const removeItem = async (n: Notification) => {
    const prev = items;
    setItems((curr) => curr.filter((x) => x.id !== n.id));
    try {
      await deleteNotification(n.id);
      toast.success("Notification deleted", {
        action: {
          label: "Undo",
          onClick: () => setItems(prev), // visual only; server row is gone
        },
      });
    } catch {
      setItems(prev);
      toast.error("Couldn't delete notification");
    }
  };

  const handleMarkAll = async () => {
    if (unreadCount === 0) return;
    const stamp = new Date().toISOString();
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? stamp })));
    try {
      await markAllNotificationsRead();
      toast.success(`Marked ${unreadCount} as read`);
    } catch {
      toast.error("Couldn't mark all as read");
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="flex items-center justify-between mb-5">
        <Logo />
        <button
          onClick={handleMarkAll}
          disabled={unreadCount === 0}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:border-lime/60 hover:text-lime disabled:opacity-40 disabled:hover:border-border disabled:hover:text-foreground"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Mark all read{unreadCount > 0 ? ` (${unreadCount})` : ""}
        </button>
      </div>
      <h1 className="font-display text-3xl font-bold leading-tight mb-1">Alerts</h1>
      <p className="text-muted-foreground text-sm mb-5">Real-time updates from your games & crew.</p>

      <PushPrompt />
      <NotificationPreferences />

      {fetching ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          You're all caught up. New activity will show up here.
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-[10px] text-muted-foreground/70 px-1 mb-1">
            Tip: swipe right to toggle read · swipe left to delete
          </p>
          {items.map((n, i) => (
            <SwipeableAlert
              key={n.id}
              n={n}
              index={i}
              onOpen={handleClick}
              onToggleRead={toggleRead}
              onDelete={removeItem}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function NotificationPreferences() {
  const prefs = useNotifPrefs();
  const { user } = useAuth();
  useHydrateNotifPrefs(user?.id);
  const categories: NotifCategory[] = ["approvals", "messages", "general"];

  return (
    <details className="mb-4 rounded-2xl border border-border bg-surface/40 group">
      <summary className="cursor-pointer list-none p-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Notification preferences</div>
          <div className="text-xs text-muted-foreground">Choose what fires in-app vs. as a push alert.</div>
        </div>
        <span className="text-xs text-muted-foreground group-open:hidden">Edit</span>
        <span className="text-xs text-muted-foreground hidden group-open:inline">Close</span>
      </summary>
      <div className="border-t border-border px-3 py-3 space-y-4">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 items-center">
          <div />
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">In-app</div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">Push</div>
          {categories.map((cat) => (
            <PrefRow key={cat} category={cat} prefs={prefs} />
          ))}
        </div>
      </div>
    </details>
  );
}

function PrefRow({ category, prefs }: { category: NotifCategory; prefs: ReturnType<typeof useNotifPrefs> }) {
  const meta = CATEGORY_META[category];
  const toggle = (channel: NotifChannel, value: boolean) => setNotifPref(category, channel, value);
  return (
    <>
      <div className="py-2">
        <div className="text-sm font-medium">{meta.label}</div>
        <div className="text-xs text-muted-foreground">{meta.description}</div>
      </div>
      <div className="grid place-items-center">
        <Switch checked={prefs[category].inApp} onCheckedChange={(v) => toggle("inApp", v)} aria-label={`${meta.label} in-app`} />
      </div>
      <div className="grid place-items-center">
        <Switch checked={prefs[category].push} onCheckedChange={(v) => toggle("push", v)} aria-label={`${meta.label} push`} />
      </div>
    </>
  );
}


function PushPrompt() {
  const [perm, setPerm] = useState<"granted" | "denied" | "default" | "unsupported">("default");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setPerm(pushPermissionState());
    setDismissed(isPushPromptDismissed());
  }, []);

  if (perm === "unsupported" || perm === "granted") return null;
  if (perm === "default" && dismissed) return null;

  const enable = async () => {
    const result = await requestPushPermission();
    if (result === "granted") {
      setPerm("granted");
      toast.success("Push notifications enabled");
    } else if (result === "denied") {
      setPerm("denied");
      toast("Push blocked. Enable it from your browser site settings.");
    }
  };

  return (
    <div className="mb-4 rounded-2xl border border-lime/40 bg-lime/10 p-3 flex items-start gap-3">
      <BellRing className="h-5 w-5 text-lime shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm">
          {perm === "denied" ? "Push notifications blocked" : "Get push alerts for approvals"}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {perm === "denied"
            ? "Re-enable notifications for this site in your browser settings to get instant approval alerts."
            : "Know the moment a host approves or declines your join request — even when OpenRun isn't open."}
        </p>
        {perm !== "denied" && (
          <button
            onClick={enable}
            className="mt-2 inline-flex items-center rounded-full bg-lime-gradient px-4 py-1.5 text-xs font-bold text-primary-foreground"
          >
            Turn on push
          </button>
        )}
      </div>
      <button
        onClick={() => { dismissPushPrompt(); setDismissed(true); }}
        className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}
