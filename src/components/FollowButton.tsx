import { Link } from "@tanstack/react-router";
import { Clock, Loader2, UserCheck, UserPlus } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useFollow } from "@/lib/follows";

type Props = {
  userId: string;
  /** Compact pill for feed cards; default is a full-size button. */
  size?: "sm" | "md";
  className?: string;
};

/**
 * Shared Follow / Requested / Following toggle so profiles and the highlight feed behave
 * identically. Signed-out viewers get a sign-in link instead of a dead button.
 */
export function FollowButton({ userId, size = "md", className = "" }: Props) {
  const { user } = useAuth();
  const follow = useFollow(userId);
  const isSelf = user?.id === userId;

  const base =
    size === "sm"
      ? "inline-flex shrink-0 items-center gap-1 rounded-full px-3 py-1 text-[11px] font-bold"
      : "inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold";
  const icon = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  if (isSelf) return null;

  if (!user) {
    return (
      <Link
        to="/auth"
        className={`${base} border border-border text-foreground hover:border-lime ${className}`}
      >
        <UserPlus className={icon} /> Follow
      </Link>
    );
  }

  const label = follow.isFollowing ? "Following" : follow.requested ? "Requested" : "Follow";
  const settled = follow.isFollowing || follow.requested;

  return (
    <button
      type="button"
      onClick={() => follow.toggle()}
      disabled={follow.pending || follow.loading}
      aria-pressed={settled}
      aria-label={follow.requested ? "Requested. Tap to withdraw your follow request" : undefined}
      className={`${base} ${
        settled
          ? "border border-border text-muted-foreground hover:border-coral hover:text-coral"
          : "bg-lime-gradient text-primary-foreground"
      } disabled:opacity-60 ${className}`}
    >
      {follow.pending ? (
        <Loader2 className={`${icon} animate-spin`} />
      ) : follow.isFollowing ? (
        <UserCheck className={icon} />
      ) : follow.requested ? (
        <Clock className={icon} />
      ) : (
        <UserPlus className={icon} />
      )}
      {label}
    </button>
  );
}
