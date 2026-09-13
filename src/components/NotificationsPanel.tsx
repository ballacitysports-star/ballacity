import { Link, useNavigate } from "@tanstack/react-router";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import {
  Bell,
  BellRing,
  MessageCircle,
  Users,
  CreditCard,
  Zap,
  X,
  CheckCheck,
  Check,
  Dot,
  Trash2,
  Mail,
  MailOpen,
  Settings,
  UserPlus,
  CalendarClock,
} from "lucide-react";
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

import { resolveNotificationTarget } from "@/lib/deep-links";
import {
  useNotificationActorId,
  usePrefetchNotificationActors,
} from "@/lib/notification-actors";
import { UserAvatarById } from "@/components/UserAvatar";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { ListSkeleton } from "@/components/ui/loading-state";

const iconFor = (type: string) => {
  if (type === "message") return MessageCircle;
  if (type === "join_request" || type === "join_approved" || type === "join_declined") return Users;
  if (type === "payment") return CreditCard;
  if (type === "follow" || type === "unfollow") return UserPlus;
  if (type === "trainer_availability") return CalendarClock;
  return Zap;
};

export function NotificationsPanel() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [fetching, setFetching] = useState(true);
  const nav = useNavigate();

  const [live, setLive] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setFetching(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const data = await listMyNotifications();
        if (!cancelled) setItems(data);
      } finally {
        if (!cancelled) setFetching(false);
      }
    };
    load();

    const upsert = (row: Notification) =>
      setItems((prev) => {
        const idx = prev.findIndex((x) => x.id === row.id);
        if (idx === -1)
          return [row, ...prev].sort((a, b) => b.created_at.localeCompare(a.created_at));
        const next = [...prev];
        next[idx] = { ...next[idx], ...row };
        return next;
      });

    const channel = supabase
      .channel(`notif-list-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (cancelled) return;
          const row = payload.new as Notification;
          upsert(row);
          toast(row.title, { description: row.body ?? undefined });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          if (!cancelled) upsert(payload.new as Notification);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const old = payload.old as Partial<Notification>;
          if (!cancelled && old?.id) setItems((prev) => prev.filter((x) => x.id !== old.id));
        },
      )
      .subscribe((status) => {
        if (!cancelled) setLive(status === "SUBSCRIBED");
      });

    // Catch up on anything missed while the tab was hidden or offline.
    const resync = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("online", resync);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("online", resync);
      supabase.removeChannel(channel);
    };
  }, [user?.id, loading]);

  // Warm every row's avatar (including below the fold) before it scrolls in.
  usePrefetchNotificationActors(items);

  const unreadCount = useMemo(() => items.filter((n) => !n.read_at).length, [items]);

  const handleClick = async (n: Notification) => {
    if (!n.read_at) await markNotificationRead(n.id);
    nav({ href: resolveNotificationTarget(n) } as any);
  };

  if (!loading && !user) {
    return (
      <div className="pt-6 text-center">
        <Bell className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
        <h2 className="font-display text-xl font-bold mb-2">Sign in for alerts</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Stay on top of join requests, payments, and messages.
        </p>
        <Link
          to="/auth"
          className="inline-flex rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const toggleRead = async (n: Notification) => {
    const willMarkRead = !n.read_at;
    const next = willMarkRead ? new Date().toISOString() : null;
    setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: next } : x)));
    try {
      if (willMarkRead) await markNotificationRead(n.id);
      else await markNotificationUnread(n.id);
    } catch {
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
        action: { label: "Undo", onClick: () => setItems(prev) },
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
    <div>
      <div className="flex items-center justify-end gap-2 mb-3">
        <span
          className="mr-auto inline-flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground"
          aria-live="polite"
        >
          <span
            className={`h-2 w-2 rounded-full ${live ? "bg-lime animate-pulse" : "bg-muted-foreground/40"}`}
          />
          {live ? "Live" : "Reconnecting…"}
        </span>

        <Link
          to="/account/notifications"
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:border-lime/60 hover:text-lime"
          aria-label="Notification settings"
        >
          <Settings className="h-3.5 w-3.5" />
          Settings
        </Link>
        <button
          onClick={handleMarkAll}
          disabled={unreadCount === 0}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:border-lime/60 hover:text-lime disabled:opacity-40 disabled:hover:border-border disabled:hover:text-foreground"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Mark all read{unreadCount > 0 ? ` (${unreadCount})` : ""}
        </button>
      </div>

      <PushPrompt />
      <PushDeliveryFallback userId={user?.id} />
      <NotificationPreferences />

      {fetching ? (
        <ListSkeleton rows={4} label="Loading your notifications…" />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-6 w-6" aria-hidden />}
          title="You're all caught up"
          description="Join requests, roster changes and messages about your games will show up here."
        />
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

const SWIPE_THRESHOLD = 80;
const ACTION_WIDTH = 96;

function SwipeableAlert({
  n,
  index,
  onOpen,
  onToggleRead,
  onDelete,
}: {
  n: Notification;
  index: number;
  onOpen: (n: Notification) => void;
  onToggleRead: (n: Notification) => void;
  onDelete: (n: Notification) => void;
}) {
  const Icon = iconFor(n.type);
  const unread = !n.read_at;
  const x = useMotionValue(0);
  const leftActionOpacity = useTransform(x, [0, 20, SWIPE_THRESHOLD], [0, 0.4, 1]);
  const rightActionOpacity = useTransform(x, [-SWIPE_THRESHOLD, -20, 0], [1, 0.4, 0]);
  const [dragging, setDragging] = useState(false);

  const snap = (to: number) => animate(x, to, { type: "spring", stiffness: 400, damping: 38 });

  const onDragEnd = (_: unknown, info: { offset: { x: number }; velocity: { x: number } }) => {
    setDragging(false);
    const dx = info.offset.x;
    const v = info.velocity.x;
    if (dx > SWIPE_THRESHOLD || v > 500) {
      snap(0);
      onToggleRead(n);
    } else if (dx < -SWIPE_THRESHOLD || v < -500) {
      animate(x, -400, { duration: 0.2 }).then(() => onDelete(n));
    } else {
      snap(0);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.3) }}
      className="relative overflow-hidden rounded-2xl"
    >
      <motion.div
        style={{ opacity: leftActionOpacity, width: ACTION_WIDTH }}
        className="absolute inset-y-0 left-0 flex items-center justify-start pl-4 bg-lime/20 text-lime"
      >
        {unread ? <MailOpen className="h-5 w-5" /> : <Mail className="h-5 w-5" />}
        <span className="ml-2 text-xs font-semibold">{unread ? "Read" : "Unread"}</span>
      </motion.div>

      <motion.div
        style={{ opacity: rightActionOpacity, width: ACTION_WIDTH }}
        className="absolute inset-y-0 right-0 flex items-center justify-end pr-4 bg-destructive/20 text-destructive"
      >
        <span className="mr-2 text-xs font-semibold">Delete</span>
        <Trash2 className="h-5 w-5" />
      </motion.div>

      <motion.div
        drag="x"
        dragConstraints={{ left: -160, right: 160 }}
        dragElastic={0.15}
        style={{ x }}
        onDragStart={() => setDragging(true)}
        onDragEnd={onDragEnd}
        className={`relative flex gap-3 rounded-2xl border p-3 touch-pan-y ${unread ? "border-lime/40 bg-lime/5" : "border-border bg-surface"}`}
      >
        <button
          type="button"
          onClick={() => {
            if (!dragging) onOpen(n);
          }}
          className="flex flex-1 min-w-0 gap-3 text-left"
        >
          <NotificationAvatar n={n} Icon={Icon} unread={unread} />
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2">
              <h3 className="font-semibold text-sm leading-tight flex items-center gap-1">
                {unread && <Dot className="h-4 w-4 -ml-1 text-lime" />}
                {n.title}
              </h3>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {timeAgo(n.created_at)}
              </span>
            </div>
            {n.body && (
              <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>
            )}
          </div>
        </button>
        <div className="shrink-0 flex flex-col gap-1">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleRead(n);
            }}
            aria-label={unread ? "Mark as read" : "Mark as unread"}
            title={unread ? "Mark as read" : "Mark as unread"}
            className="rounded-full p-1.5 text-muted-foreground hover:bg-muted/30 hover:text-lime"
          >
            {unread ? <Check className="h-4 w-4" /> : <Dot className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onDelete(n);
            }}
            aria-label="Delete notification"
            title="Delete"
            className="rounded-full p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/**
 * Face-first alert icon: shows the avatar of the person the notification is
 * about (follower, chat partner, requester) with a skeleton while it resolves,
 * and falls back to the category icon for system alerts.
 */
function NotificationAvatar({
  n,
  Icon,
  unread,
}: {
  n: Notification;
  Icon: typeof Bell;
  unread: boolean;
}) {
  const actorId = useNotificationActorId(n);
  const tone = unread ? "bg-lime/15 text-lime" : "bg-muted/30 text-muted-foreground";

  if (actorId) {
    return (
      <div className="relative h-10 w-10 shrink-0">
        <UserAvatarById userId={actorId} size="md" rounded="square" />
        <span
          className={`absolute -bottom-1 -right-1 grid h-5 w-5 place-items-center rounded-full ring-2 ring-surface ${unread ? "bg-lime text-primary-foreground" : "bg-muted text-muted-foreground"}`}
        >
          <Icon className="h-3 w-3" aria-hidden />
        </span>
      </div>
    );
  }

  return (
    <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tone}`}>
      <Icon className="h-5 w-5" />
    </div>
  );
}

