import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useMemo, useRef, useState } from "react";
import { MessageCircle, Bell, Check, X as XIcon } from "lucide-react";
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
import { TeamInvitesInbox } from "@/components/team/TeamInvitesInbox";
import { useUnreadNotificationCount } from "@/lib/notifications";
import { EmptyState } from "@/components/ui/empty-state";
import { ListSkeleton } from "@/components/ui/loading-state";
import { FamilyInboxSection } from "@/components/child/FamilyInboxSection";
import { PreviewGate } from "@/components/public/PreviewGate";
import { BackButton } from "@/components/layout/BackButton";

const searchSchema = z.object({
  tab: fallback(z.string(), "messages").default("messages"),
});

type TopTab = "messages" | "alerts";

export const Route = createFileRoute("/messages/")({
  head: () =>
    pageHead({
      path: "/messages",
      title: "Inbox — BallaCity",
      description: "Your BallaCity conversations with players, teams, trainers, and gyms.",
      noindex: true,
    }),
  validateSearch: zodValidator(searchSchema),
  component: MessagesInboxGate,
});

/** A signed-out visitor gets a sample inbox; the real page mounts only for a member. */
function MessagesInboxGate() {
  return (
    <PreviewGate tab="messages">
      <MessagesInbox />
    </PreviewGate>
  );
}

