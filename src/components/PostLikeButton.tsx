import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Heart } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import {
  listMyReactions,
  listReactions,
  toggleReaction,
  type EngagementSubjectType,
} from "@/lib/post-engagement.functions";

/** The reaction a feed heart stands for. The full picker lives in the post's details. */
export const LIKE_EMOJI = "❤️" as const;

type Props = { subjectType: EngagementSubjectType; subjectId: string };

/**
 * A real Like: the heart is the ❤️ reaction, saved through toggleReaction and shared with
 * PostEngagement's queries, so the card and the opened post agree. The database decides
 * who may react (on a minor's content, only the minor, a guardian or a teammate). A
 * refusal shows as a toast and the heart stays as it was.
 */
export function PostLikeButton({ subjectType, subjectId }: Props) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const listFn = useServerFn(listReactions);
  const mineFn = useServerFn(listMyReactions);
  const toggleFn = useServerFn(toggleReaction);

  const reactionsKey = ["post-reactions", subjectType, subjectId];
  const mineKey = ["post-reactions-mine", subjectType, subjectId, user?.id ?? "anon"];

  const reactions = useQuery({
    queryKey: reactionsKey,
    queryFn: () => listFn({ data: { subjectType, subjectId } }),
  });
  const mine = useQuery({
    queryKey: mineKey,
    queryFn: () => mineFn({ data: { subjectType, subjectId } }),
    enabled: !!user,
  });

  const liked = (mine.data ?? []).includes(LIKE_EMOJI);
  const count = (reactions.data ?? []).find((r) => r.emoji === LIKE_EMOJI)?.count ?? 0;

  const toggle = useMutation({
    mutationFn: () => toggleFn({ data: { subjectType, subjectId, emoji: LIKE_EMOJI } }),
    onError: () => toast.error("You can't react to this post."),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: reactionsKey });
      qc.invalidateQueries({ queryKey: mineKey });
    },
  });

  const heart = (
    <Heart
      className={`h-6 w-6 ${liked ? "text-coral" : ""}`}
      fill={liked ? "currentColor" : "none"}
      strokeWidth={2}
    />
  );
  const base =
    "inline-flex h-11 min-w-11 items-center justify-center gap-1 rounded-full px-2 text-sm font-semibold text-foreground transition active:scale-90";
  const countLabel = count > 0 ? <span>{count}</span> : null;

  if (!user) {
    return (
      <Link
        to="/auth"
        aria-label="Sign in to like"
        className={base}
        onClick={(e) => e.stopPropagation()}
      >
        {heart}
        {countLabel}
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle.mutate();
      }}
      disabled={toggle.isPending || mine.isLoading}
      aria-pressed={liked}
      aria-label={liked ? "Unlike" : "Like"}
      className={`${base} disabled:opacity-60`}
    >
      {heart}
      {countLabel}
    </button>
  );
}
