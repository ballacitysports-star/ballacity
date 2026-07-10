import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { listMyConversations, type ConversationWithMeta } from "@/lib/messages";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/messages/")({
  head: () => ({ meta: [{ title: "Messages — OpenRun" }] }),
  component: MessagesInbox,
});

function MessagesInbox() {
  const { user, loading } = useAuth();
  const [convs, setConvs] = useState<ConversationWithMeta[]>([]);
  const [fetching, setFetching] = useState(true);

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

  if (!loading && !user) {
    return (
      <div className="mx-auto max-w-md px-4 pt-10 text-center">
        <MessageCircle className="mx-auto h-10 w-10 text-muted-foreground mb-3" />
        <h1 className="font-display text-2xl font-bold mb-2">Sign in to message</h1>
        <Link
          to="/auth"
          className="inline-flex rounded-full bg-lime-gradient px-5 py-2.5 text-sm font-bold text-primary-foreground"
        >
          Sign in
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-4 pt-6 pb-32">
      <div className="flex items-center gap-3 mb-5">
        <Link
          to="/feed"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <h1 className="font-display text-2xl font-bold">Messages</h1>
      </div>

      {fetching ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : convs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center text-sm text-muted-foreground">
          No conversations yet. Open a game and tap the chat icon to message the host.
        </div>
      ) : (
        <div className="space-y-2">
          {convs.map((c) => (
            <Link
              key={c.id}
              to="/messages/$conversationId"
              params={{ conversationId: c.id }}
              className="flex items-center gap-3 rounded-2xl border border-border bg-surface p-3 hover:border-lime/40"
            >
              <div className="grid h-12 w-12 place-items-center rounded-2xl bg-lime-gradient font-bold text-primary-foreground">
                {c.other_initials ?? "PL"}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-sm truncate">{c.other_display_name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0">
                    {timeAgo(c.last_message_at)}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {c.last_message ?? "Say hi 👋"}
                </p>
              </div>
              {c.unread > 0 && (
                <span className="grid h-5 min-w-5 px-1.5 place-items-center rounded-full bg-coral text-[10px] font-bold text-white">
                  {c.unread}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}
    </div>
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
