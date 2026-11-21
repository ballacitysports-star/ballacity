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
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  deleteNotification,
  pushPermissionState,
  requestPushPermission,
  ensureOneSignalSubscription,
  dismissPushPrompt,
  isPushPromptDismissed,
  useUnreadNotificationCountState,
  type Notification,
} from "@/lib/notifications";
import { devicePushSubscriptionState } from "@/lib/onesignal";
import { isManagedUser } from "@/lib/managed-children";
import {
  MEMBER_PUSH_COPY,
  memberPushPrompt,
  type DevicePushSubscription,
  type PushPermission,
} from "@/lib/push-prompt";
import { useStaffAccess } from "@/hooks/use-staff-access";
import { userErrorMessage } from "@/lib/user-error";
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
import { useNotificationActorId, usePrefetchNotificationActors } from "@/lib/notification-actors";
import { UserAvatarById } from "@/components/UserAvatar";
import { supabase } from "@/integrations/supabase/client";
import {
  loadPushDeliveryIssues,
  type DeliveryIssue,
  type DeliveryLogReader,
} from "@/lib/push-delivery";
import { toast } from "sonner";
import { EmptyState } from "@/components/ui/empty-state";
import { ListSkeleton } from "@/components/ui/loading-state";
import { useAuthSearchHere } from "@/lib/auth-return";

const iconFor = (type: string) => {
  if (type === "message") return MessageCircle;
  if (type === "join_request" || type === "join_approved" || type === "join_declined") return Users;
  if (type === "payment") return CreditCard;
  if (type === "follow" || type === "unfollow") return UserPlus;
  if (type === "trainer_availability" || type === "availability_reconfirm") return CalendarClock;
  return Zap;
};