function MessagesInbox() {
  const { user, loading } = useAuth();
  const { tab: tabRaw } = Route.useSearch();
  const top: TopTab = tabRaw === "alerts" ? "alerts" : "messages";
  const nav = Route.useNavigate();
  const [convs, setConvs] = useState<ConversationWithMeta[]>([]);
  const [fetching, setFetching] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [retryTick, setRetryTick] = useState(0);
  const [msgTab, setMsgTab] = useState<"primary" | "requests">("primary");
  // Open on Requests once, when that is the only place anything is waiting.
  const pickedTabRef = useRef(false);

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
        if (!cancelled) {
          setConvs(data);
          setLoadFailed(false);
        }
      } catch {
        // Keep what is already on screen on a refresh; only a first load that
        // fails needs the retry state.
        if (!cancelled) setLoadFailed(true);
      } finally {
        if (!cancelled) setFetching(false);
      }
    };
    load();
    let hasSubscribed = false;
    const channel = supabase
      .channel(`inbox-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages" }, load)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "messages" }, load)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "conversations" }, load)
      .subscribe((status) => {
        // Joined again after a drop: events in the gap never arrived.
        if (status === "SUBSCRIBED") {
          if (hasSubscribed) void load();
          hasSubscribed = true;
        }
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      supabase.removeChannel(channel);
    };
  }, [user?.id, loading, retryTick]);

  const primary = useMemo(() => convs.filter((c) => !c.is_request), [convs]);
  const requests = useMemo(() => convs.filter((c) => c.is_request), [convs]);
  // A thread nobody has written in is a request on paper only; badges count the real ones.
  const waitingRequests = useMemo(
    () => requests.filter((c) => c.last_message !== null).length,
    [requests],
  );
  // Messages have their own badge; the Alerts tab counts everything else.
  const alertUnread = useUnreadNotificationCount("inbox-", { excludeType: "message" });
  const msgUnread = useMemo(() => primary.reduce((n, c) => n + c.unread, 0), [primary]);

  useEffect(() => {
    if (fetching || pickedTabRef.current) return;
    pickedTabRef.current = true;
    if (primary.length === 0 && waitingRequests > 0) setMsgTab("requests");
  }, [fetching, primary.length, waitingRequests]);

  // Warm photos for every thread in both tabs, not just the visible ones.
  usePrefetchUserAvatars(
    useMemo(() => [...primary, ...requests].map((c) => c.other_user_id), [primary, requests]),
  );

  if (!loading && !user) {
    return (
      <div className="page-shell-narrow pt-10 text-center">
        <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
        <h1 className="page-title mb-2">Sign in to your inbox</h1>
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
    if (!window.confirm("Decline this request? The conversation is removed from your inbox.")) {
      return;
    }
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
        <BackButton fallbackTo="/feed" label="Back" className="border border-border bg-surface" />
        <h1 className="page-title">Inbox</h1>
      </div>

      <FamilyInboxSection className="mb-4" />

      {/* Top-level Messages vs Alerts */}
      <div className="flex gap-2 mb-4 border-b border-border">
        <TopTabButton active={top === "messages"} onClick={() => setTop("messages")}>
          <MessageCircle className="h-4 w-4" />
          Messages
          {msgUnread + waitingRequests > 0 && (
            <span
              className="ml-1.5 grid h-5 min-w-5 px-1.5 place-items-center rounded-full bg-coral text-[10px] font-bold text-white"
              aria-label={`${msgUnread} unread, ${waitingRequests} ${waitingRequests === 1 ? "request" : "requests"}`}
            >
              {msgUnread + waitingRequests > 9 ? "9+" : msgUnread + waitingRequests}
            </span>
          )}
        </TopTabButton>
        <TopTabButton active={top === "alerts"} onClick={() => setTop("alerts")}>
          <Bell className="h-4 w-4" />
          Alerts
          {alertUnread > 0 && (
            <span className="ml-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-coral px-1.5 text-[10px] font-bold text-white">
              {alertUnread > 9 ? "9+" : alertUnread}
            </span>
          )}
        </TopTabButton>
      </div>

      {top === "alerts" ? (
        <>
          {/* Invitations need an answer, so they sit above the passive feed. */}
          <TeamInvitesInbox className="mb-5" />
          <NotificationsPanel />
        </>
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
              {waitingRequests > 0 && (
                <span className="ml-2 grid h-5 min-w-5 px-1.5 place-items-center rounded-full bg-lime text-[10px] font-bold text-primary-foreground">
                  {waitingRequests}
                </span>
              )}
            </SubTabButton>
          </div>

          {msgTab === "requests" && !fetching && requests.length > 0 && (
            <p className="mb-3 text-xs text-muted-foreground">
              Open a request to read it first. You can report or block the sender from there before
              you accept.
            </p>
          )}

          {fetching ? (
            <ListSkeleton rows={4} label="Loading your messages…" />
          ) : loadFailed && convs.length === 0 ? (
            <div
              role="alert"
              className="rounded-2xl border border-border bg-surface p-8 text-center text-sm text-muted-foreground"
            >
              Couldn&apos;t load your messages.{" "}
              <button
                type="button"
                onClick={() => {
                  setFetching(true);
                  setRetryTick((n) => n + 1);
                }}
                className="font-semibold text-lime"
              >
                Try again
              </button>
            </div>
          ) : list.length === 0 ? (
            <EmptyState
              icon={<MessageCircle className="h-6 w-6" aria-hidden />}
              title={msgTab === "primary" ? "No conversations yet" : "No message requests"}
              description={
                msgTab === "primary"
                  ? "Messages start from a game. Open a game you're in and tap the chat icon to reach the host."
                  : "Requests from people you haven't messaged before land here first, so nothing reaches you unexpectedly."
              }
              action={
                msgTab === "primary" ? (
                  <Link
                    to="/feed"
                    className="inline-flex rounded-full bg-lime px-5 py-2.5 text-sm font-bold text-primary-foreground"
                  >
                    Find a game
                  </Link>
                ) : undefined
              }
            />
          ) : (
            <div className="space-y-2">
              {list.map((c) => (
                <div
                  key={c.id}
                  className="flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-border bg-surface p-3"
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
                        <span className="truncate text-sm font-semibold">
                          {c.other_display_name}
                        </span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {timeAgo(c.last_message_at)}
                        </span>
                      </div>
                      {/* An unread thread is weighted as well as tinted, so the
                          state does not rest on colour alone. */}
                      <p
                        className={`truncate text-xs ${
                          c.unread > 0 ? "font-semibold text-foreground" : "text-muted-foreground"
                        }`}
                      >
                        {c.last_message ?? "Say hi 👋"}
                      </p>
                    </div>
                  </Link>
                  {msgTab === "requests" ? (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        onClick={() => handleAccept(c.id)}
                        aria-label={`Accept request from ${c.other_display_name}`}
                        className="grid h-10 w-10 place-items-center rounded-full bg-lime-gradient text-primary-foreground"
                      >
                        <Check className="h-4 w-4" aria-hidden />
                      </button>
                      <button
                        onClick={() => handleDecline(c.id)}
                        aria-label={`Decline request from ${c.other_display_name}`}
                        className="grid h-10 w-10 place-items-center rounded-full border border-border bg-background"
                      >
                        <XIcon className="h-4 w-4" aria-hidden />
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
