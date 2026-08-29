import { createFileRoute, Link } from "@tanstack/react-router";
import { pageHead } from "@/lib/seo";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  Send,
  Paperclip,
  X,
  Loader2,
  RotateCw,
  Smile,
  Reply,
  Trash2,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  getConversationOther,
  listMessages,
  markConversationRead,
  sendMessage,
  uploadMessageAttachment,
  unsendMessage,
  acceptConversation,
  declineConversation,
  addReaction,
  removeReaction,
  listReactionsFor,
  REACTION_EMOJIS,
  type Message,
  type MessageReaction,
} from "@/lib/messages";
import { MessageAttachment } from "@/components/MessageAttachment";
import { UserAvatar, UserAvatarById } from "@/components/UserAvatar";
import { usePrefetchUserAvatars } from "@/lib/user-avatars";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/messages/$conversationId")({
  head: () =>
    pageHead({
      title: "Chat — OpenRun",
      description: "A private OpenRun conversation.",
      noindex: true,
    }),
  component: Thread,
});

type Other = {
  user_id: string;
  display_name: string;
  avatar_initials: string | null;
  avatar_url: string | null;
};

function Thread() {
  const { conversationId } = Route.useParams();
  const { user, loading } = useAuth();
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [reactions, setReactions] = useState<MessageReaction[]>([]);
  const [other, setOther] = useState<Other | null>(null);
  const [isRequest, setIsRequest] = useState(false);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [reactPickerFor, setReactPickerFor] = useState<string | null>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [otherTyping, setOtherTyping] = useState(false);
  const [otherPresent, setOtherPresent] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);

  const msgById = useMemo(() => {
    const m = new Map<string, Message>();
    for (const x of msgs) m.set(x.id, x);
    return m;
  }, [msgs]);

  const reactionsByMsg = useMemo(() => {
    const m = new Map<string, MessageReaction[]>();
    for (const r of reactions) {
      const arr = m.get(r.message_id) ?? [];
      arr.push(r);
      m.set(r.message_id, arr);
    }
    return m;
  }, [reactions]);

  const refreshReactions = async (ids: string[]) => {
    const r = await listReactionsFor(ids);
    setReactions(r);
  };

  useEffect(() => {
    if (loading || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const [m, o, conv] = await Promise.all([
          listMessages(conversationId),
          getConversationOther(conversationId),
          supabase
            .from("conversations" as any)
            .select("accepted_by")
            .eq("id", conversationId)
            .maybeSingle(),
        ]);
        if (cancelled) return;
        setMsgs(m);
        setOther(o);
        const accepted: string[] = ((conv.data as any)?.accepted_by ?? []) as string[];
        setIsRequest(!accepted.includes(user.id));
        if (m.length) await refreshReactions(m.map((x) => x.id));
        await markConversationRead(conversationId);
      } catch (e: any) {
        toast.error(e.message);
      }
    })();

    const channel = supabase.channel(`thread-${conversationId}`, {
      config: { presence: { key: user.id } },
    });
    channelRef.current = channel;

    channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          setMsgs((prev) => [...prev, payload.new as Message]);
          markConversationRead(conversationId);
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as Message;
          setMsgs((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
        },
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => {
          const r = payload.new as MessageReaction;
          setReactions((prev) =>
            prev.some(
              (x) =>
                x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji,
            )
              ? prev
              : [...prev, r],
          );
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => {
          const r = payload.old as MessageReaction;
          setReactions((prev) =>
            prev.filter(
              (x) =>
                !(x.message_id === r.message_id && x.user_id === r.user_id && x.emoji === r.emoji),
            ),
          );
        },
      )
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState() as Record<string, Array<{ typing?: boolean }>>;
        const otherKeys = Object.keys(state).filter((k) => k !== user.id);
        setOtherPresent(otherKeys.length > 0);
        const typing = otherKeys.some((k) => state[k]?.some((s) => s.typing));
        setOtherTyping(typing);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ typing: false, at: Date.now() });
        }
      });

    return () => {
      cancelled = true;
      if (typingTimer.current) clearTimeout(typingTimer.current);
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [conversationId, user?.id, loading]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [msgs.length, otherTyping]);

  const setTypingState = (typing: boolean) => {
    if (isTypingRef.current === typing) return;
    isTypingRef.current = typing;
    channelRef.current?.track({ typing, at: Date.now() });
  };

  const handleTextChange = (v: string) => {
    setText(v);
    setTypingState(true);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTypingState(false), 2500);
  };

  if (!loading && !user) {
    return (
      <div className="mx-auto max-w-md px-4 pt-10 text-center text-sm">
        <Link to="/auth" className="text-lime font-bold">
          Sign in to view this chat
        </Link>
      </div>
    );
  }

  const onPickFile = (file: File | null) => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Max attachment size is 20MB.");
      return;
    }
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
    try {
      await doUpload(pendingFile);
    } catch (e: any) {
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
      if (pendingFile) attachment = await doUpload(pendingFile);
      await sendMessage(conversationId, text, attachment, { replyToId: replyTo?.id ?? null });
      setText("");
      setReplyTo(null);
      setPendingFile(null);
      setUploadError(null);
      setUploadPct(0);
      setTypingState(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (e: any) {
      if (e?.name === "AbortError") {
        toast.message("Upload cancelled");
      } else {
        setUploadError(e?.message ?? "Send failed");
        toast.error(e.message);
      }
    } finally {
      setSending(false);
    }
  };

  const toggleReaction = async (messageId: string, emoji: string) => {
    if (!user) return;
    const mine = reactionsByMsg
      .get(messageId)
      ?.some((r) => r.user_id === user.id && r.emoji === emoji);
    setReactPickerFor(null);
    try {
      if (mine) await removeReaction(messageId, emoji);
      else await addReaction(messageId, emoji);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleUnsend = async (id: string) => {
    setMenuFor(null);
    try {
      await unsendMessage(id);
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleAccept = async () => {
    try {
      await acceptConversation(conversationId);
      setIsRequest(false);
      toast.success("Message request accepted");
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const handleDecline = async () => {
    try {
      await declineConversation(conversationId);
      window.history.back();
    } catch (e: any) {
      toast.error(e.message);
    }
  };

  const lastSeenId = useMemo(() => {
    if (!user) return null;
    const mine = msgs.filter((m) => m.sender_id === user.id && m.read_at);
    return mine.length ? mine[mine.length - 1].id : null;
  }, [msgs, user?.id]);

  return (
    <div className="flex h-dvh flex-col bg-background pb-[calc(env(safe-area-inset-bottom)+6rem)]">
      <header className="flex items-center gap-3 px-4 pt-4 pb-3 border-b border-border bg-background shrink-0">
        <Link
          to="/messages"
          className="grid h-10 w-10 place-items-center rounded-full border border-border bg-surface"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        {other?.user_id ? (
          <Link
            to="/players/$userId"
            params={{ userId: other.user_id }}
            aria-label={`View ${other.display_name}'s profile`}
            className="relative"
          >
            <UserAvatarById
              userId={other.user_id}
              avatarUrl={other.avatar_url}
              initials={other.avatar_initials}
              name={other.display_name}
              size="md"
              rounded="square"
            />
            {otherPresent && (
              <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-lime ring-2 ring-background" />
            )}
          </Link>
        ) : (
          <UserAvatar
            avatarUrl={other?.avatar_url}
            initials={other?.avatar_initials}
            name={other?.display_name}
            size="md"
            rounded="square"
          />
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
            <div className="font-semibold text-sm truncate">
              {other?.display_name ?? "Loading…"}
            </div>
          )}
          <div className="text-[10px] text-muted-foreground">
            {otherPresent ? "Active now" : "Offline"}
          </div>
        </div>
      </header>

      {isRequest && (
        <div className="border-b border-border bg-surface/60 px-4 py-3 flex items-center gap-2 text-xs">
          <div className="flex-1">
            <div className="font-semibold text-sm">Message request</div>
            <div className="text-muted-foreground">
              Accept to reply. They won't be notified until you accept.
            </div>
          </div>
          <button
            onClick={handleDecline}
            className="rounded-full border border-border bg-background px-3 py-1.5 font-semibold"
          >
            Decline
          </button>
          <button
            onClick={handleAccept}
            className="rounded-full bg-lime-gradient px-3 py-1.5 font-semibold text-primary-foreground"
          >
            Accept
          </button>
        </div>
      )}

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {msgs.length === 0 ? (
          <div className="text-center text-xs text-muted-foreground mt-10">
            No messages yet. Say hi 👋
          </div>
        ) : (
          msgs.map((m) => {
            const mine = m.sender_id === user?.id;
            const parent = m.reply_to_id ? msgById.get(m.reply_to_id) : null;
            const isDeleted = !!m.deleted_at;
            const rxs = reactionsByMsg.get(m.id) ?? [];
            const rxByEmoji = rxs.reduce<Record<string, MessageReaction[]>>((acc, r) => {
              (acc[r.emoji] ||= []).push(r);
              return acc;
            }, {});

            return (
              <div
                key={m.id}
                className={`flex items-end gap-2 ${mine ? "justify-end" : "justify-start"}`}
              >
                {!mine && (
                  <Link
                    to="/players/$userId"
                    params={{ userId: m.sender_id }}
                    aria-label={`View ${other?.display_name ?? "player"}'s profile`}
                    className="shrink-0 self-end"
                  >
                    <UserAvatarById
                      userId={m.sender_id}
                      avatarUrl={other?.avatar_url}
                      initials={other?.avatar_initials}
                      name={other?.display_name}
                      size="sm"
                    />
                  </Link>
                )}
                <div className="max-w-[78%] group relative">
                  {parent && (
                    <div
                      className={`mb-1 text-[11px] rounded-lg px-2.5 py-1.5 border-l-2 ${
                        mine ? "border-lime bg-surface/60 mr-1" : "border-border bg-surface/60 ml-1"
                      }`}
                    >
                      <div className="opacity-70 mb-0.5">
                        Replying to {parent.sender_id === user?.id ? "you" : other?.display_name}
                      </div>
                      <div className="opacity-80 truncate">
                        {parent.deleted_at
                          ? "Unsent message"
                          : parent.body ||
                            (parent.attachment_name ? `📎 ${parent.attachment_name}` : "")}
                      </div>
                    </div>
                  )}

                  <div className="flex items-end gap-1">
                    {mine && !isDeleted && (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <button
                          onClick={() => setReplyTo(m)}
                          className="grid h-7 w-7 place-items-center rounded-full hover:bg-surface"
                          aria-label="Reply"
                        >
                          <Reply className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setReactPickerFor(reactPickerFor === m.id ? null : m.id)}
                          className="grid h-7 w-7 place-items-center rounded-full hover:bg-surface"
                          aria-label="React"
                        >
                          <Smile className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setMenuFor(menuFor === m.id ? null : m.id)}
                          className="grid h-7 w-7 place-items-center rounded-full hover:bg-surface"
                          aria-label="More"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}

                    <div
                      onDoubleClick={() => !isDeleted && toggleReaction(m.id, "❤️")}
                      className={`rounded-2xl px-3 py-2 text-sm space-y-2 ${
                        isDeleted
                          ? "bg-surface/40 border border-dashed border-border text-muted-foreground italic"
                          : mine
                            ? "bg-lime-gradient text-primary-foreground"
                            : "bg-surface border border-border"
                      }`}
                    >
                      {isDeleted ? (
                        <div>{mine ? "You unsent a message" : "Message unsent"}</div>
                      ) : (
                        <>
                          {m.attachment_path && (
                            <MessageAttachment
                              path={m.attachment_path}
                              type={m.attachment_type}
                              name={m.attachment_name}
                              size={m.attachment_size}
                              mine={mine}
                            />
                          )}
                          {m.body && (
                            <div className="whitespace-pre-wrap break-words">{m.body}</div>
                          )}
                        </>
                      )}
                    </div>

                    {!mine && !isDeleted && (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <button
                          onClick={() => setReactPickerFor(reactPickerFor === m.id ? null : m.id)}
                          className="grid h-7 w-7 place-items-center rounded-full hover:bg-surface"
                          aria-label="React"
                        >
                          <Smile className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setReplyTo(m)}
                          className="grid h-7 w-7 place-items-center rounded-full hover:bg-surface"
                          aria-label="Reply"
                        >
                          <Reply className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )}
                  </div>

                  {reactPickerFor === m.id && (
                    <div
                      className={`mt-1 flex gap-0.5 rounded-full border border-border bg-background px-1.5 py-1 shadow-lg w-fit ${mine ? "ml-auto" : ""}`}
                    >
                      {REACTION_EMOJIS.map((e) => (
                        <button
                          key={e}
                          onClick={() => toggleReaction(m.id, e)}
                          className="h-8 w-8 text-lg hover:scale-125 transition-transform"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}

                  {menuFor === m.id && mine && !isDeleted && (
                    <div
                      className={`mt-1 rounded-xl border border-border bg-background shadow-lg overflow-hidden w-fit ${mine ? "ml-auto" : ""}`}
                    >
                      <button
                        onClick={() => handleUnsend(m.id)}
                        className="flex items-center gap-2 px-3 py-2 text-xs font-semibold text-coral hover:bg-surface w-full"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Unsend
                      </button>
                    </div>
                  )}

                  {Object.keys(rxByEmoji).length > 0 && (
                    <div className={`mt-1 flex gap-1 flex-wrap ${mine ? "justify-end" : ""}`}>
                      {Object.entries(rxByEmoji).map(([emoji, list]) => {
                        const mineRx = list.some((r) => r.user_id === user?.id);
                        return (
                          <button
                            key={emoji}
                            onClick={() => toggleReaction(m.id, emoji)}
                            className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] ${
                              mineRx ? "border-lime bg-lime/10" : "border-border bg-surface"
                            }`}
                          >
                            <span>{emoji}</span>
                            <span className="tabular-nums">{list.length}</span>
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div
                    className={`text-[10px] mt-1 opacity-60 flex items-center gap-1 ${mine ? "justify-end" : ""}`}
                  >
                    <span>{timeShort(m.created_at)}</span>
                    {mine && m.id === lastSeenId && !isDeleted && (
                      <span className="flex items-center gap-0.5">
                        <Check className="h-3 w-3" /> Seen
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {otherTyping && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-surface border border-border px-3 py-2 flex gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground animate-bounce" />
            </div>
          </div>
        )}
      </div>

      <form
        onSubmit={submit}
        className="sticky bottom-0 left-0 right-0 shrink-0 border-t border-border bg-background/95 backdrop-blur px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] z-20"
      >
        {replyTo && (
          <div className="mb-2 rounded-xl border-l-2 border-lime bg-surface px-3 py-2 text-xs flex items-start gap-2">
            <div className="flex-1 min-w-0">
              <div className="font-semibold mb-0.5">
                Replying to {replyTo.sender_id === user?.id ? "yourself" : other?.display_name}
              </div>
              <div className="opacity-70 truncate">
                {replyTo.body ||
                  (replyTo.attachment_name ? `📎 ${replyTo.attachment_name}` : "Attachment")}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              aria-label="Cancel reply"
              className="grid h-6 w-6 place-items-center rounded-full hover:bg-background"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

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
            {uploading && (
              <div className="h-1 rounded-full bg-background overflow-hidden">
                <div
                  className="h-full bg-lime-gradient transition-all"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex items-end gap-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach file"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
          />
          <textarea
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit(e as any);
              }
            }}
            rows={1}
            placeholder={isRequest ? "Accept to reply" : "Message…"}
            disabled={isRequest}
            className="flex-1 resize-none rounded-2xl border border-border bg-surface px-4 py-2.5 text-sm focus:outline-none focus:border-lime max-h-32 disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={sending || uploading || isRequest || (!text.trim() && !pendingFile)}
            aria-label="Send"
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-lime-gradient text-primary-foreground disabled:opacity-40"
          >
            {sending || uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}

function timeShort(iso: string) {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
