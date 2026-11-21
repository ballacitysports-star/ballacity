import { Link } from "@tanstack/react-router";
import { Loader2, UserCheck, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useEntityFollow, type EntityKind } from "@/lib/entity-follows";
import { useAuthSearchHere } from "@/lib/auth-return";

type Props = {
  kind: EntityKind;
  id: string;
  /** Used in the accessible label, e.g. "Follow Lakeside FC". */
  name: string;
  className?: string;
  /** "sm" for cards in lists (Discover, P2-5). */
  size?: "md" | "sm";
};

/**
 * Follow / Following for a team, trainer or facility. The page decides whether to render
 * it at all (not for the owner, not for an unclaimed listing); the database refuses those
 * anyway. Signed-out viewers get a sign-in link instead of a dead button.
 */
export function FollowEntityButton({ kind, id, name, className = "", size = "md" }: Props) {
  const { user } = useAuth();
  const authSearch = useAuthSearchHere();
  const follow = useEntityFollow(kind, id);
  const base =
    size === "sm"
      ? "inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold"
      : "inline-flex items-center gap-1.5 rounded-full px-5 py-2.5 text-sm font-bold";

  if (!user) {
    return (
      <Link
        to="/auth"
        search={authSearch}
        aria-label={`Sign in to follow ${name}`}
        className={`${base} bg-lime-gradient text-primary-foreground ${className}`}
      >
        <UserPlus className="h-4 w-4" /> Follow
      </Link>
    );
  }

  return (
    <button
      type="button"
      onClick={() => follow.toggle()}
      disabled={follow.pending || follow.loading}
      aria-pressed={follow.following}
      aria-label={follow.following ? `Following ${name}. Tap to unfollow` : `Follow ${name}`}
      className={`${base} ${
        follow.following
          ? "border border-border bg-surface text-foreground hover:border-coral hover:text-coral"
          : "bg-lime-gradient text-primary-foreground"
      } disabled:opacity-60 ${className}`}
    >
      {follow.pending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : follow.following ? (
        <UserCheck className="h-4 w-4" />
      ) : (
        <UserPlus className="h-4 w-4" />
      )}
      {follow.following ? "Following" : "Follow"}
    </button>
  );
}

/** "12 followers" for the owner's own page. Who they are is never shown. */
export function EntityFollowerCount({ kind, id }: { kind: EntityKind; id: string }) {
  const { followers } = useEntityFollow(kind, id);
  if (followers === null) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2.5 text-sm font-bold text-muted-foreground">
      <UserCheck className="h-3.5 w-3.5" />
      {followers === 1 ? "1 follower" : `${followers.toLocaleString()} followers`}
    </span>
  );
}
