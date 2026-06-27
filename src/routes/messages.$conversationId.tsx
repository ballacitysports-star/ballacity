import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Send, Paperclip, X, Loader2, RotateCw } from "lucide-react";
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
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { toast.error("Max attachment size is 20MB."); return; }
    setPendingFile(file);
    setUploadError(null);
    setUploadPct(0);
  };

  const cancelUpload = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setUploading(false);
    setUploadPct(0);
  };

  const clearPending = () => {
    cancelUpload();
    setPendingFile(null);
    setUploadError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const doUpload = async (file: File) => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setUploading(true);
    setUploadError(null);
    setUploadPct(0);
    try {
      const attachment = await uploadMessageAttachment(conversationId, file, {
        signal: ctrl.signal,
        onProgress: (p) => setUploadPct(p),
      });
      return attachment;
    } finally {
      abortRef.current = null;
      setUploading(false);
    }
  };

  const retryUpload = async () => {
    if (!pendingFile) return;
    try { await doUpload(pendingFile); }
    catch (e: any) {
      if (e?.name !== "AbortError") setUploadError(e?.message ?? "Upload failed");
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !pendingFile) return;
    if (uploading) return;
    setSending(true);
    try {
      let attachment = null;
      if (pendingFile) {
        attachment = await doUpload(pendingFile);
      }
      await sendMessage(conversationId, text, attachment);
      setText("");
      setPendingFile(null);
      setUploadError(null);
      setUploadPct(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
    catch (e: any) {
      if (e?.name === "AbortError") {
        toast.message("Upload cancelled");
      } else {
        setUploadError(e?.message ?? "Send failed");
        toast.error(e.message);
      }
    }
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
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm space-y-2 ${mine ? "bg-lime-gradient text-primary-foreground" : "bg-surface border border-border"}`}>
                {m.attachment_path && (
                  <MessageAttachment
                    path={m.attachment_path}
                    type={m.attachment_type}
                    name={m.attachment_name}
                    size={m.attachment_size}
                    mine={mine}
                  />
                )}
                {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                <div className={`text-[10px] mt-1 opacity-70 ${mine ? "text-primary-foreground" : "text-muted-foreground"}`}>{timeShort(m.created_at)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={submit}
        className="sticky bottom-0 left-0 right-0 shrink-0 border-t border-border bg-background/95 backdrop-blur px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] z-20"
      >
        {pendingFile && (
          <div className="mb-2 rounded-xl border border-border bg-surface px-3 py-2 text-xs space-y-1.5">
            <div className="flex items-center gap-2">
              <Paperclip className="h-3.5 w-3.5 shrink-0" />
              <span className="flex-1 truncate font-medium">{pendingFile.name}</span>
              <span className="opacity-60 shrink-0">
                {uploading
                  ? `${uploadPct}%`
                  : uploadError
                    ? "Failed"
                    : `${(pendingFile.size / 1024).toFixed(0)} KB`}
              </span>
              {uploading ? (
                <button
                  type="button"
                  onClick={cancelUpload}
                  aria-label="Cancel upload"
                  className="grid h-6 w-6 place-items-center rounded-full hover:bg-background"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : uploadError ? (
                <>
                  <button
                    type="button"
                    onClick={retryUpload}
                    aria-label="Retry upload"
                    className="grid h-6 w-6 place-items-center rounded-full hover:bg-background text-lime"
                  >
                    <RotateCw className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={clearPending}
                    aria-label="Remove attachment"
                    className="grid h-6 w-6 place-items-center rounded-full hover:bg-background"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={clearPending}
                  aria-label="Remove attachment"
                  className="grid h-6 w-6 place-items-center rounded-full hover:bg-background"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {(uploading || uploadPct > 0) && !uploadError && (
              <div className="h-1 w-full overflow-hidden rounded-full bg-background">
                <div
                  className="h-full bg-lime-gradient transition-[width] duration-150"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            )}
            {uploadError && (
              <div className="text-[11px] text-destructive">{uploadError}. Tap retry to try again.</div>
            )}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={sending}
            aria-label="Attach file"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-border bg-surface text-foreground disabled:opacity-50"
          >
            <Paperclip className="h-4 w-4" />
          </button>
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
          <button type="submit" disabled={sending || (!text.trim() && !pendingFile)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-lime-gradient text-primary-foreground disabled:opacity-50">
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      </form>
    </div>
  );
}


function timeShort(iso: string) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