export function NotificationsPanel() {
  const { user, loading } = useAuth();
  const authSearch = useAuthSearchHere();
  const [items, setItems] = useState<Notification[]>([]);
  const [fetching, setFetching] = useState(true);
  const nav = useNavigate();
  const { access } = useStaffAccess();
  // The true unread total on the server, not the (at most 100) loaded rows. No type is left out: "Mark all read"
  // marks every unread notification, messages included, and this is the number it reports.
  const {
    count: serverUnread,
    refresh: refreshUnread,
    setCount: setUnreadCount,
  } = useUnreadNotificationCountState("alerts-panel-");
  const [markingAll, setMarkingAll] = useState(false);

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
      if (document.visibilityState === "visible") {
        void load();
        refreshUnread();
      }
    };
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("online", resync);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("online", resync);
      supabase.removeChannel(channel);
    };
  }, [user?.id, loading, refreshUnread]);

  // Warm every row's avatar (including below the fold) before it scrolls in.
  usePrefetchNotificationActors(items);

  // The server's count is the truth, but it can be unknown (not answered yet, or the read failed) or a moment
  // behind: unread rows on screen always count, so "Mark all read" is never disabled while some are showing.
  const loadedUnread = useMemo(() => items.filter((n) => !n.read_at).length, [items]);
  const unreadCount = Math.max(serverUnread ?? 0, loadedUnread);

  const handleClick = async (n: Notification) => {
    if (!n.read_at) {
      try {
        await markNotificationRead(n.id);
        refreshUnread();
      } catch {
        // Opening the alert matters more than its read mark; it stays unread and can be marked later.
      }
    }
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
          search={authSearch}
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
      refreshUnread();
    } catch (e) {
      setItems((prev) => prev.map((x) => (x.id === n.id ? { ...x, read_at: n.read_at } : x)));
      toast.error(userErrorMessage(e, "Couldn't update this notification. Please try again."));
    }
  };

  const removeItem = async (n: Notification) => {
    const prev = items;
    setItems((curr) => curr.filter((x) => x.id !== n.id));
    try {
      await deleteNotification(n.id);
      if (!n.read_at) refreshUnread();
      toast.success("Notification deleted", {
        action: { label: "Undo", onClick: () => setItems(prev) },
      });
    } catch (e) {
      setItems(prev);
      toast.error(userErrorMessage(e, "Couldn't delete this notification. Please try again."));
    }
  };

  const handleMarkAll = async () => {
    if (!user || unreadCount === 0 || markingAll) return;
    setMarkingAll(true);
    const stamp = new Date().toISOString();
    const before = serverUnread;
    const wasUnread = new Set(items.filter((n) => !n.read_at).map((n) => n.id));
    setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? stamp })));
    setUnreadCount(0);
    try {
      // One update on the server for every unread notification, including ones not loaded here.
      const marked = await markAllNotificationsRead(user.id);
      toast.success(
        marked === 0
          ? "You're all caught up"
          : `Marked ${marked} notification${marked === 1 ? "" : "s"} as read`,
      );
    } catch (e) {
      setItems((prev) =>
        prev.map((n) => (wasUnread.has(n.id) && n.read_at === stamp ? { ...n, read_at: null } : n)),
      );
      setUnreadCount(before);
      toast.error(
        userErrorMessage(e, "Couldn't mark your notifications as read. Please try again."),
      );
    } finally {
      setMarkingAll(false);
      refreshUnread();
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
          disabled={unreadCount === 0 || markingAll}
          className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-foreground hover:border-lime/60 hover:text-lime disabled:opacity-40 disabled:hover:border-border disabled:hover:text-foreground"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Mark all read{unreadCount > 0 ? ` (${unreadCount})` : ""}
        </button>
      </div>

      <PushPrompt managed={isManagedUser(user)} />
      {/* Delivery diagnostics are for operations: superadmins only. Members get the plain prompt above. */}
      {access.isSuperadmin && <PushDeliveryFallback userId={user?.id} />}
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
          <div className="micro-label text-muted-foreground text-center">In-app</div>
          <div className="micro-label text-muted-foreground text-center">Push</div>
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

/** How often, and how many times, to look again while the push SDK is still loading. */
const DEVICE_CHECK_RETRY_MS = 2000;
const DEVICE_CHECK_TRIES = 5;

/**
 * The member's push prompt: "Turn on push notifications" when push is off, not yet allowed, or allowed but this
 * device has no push subscription; a short "blocked" note when the browser blocks it. It uses the app's one enable
 * path (requestPushPermission, and ensureOneSignalSubscription when the browser already allows it).
 */
export function PushPrompt({ managed = false }: { managed?: boolean }) {
  // null until the mount effect has read the browser's permission and the dismissal flag, so the first paint
  // never flashes the banner at someone who already has push or dismissed it (and server and client agree).
  const [perm, setPerm] = useState<PushPermission | null>(null);
  const [device, setDevice] = useState<DevicePushSubscription>("unknown");
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setPerm(pushPermissionState());
    setDismissed(isPushPromptDismissed());
  }, []);

  const checkDevice = useCallback(async () => {
    const state = await devicePushSubscriptionState();
    setDevice(state);
    return state;
  }, []);

  useEffect(() => {
    if (perm !== "granted" || managed) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let tries = 0;
    const run = async () => {
      tries += 1;
      const state = await checkDevice();
      if (!cancelled && state === "unknown" && tries < DEVICE_CHECK_TRIES) {
        timer = setTimeout(run, DEVICE_CHECK_RETRY_MS);
      }
    };
    void run();
    const onVisible = () => {
      if (document.visibilityState === "visible") void checkDevice();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [perm, managed, checkDevice]);

  const prompt =
    perm === null ? null : memberPushPrompt({ permission: perm, device, dismissed, managed });
  if (!prompt) return null;

  const enable = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (perm === "granted") {
        // Already allowed in the browser: only this device's subscription is missing.
        if (await ensureOneSignalSubscription()) {
          setDevice("subscribed");
          toast.success(MEMBER_PUSH_COPY.enabled);
        } else {
          toast.error(MEMBER_PUSH_COPY.failed);
        }
        return;
      }
      const { permission: result, subscribed } = await requestPushPermission();
      if (result === "granted") {
        setPerm("granted");
        if (subscribed) {
          setDevice("subscribed");
          toast.success(MEMBER_PUSH_COPY.enabled);
        } else {
          // Allowed in the browser, but this device still has no subscription: not a success. The device
          // check that follows decides whether to offer the prompt again.
          setDevice("not_subscribed");
          toast.error(MEMBER_PUSH_COPY.failed);
        }
      } else if (result === "denied") {
        setPerm("denied");
        toast(MEMBER_PUSH_COPY.blockedToast);
      }
    } catch {
      toast.error(MEMBER_PUSH_COPY.failed);
    } finally {
      setBusy(false);
    }
  };

  const blocked = prompt === "blocked";
  return (
    <div className="mb-4 rounded-2xl border border-lime/40 bg-lime/10 p-3 flex items-start gap-3">
      <BellRing className="h-5 w-5 text-lime shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm">
          {blocked ? MEMBER_PUSH_COPY.blockedTitle : MEMBER_PUSH_COPY.enableTitle}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {blocked ? MEMBER_PUSH_COPY.blockedBody : MEMBER_PUSH_COPY.enableBody}
        </p>
        {!blocked && (
          <button
            type="button"
            onClick={enable}
            disabled={busy}
            className="mt-2 inline-flex items-center rounded-full bg-lime-gradient px-4 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-60"
          >
            {MEMBER_PUSH_COPY.enableButton}
          </button>
        )}
      </div>
      <button
        type="button"
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

/**
 * Operations diagnostics: failed or skipped pushes from the delivery log, with the provider's reason. Rendered for
 * superadmins only (see NotificationsPanel); members get PushPrompt instead and never see provider reasons.
 */
function PushDeliveryFallback({ userId }: { userId: string | undefined }) {
  const [failures, setFailures] = useState<DeliveryIssue[]>([]);
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
      // Failed or skipped pushes from the last 7 days, without the ones held for a minor's quiet
      // hours (or a settings check) and the ones dropped as expired: those are not a problem.
      // "No subscribers" stays: it tells the superadmin no device of theirs is subscribed.
      const rows = await loadPushDeliveryIssues(supabase as unknown as DeliveryLogReader, userId);
      if (!cancelled) setFailures(rows);
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