function NotificationPreferences() {
  const prefs = useNotifPrefs();
  const { user } = useAuth();
  useHydrateNotifPrefs(user?.id);
  const categories: NotifCategory[] = ["gameReminders", "gameUpdates", "messages", "payments"];

  return (
    <details className="mb-4 rounded-2xl border border-border bg-surface/40 group">
      <summary className="cursor-pointer list-none p-3 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold">Notification preferences</div>
          <div className="text-xs text-muted-foreground">
            Choose what fires in-app vs. as a push alert.
          </div>
        </div>
        <span className="text-xs text-muted-foreground group-open:hidden">Edit</span>
        <span className="text-xs text-muted-foreground hidden group-open:inline">Close</span>
      </summary>
      <div className="border-t border-border px-3 py-3 space-y-4">
        <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 gap-y-1 items-center">
          <div />
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">
            In-app
          </div>
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground text-center">
            Push
          </div>
          {categories.map((cat) => (
            <PrefRow key={cat} category={cat} prefs={prefs} />
          ))}
        </div>
      </div>
    </details>
  );
}

function PrefRow({
  category,
  prefs,
}: {
  category: NotifCategory;
  prefs: ReturnType<typeof useNotifPrefs>;
}) {
  const meta = CATEGORY_META[category];
  const toggle = (channel: NotifChannel, value: boolean) => setNotifPref(category, channel, value);
  return (
    <>
      <div className="py-2">
        <div className="text-sm font-medium">{meta.label}</div>
        <div className="text-xs text-muted-foreground">{meta.description}</div>
      </div>
      <div className="grid place-items-center">
        <Switch
          checked={prefs[category].inApp}
          onCheckedChange={(v) => toggle("inApp", v)}
          aria-label={`${meta.label} in-app`}
        />
      </div>
      <div className="grid place-items-center">
        <Switch
          checked={prefs[category].push}
          onCheckedChange={(v) => toggle("push", v)}
          aria-label={`${meta.label} push`}
        />
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
            : "Know the moment a host approves or declines your join request — even when ballaCity isn't open."}
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
        onClick={() => {
          dismissPushPrompt();
          setDismissed(true);
        }}
        className="shrink-0 rounded-full p-1 text-muted-foreground hover:text-foreground"
        aria-label="Dismiss"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function PushDeliveryFallback({ userId }: { userId: string | undefined }) {
  const [failures, setFailures] = useState<
    Array<{ id: string; created_at: string; error: string | null; notification_id: string | null }>
  >([]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      return new Set(
        JSON.parse(window.localStorage.getItem("openrun.pushFailDismissed.v1") ?? "[]"),
      );
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const load = async () => {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("notification_delivery_log" as any)
        .select("id, created_at, error, notification_id, status, channel")
        .eq("user_id", userId)
        .eq("channel", "push")
        .in("status", ["failed", "skipped"])
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(10);
      if (!cancelled)
        setFailures(
          ((data ?? []) as any[]).map((r) => ({
            id: r.id,
            created_at: r.created_at,
            error: r.error,
            notification_id: r.notification_id,
          })),
        );
    };
    load();
    const channel = supabase
      .channel(`notif-deliv-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notification_delivery_log",
          filter: `user_id=eq.${userId}`,
        },
        load,
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [userId]);

  const active = failures.filter((f) => !dismissedIds.has(f.id));
  if (active.length === 0) return null;

  const dismissAll = () => {
    const next = new Set(dismissedIds);
    active.forEach((f) => next.add(f.id));
    setDismissedIds(next);
    try {
      window.localStorage.setItem("openrun.pushFailDismissed.v1", JSON.stringify(Array.from(next)));
    } catch {
      /* ignore */
    }
  };

  const reason = active[0].error ?? "unknown";
  const label =
    reason === "no_subscribers"
      ? "No push device is subscribed yet — alerts are showing here instead."
      : reason === "not_configured"
        ? "Push provider isn't configured — alerts are showing here instead."
        : reason === "fetch_failed"
          ? "Push service is unreachable — alerts are showing here instead."
          : `${active.length} push${active.length > 1 ? "es" : ""} couldn't be delivered — alerts are showing here instead.`;

  return (
    <div className="mb-4 rounded-2xl border border-coral/40 bg-coral/10 p-3 flex items-start gap-3">
      <BellRing className="h-5 w-5 text-coral shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm">Push delivery issue</div>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </div>
      <button
        onClick={dismissAll}
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
