import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { Loader2, Pencil, SmilePlus, Trash2, X, Check } from "lucide-react";
import { toast } from "sonner";
import {
  REACTION_EMOJI,
  createComment,
  deleteComment,
  listComments,
  listMyReactions,
  listReactions,
  toggleReaction,
  updateComment,
  type ReactionEmoji,
  type EngagementSubjectType,
} from "@/lib/post-engagement.functions";
import { UserAvatar } from "@/components/UserAvatar";
import { useAuth } from "@/hooks/use-auth";
import { useMyChildStatus } from "@/lib/child-safety";
import { supabase } from "@/integrations/supabase/client";
import { formatWhen } from "@/lib/format";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

type Props = {
  subjectType: EngagementSubjectType;
  subjectId: string;
};

export function PostEngagement({ subjectType, subjectId }: Props) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const { can: canChildFeature } = useMyChildStatus();
  const commentsDecision = canChildFeature("comments");
  const [body, setBody] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBody, setEditBody] = useState("");

  const listCommentsFn = useServerFn(listComments);
  const listReactionsFn = useServerFn(listReactions);
  const listMyReactionsFn = useServerFn(listMyReactions);
  const createCommentFn = useServerFn(createComment);
  const deleteCommentFn = useServerFn(deleteComment);
  const updateCommentFn = useServerFn(updateComment);
  const toggleReactionFn = useServerFn(toggleReaction);

  const commentsKey = ["post-comments", subjectType, subjectId];
  const reactionsKey = ["post-reactions", subjectType, subjectId];
  const myReactionsKey = ["post-reactions-mine", subjectType, subjectId, user?.id ?? "anon"];

  const commentsQ = useQuery({
    queryKey: commentsKey,
    queryFn: () => listCommentsFn({ data: { subjectType, subjectId } }),
  });
  const reactionsQ = useQuery({
    queryKey: reactionsKey,
    queryFn: () => listReactionsFn({ data: { subjectType, subjectId } }),
  });
  const myReactionsQ = useQuery({
    queryKey: myReactionsKey,
    queryFn: () => listMyReactionsFn({ data: { subjectType, subjectId } }),
    enabled: !!user,
  });

  // Realtime — invalidate on any change
  useEffect(() => {
    const channel = supabase
      .channel(`engagement:${subjectType}:${subjectId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "post_comments",
          filter: `subject_id=eq.${subjectId}`,
        },
        () => qc.invalidateQueries({ queryKey: commentsKey }),
      )
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "post_reactions",
          filter: `subject_id=eq.${subjectId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: reactionsKey });
          qc.invalidateQueries({ queryKey: myReactionsKey });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectType, subjectId, user?.id]);

  const createMut = useMutation({
    mutationFn: (text: string) =>
      createCommentFn({ data: { subjectType, subjectId, body: text } }),
    onSuccess: () => {
      setBody("");
      qc.invalidateQueries({ queryKey: commentsKey });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not post comment"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCommentFn({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: commentsKey }),
    onError: (e: any) => toast.error(e?.message ?? "Could not delete"),
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: string }) =>
      updateCommentFn({ data: { id, body } }),
    onSuccess: () => {
      setEditingId(null);
      setEditBody("");
      qc.invalidateQueries({ queryKey: commentsKey });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update"),
  });

  const toggleMut = useMutation({
    mutationFn: (emoji: ReactionEmoji) =>
      toggleReactionFn({ data: { subjectType, subjectId, emoji } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: reactionsKey });
      qc.invalidateQueries({ queryKey: myReactionsKey });
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not react"),
  });

  const mine = new Set(myReactionsQ.data ?? []);
  const reactions = reactionsQ.data ?? [];
  const summary = REACTION_EMOJI.map((e) => {
    const r = reactions.find((x) => x.emoji === e);
    return { emoji: e, count: r?.count ?? 0, mine: mine.has(e) };
  }).filter((r) => r.count > 0 || r.mine);

  const handleReact = (emoji: ReactionEmoji) => {
    if (!user) {
      toast.message("Sign in to react");
      return;
    }
    toggleMut.mutate(emoji);
  };

  const handlePost = () => {
    const trimmed = body.trim();
    if (!trimmed) return;
    if (!user) {
      toast.message("Sign in to comment");
      return;
    }
    if (!commentsDecision.allowed) {
      toast.error(
        commentsDecision.reason || "A parent or guardian must approve this account first.",
      );
      return;
    }
    createMut.mutate(trimmed);
  };

  return (
    <div className="mt-4 space-y-4">
      {/* Reactions */}
      <div className="flex flex-wrap items-center gap-1.5">
        {summary.map((r) => (
          <button
            key={r.emoji}
            onClick={() => handleReact(r.emoji)}
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
              r.mine
                ? "border-lime/60 bg-lime/15 text-foreground"
                : "border-border bg-surface hover:border-lime/40"
            }`}
          >
            <span>{r.emoji}</span>
            <span className="tabular-nums">{r.count}</span>
          </button>
        ))}
        <Popover>
          <PopoverTrigger asChild>
            <button
              className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2.5 py-1 text-xs font-semibold text-muted-foreground hover:border-lime/40"
              aria-label="Add reaction"
            >
              <SmilePlus className="h-3.5 w-3.5" />
              {summary.length === 0 && <span>React</span>}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-1.5" align="start">
            <div className="flex gap-1">
              {REACTION_EMOJI.map((e) => (
                <button
                  key={e}
                  onClick={() => handleReact(e)}
                  className="rounded-full p-1.5 text-lg transition hover:bg-secondary"
                  aria-label={`React ${e}`}
                >
                  {e}
                </button>
              ))}
            </div>
          </PopoverContent>
        </Popover>
      </div>

      {/* Comments header */}
      <div className="flex items-center justify-between">
        <h3 className="font-display text-sm font-bold uppercase tracking-wider text-muted-foreground">
          Comments {commentsQ.data ? `· ${commentsQ.data.length}` : ""}
        </h3>
      </div>

      {/* Composer */}
      {user ? (
        <div className="rounded-2xl border border-border bg-surface p-3">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value.slice(0, 1000))}
            placeholder={
              commentsDecision.allowed ? "Add a comment…" : "Parent approval needed to comment"
            }
            rows={2}
            disabled={!commentsDecision.allowed}
            className="w-full resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">{body.length}/1000</span>
            <button
              onClick={handlePost}
              disabled={!body.trim() || createMut.isPending || !commentsDecision.allowed}
              className="inline-flex items-center gap-1.5 rounded-full bg-lime-gradient px-4 py-1.5 text-xs font-bold text-primary-foreground disabled:opacity-50"
            >
              {createMut.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
              Post
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border bg-surface/60 p-3 text-center text-xs text-muted-foreground">
          <Link to="/auth" className="font-semibold text-lime underline-offset-2 hover:underline">
            Sign in
          </Link>{" "}
          to join the discussion.
        </div>
      )}

      {/* Comments list */}
      <div className="space-y-3">
        {commentsQ.isLoading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : (commentsQ.data ?? []).length === 0 ? (
          <p className="py-2 text-center text-xs text-muted-foreground">
            Be the first to comment.
          </p>
        ) : (
          (commentsQ.data ?? []).map((c) => {
            const isMine = user?.id === c.authorId;
            const isDeleted = !!c.deletedAt;
            return (
              <div key={c.id} className="flex gap-2.5">
                <UserAvatar
                  avatarUrl={c.authorAvatar}
                  initials={c.authorInitials}
                  name={c.authorName}
                  size="sm"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-bold truncate">
                      {c.authorName ?? "Player"}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {formatWhen(c.createdAt)}
                    </span>
                    {isMine && !isDeleted && editingId !== c.id && (
                      <div className="ml-auto flex items-center gap-0.5">
                        <button
                          onClick={() => {
                            setEditingId(c.id);
                            setEditBody(c.body);
                          }}
                          className="rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-lime"
                          aria-label="Edit comment"
                        >
                          <Pencil className="h-3 w-3" />
                        </button>
                        <button
                          onClick={() => deleteMut.mutate(c.id)}
                          className="rounded-full p-1 text-muted-foreground transition hover:bg-secondary hover:text-coral"
                          aria-label="Delete comment"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                  </div>
                  {editingId === c.id ? (
                    <div className="mt-1 rounded-xl border border-border bg-surface p-2">
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value.slice(0, 1000))}
                        rows={2}
                        className="w-full resize-none bg-transparent text-sm outline-none"
                        autoFocus
                      />
                      <div className="mt-1 flex items-center justify-between">
                        <span className="text-[10px] text-muted-foreground">
                          {editBody.length}/1000
                        </span>
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              setEditingId(null);
                              setEditBody("");
                            }}
                            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary"
                          >
                            <X className="h-3 w-3" /> Cancel
                          </button>
                          <button
                            onClick={() => {
                              const t = editBody.trim();
                              if (!t || t === c.body) {
                                setEditingId(null);
                                setEditBody("");
                                return;
                              }
                              updateMut.mutate({ id: c.id, body: t });
                            }}
                            disabled={updateMut.isPending || !editBody.trim()}
                            className="inline-flex items-center gap-1 rounded-full bg-lime-gradient px-2.5 py-1 text-[11px] font-bold text-primary-foreground disabled:opacity-50"
                          >
                            {updateMut.isPending ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Check className="h-3 w-3" />
                            )}
                            Save
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p
                      className={`whitespace-pre-wrap break-words text-sm ${
                        isDeleted ? "italic text-muted-foreground" : "text-foreground/90"
                      }`}
                    >
                      {isDeleted ? "Comment deleted" : c.body}
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
