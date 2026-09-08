import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MessageCircle, Bell, Check, X as XIcon } from "lucide-react";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  listMyConversations,
  acceptConversation,
  declineConversation,
  type ConversationWithMeta,
} from "@/lib/messages";
import { UserAvatarById } from "@/components/UserAvatar";
import { usePrefetchUserAvatars } from "@/lib/user-avatars";
import { supabase } from "@/integrations/supabase/client";
import { NotificationsPanel } from "@/components/NotificationsPanel";

const searchSchema = z.object({
  tab: fallback(z.string(), "messages").default("messages"),
});

type TopTab = "messages" | "alerts";

export const Route = createFileRoute("/messages/")({
  head: () =>
    pageHead({
      path: "/messages",
      title: "Inbox — ballaCity",
      description: "Your ballaCity conversations with players, teams, trainers, and gyms.",
      noindex: true,
    }),
  validateSearch: zodValidator(searchSchema),
  component: MessagesInbox,
});

function MessagesInbox() {
  const { user, loading } = useAuth();
  const { tab: tabRaw } = Route.useSearch();
  const top: TopTab = tabRaw === "alerts" ? "alerts" : "messages";
  const nav = Route.useNavigate();
  const [convs, setConvs] = useState<ConversationWithMeta[]>([]);
  const [fetching, setFetching] = useState(true);
  const [msgTab, setMsgTab] = useState<"primary" | "requests">("primary");

  useEffect(() => {
    if (loading) return;
    if (!user) {
      setFetching(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const data = await listMyConversations();
        if (!cancelled) setConvs(data);
      } finally {
        if (!cancelled) setFetching(false);
      }
    };
    load();
    const channel = supabase
      .channel(`inbox-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, load)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, load)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, load)
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user?.id, loading]);

  const primary = useMemo(() => convs.filter((c) => !c.is_request), [convs]);
  const requests = useMemo(() => convs.filter((c) => c.is_request), [convs]);
  const msgUnread = useMemo(() => primary.reduce((n, c) => n + c.unread, 0), [primary]);

  if (!loading && !user) {
    return (
      <div className="page-shell-narrow pt-10 text-center">
        <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
        <h1 className="font-display text-2xl font-bold mb-2">Sign in to your inbox</h1>
        <Link
          to="/auth"
          className="inline-flex rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }

  const list = msgTab === "primary" ? primary : requests;

  // Warm photos for every thread in both tabs, not just the visible ones.
  usePrefetchUserAvatars(
    useMemo(() => [...primary, ...requests].map((c) => c.other_user_id), [primary, requests]),
  );

  const handleAccept = async (id: string) => {
    try {
      await acceptConversation(id);
      setConvs((prev) => prev.map((c) => (c.id === id ? { ...c, is_request: false } : c)));
      toast.success("Message request accepted");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDecline = async (id: string) => {
    try {
      await declineConversation(id);
      setConvs((prev) => prev.filter((c) => c.id !== id));
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const setTop = (t: TopTab) => nav({ search: (prev: any) => ({ ...prev, tab: t }) });

  return (
    <div className="page-shell-content pt-6 pb-32">
      <div className="flex items-center gap-3 mb-5">
        <Link
          to="/feed"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Inbox</h1>
      </div>

      {/* Top-level Messages vs Alerts */}
      <div className="flex gap-2 mb-4 border-b border-border">
        <TopTabButton active={top === "messages"} onClick={() => setTop("messages")}>
          <MessageCircle className="h-4 w-4" />
          Messages
          {msgUnread > 0 && (
            <span className="ml-1.5 grid h-5 min-w-5 px-1.5 place-items-center rounded-full bg-coral text-[10px] font-bold text-white">
              {msgUnread}
            </span>
          )}
        </TopTabButton>
        <TopTabButton active={top === "alerts"} onClick={() => setTop("alerts")}>
          <Bell className="h-4 w-4" />
          Alerts
        </TopTabButton>
      </div>

      {top === "alerts" ? (
        <NotificationsPanel />
      ) : (
        <>
          <div className="flex gap-2 mb-4 border-b border-border">
            <SubTabButton active={msgTab === "primary"} onClick={() => setMsgTab("primary")}>
              Primary
              {msgUnread > 0 && (
                <span className="ml-2 grid h-5 min-w-5 px-1.5 place-items-center rounded-full bg-coral text-[10px] font-bold text-white">
                  {msgUnread}
                </span>
              )}
            </SubTabButton>
            <SubTabButton active={msgTab === "requests"} onClick={() => setMsgTab("requests")}>
              Requests
              {requests.length > 0 && (
                <span className="ml-2 grid h-5 min-w-5 px-1.5 place-items-center rounded-full bg-lime text-[10px] font-bold text-primary-foreground">
                  {requests.length}
                </span>
              )}
            </SubTabButton>
          </div>

          {fetching ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : list.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
              {msgTab === "primary"
                ? "No conversations yet. Open a game and tap the chat icon to message the host."
                : "No message requests."}
            </div>
          ) : (
            <div className="space-y-2">
              {list.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3"
                >
                  <Link
                    to="/messages/$conversationId"
                    params={{ conversationId: c.id }}
                    className="flex items-center gap-3 flex-1 min-w-0"
                  >
                    <UserAvatarById
                      userId={c.other_user_id}
                      avatarUrl={c.other_avatar_url}
                      initials={c.other_initials}
                      name={c.other_display_name}
                      size="lg"
                      rounded="square"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-sm truncate">
                          {c.other_display_name}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {timeAgo(c.last_message_at)}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {c.last_message ?? "Say hi 👋"}
                      </p>
                    </div>
                  </Link>
                  {msgTab === "requests" ? (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => handleAccept(c.id)}
                        aria-label="Accept request"
                        className="grid h-9 w-9 place-items-center rounded-full bg-lime-gradient text-primary-foreground"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => handleDecline(c.id)}
                        aria-label="Decline request"
                        className="grid h-9 w-9 place-items-center rounded-full border border-border bg-background"
                      >
                        <XIcon className="h-4 w-4" />
                      </button>
                    </div>
                  ) : (
                    c.unread > 0 && (
                      <span className="grid h-5 min-w-5 px-1.5 place-items-center rounded-full bg-coral text-[10px] font-bold text-white shrink-0">
                        {c.unread}
                      </span>
                    )
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TopTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
        active
          ? "border-lime text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function SubTabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
        active
          ? "border-lime text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
