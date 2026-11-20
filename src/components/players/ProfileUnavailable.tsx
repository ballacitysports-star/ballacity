import { Link } from "@tanstack/react-router";
import { ArrowLeft, Lock } from "lucide-react";
import { FALLBACK_ACTION_CLASS } from "@/components/layout/RouteFallback";

/**
 * What a player profile or player card shows when the viewer gets nothing back.
 *
 * The usual reason is a privacy rule (the player's visibility setting or the rules
 * for minors), not a deleted account. The page cannot tell those apart, and must
 * not: the same heading and sentence show whether the person does not exist, is
 * private, or is age-restricted, so the screen never reveals which (WP 4.0).
 *
 * Only what the database hides lands here. The profiles read rule does not check
 * blocks today, and the /players page does not filter suspended accounts (the
 * player card does), so neither is promised by this screen.
 */
export const PROFILE_UNAVAILABLE_COPY = {
  profile: {
    title: "Profile unavailable",
    message: "This profile is private or unavailable.",
  },
  card: {
    title: "Player card unavailable",
    message: "This player card is private or unavailable.",
  },
} as const;

export const PROFILE_UNAVAILABLE_HINT = "You can still find other players near you.";

export function ProfileUnavailable({ kind }: { kind: keyof typeof PROFILE_UNAVAILABLE_COPY }) {
  const copy = PROFILE_UNAVAILABLE_COPY[kind];
  return (
    <div className="page-shell-content pt-6 pb-24">
      <Link to="/players" className="inline-flex items-center gap-1 text-sm text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to players
      </Link>
      <div className="mt-4 rounded-2xl border border-dashed border-border bg-surface/40 p-8 text-center">
        <Lock className="mx-auto h-6 w-6 text-muted-foreground" aria-hidden />
        <h1 className="mt-2 font-semibold">{copy.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{copy.message}</p>
        <p className="mt-1 text-sm text-muted-foreground">{PROFILE_UNAVAILABLE_HINT}</p>
        <Link to="/players" className={`mt-4 ${FALLBACK_ACTION_CLASS}`}>
          Find players
        </Link>
      </div>
    </div>
  );
}
