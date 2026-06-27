import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Send, Paperclip, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { getConversationOther, listMessages, markConversationRead, sendMessage, uploadMessageAttachment, type Message } from "@/lib/messages";
import { MessageAttachment } from "@/components/MessageAttachment";
import { supabase } from "@/integrations/supabase/client";


export const Route = createFileRoute("/messages/$conversationId")({
  head: () => ({ meta: [{ title: "Chat — OpenRun" }] }),
  component: Thread,
});

function Thread() {
  const { conversationId } = Route.useParams();
  const { user, loading } = useAuth();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [other, setOther] = useState<{ user_id: string; display_name: string; avatar_initials: string | null } | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const [m, o] = await Promise.all([listMessages(conversationId), getConversationOther(conversationId)]);
        if (cancelled) return;
        setMsgs(m); setOther(o);
        await markConversationRead(conversationId);
      } catch (e: any) { toast.error(e.message); }
    })();
    const channel = supabase
      .channel(`thread-${conversationId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => { setMsgs((prev) => [...prev, payload.new as Message]); markConversationRead(conversationId); })
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [conversationId, user?.id, loading]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length]);

  if (!loading && !user) {
    return (
      <div className="mx-auto max-w-md px-4 pt-10 text-center text-sm">
        <Link to="/auth" className="text-lime font-bold">Sign in to view this chat</Link>
      </div>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try { await sendMessage(conversationId, text); setText(""); }
    catch (e: any) { toast.error(e.message); }
    finally { setSending(false); }
  };

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border bg-background shrink-0">
        <Link to="/messages" className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {other?.user_id ? (
          <Link
            to="/players/$userId"
            params={{ userId: other.user_id }}
            className="grid h-10 w-10 place-items-center rounded-2xl bg-lime-gradient text-sm font-bold text-primary-foreground"
          >
            {other.avatar_initials ?? "PL"}
          </Link>
        ) : (
          <div className="grid h-10 w-10 place-items-center rounded-2xl bg-lime-gradient text-sm font-bold text-primary-foreground">
            {other?.avatar_initials ?? "PL"}
          </div>
        )}
        <div className="flex-1 min-w-0">
          {other?.user_id ? (
            <Link
              to="/players/$userId"
              params={{ userId: other.user_id }}
              className="font-semibold text-sm truncate hover:text-lime hover:underline block"
            >
              {other.display_name}
            </Link>
          ) : (
            <div className="font-semibold text-sm truncate">{other?.display_name ?? "Loading…"}</div>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
        {msgs.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground mt-10">No messages yet. Say hi 👋</div>
        ) : msgs.map((m) => {
          const mine = m.sender_id === user?.id;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-lime-gradient text-primary-foreground" : "bg-surface border border-border"}`}>
                {m.body}
                <div className={`text-[10px] mt-1 opacity-70 ${mine ? "text-primary-foreground" : "text-muted-foreground"}`}>{timeShort(m.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={submit}
        className="sticky bottom-0 left-0 right-0 shrink-0 flex items-end gap-2 border-t border-border bg-background/95 backdrop-blur px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] z-20"
      >
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(e as unknown as React.FormEvent);
            }
          }}
          placeholder="Type a message…"
          rows={1}
          className="flex-1 max-h-32 resize-none rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm outline-none focus:border-lime"
        />
        <button type="submit" disabled={sending || !text.trim()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-lime-gradient text-primary-foreground disabled:opacity-50">
          <Send className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}

function timeShort(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
