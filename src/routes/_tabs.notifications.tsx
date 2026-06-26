import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { motion } from "framer-motion";
import { Logo } from "@/components/Logo";
import { Bell, BellRing, MessageCircle, Users, CreditCard, Zap, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  listMyNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  pushPermissionState,
  requestPushPermission,
  dismissPushPrompt,
  isPushPromptDismissed,
  type Notification,
} from "@/lib/notifications";
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

  return (
    <div className="mx-auto max-w-md px-4 pt-6">
      <div className="flex items-center justify-between mb-5">
        <Logo />
        <button onClick={async () => { await markAllNotificationsRead(); setItems((prev) => prev.map((n) => ({ ...n, read_at: n.read_at ?? new Date().toISOString() }))); }}
          className="text-xs font-semibold text-muted-foreground hover:text-lime">Mark all read</button>
      </div>
      <h1 className="font-display text-3xl font-bold leading-tight mb-1">Alerts</h1>
      <p className="text-muted-foreground text-sm mb-5">Real-time updates from your games & crew.</p>

      {fetching ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          You're all caught up. New activity will show up here.
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((n, i) => {
            const Icon = iconFor(n.type);
            const unread = !n.read_at;
            return (
              <motion.button
                key={n.id}
                onClick={() => handleClick(n)}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: Math.min(i * 0.03, 0.3) }}
                className={`w-full text-left flex gap-3 rounded-2xl border p-3 ${unread ? "border-lime/40 bg-lime/5" : "border-border bg-surface"}`}
              >
                <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${unread ? "bg-lime/15 text-lime" : "bg-muted/30 text-muted-foreground"}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold text-sm leading-tight">{n.title}</h3>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeAgo(n.created_at)}</span>
                  </div>
                  {n.body && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</p>}
                </div>
              </motion.button>
            );
          })}
        </div>
      )}
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
