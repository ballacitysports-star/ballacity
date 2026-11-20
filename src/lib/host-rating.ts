import { type Reputation } from "@/lib/reviews";

/**
 * The host's rating as the game page shows it, from the live reviews the page
 * already reads (useReviewsFor + computeReputation, the same numbers as the
 * reputation badge and the reviews popup). Null when there are no reviews, so
 * nothing is shown.
 *
 * It replaces `game.host.rating`, the publish-time snapshot in
 * hosted_games.host_snapshot: it never changes after publishing and defaults to
 * 5, so a host with no reviews read "★ 5".
 */
export function liveHostRating(rep: Pick<Reputation, "avg" | "count">): {
  stars: string;
  reviews: string;
} | null {
  if (!rep.count || !Number.isFinite(rep.avg) || rep.avg <= 0) return null;
  return {
    stars: rep.avg.toFixed(1),
    reviews: `${rep.count} review${rep.count === 1 ? "" : "s"}`,
  };
}
