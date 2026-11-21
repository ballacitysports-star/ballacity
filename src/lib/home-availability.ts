/**
 * WP 1.6: what the "I'm available" card at the top of Home says, and the switch that turns the availability-first Home on
 * and off.
 *
 * The card summarizes the member's own posts with the same rules as My availability (listingFor in availability-lifecycle),
 * so the two never disagree. It never decides who sees a post; the database does.
 */
import { listingFor, type LifecyclePost, type Listing } from "./availability-lifecycle";

/** app_settings row for the switch. Public, so every member's app can read it. */
export const HOME_AVAILABILITY_SETTING_KEY = "home_availability_first";

/**
 * On unless the row says {"enabled": false}: a missing or unreadable row keeps the new Home, and a Super admin turns it off
 * by writing false. Anything other than a literal false counts as on, so a malformed value never hides the card by accident.
 */
export function parseHomeAvailabilitySetting(value: unknown): boolean {
  if (value && typeof value === "object" && (value as { enabled?: unknown }).enabled === false) {
    return false;
  }
  return true;
}

export type HomePost = LifecyclePost & { id: string; sports?: string[] | null };

export type HomeAvailabilitySummary =
  /** No post that is listed or worth acting on: invite the member to post. */
  | { kind: "none" }
  /** At least one post is listed and nothing needs the member. */
  | { kind: "listed"; post: HomePost; listing: Listing; count: number }
  /** A post has run out or is about to; `canReconfirm` posts take "Still available" in one tap. */
  | { kind: "attention"; post: HomePost; listing: Listing; count: number };

/**
 * The one post the card talks about:
 * - a post that needs the member (about to run out, or run out) comes first, soonest first;
 * - otherwise the listed post that stays listed the longest;
 * - paused, closed and guardian-closed posts are left to My availability.
 * `count` is how many posts are listed or need attention, so the card can say "and 2 more".
 */
export function summarizeHomeAvailability(
  posts: readonly HomePost[],
  now: Date = new Date(),
): HomeAvailabilitySummary {
  const rows = posts.map((post) => ({ post, listing: listingFor(post, now) }));
  const attention = rows
    .filter(
      (r) => r.listing.needsAttention && (r.listing.state === "listed" || r.listing.recurring),
    )
    .sort((a, b) => time(a.listing.expiresAt, Infinity) - time(b.listing.expiresAt, Infinity));
  const listed = rows
    .filter((r) => r.listing.state === "listed" && !r.listing.needsAttention)
    .sort((a, b) => time(b.listing.expiresAt, -Infinity) - time(a.listing.expiresAt, -Infinity));
  const count = attention.length + listed.length;
  if (attention.length > 0) return { kind: "attention", ...attention[0], count };
  if (listed.length > 0) return { kind: "listed", ...listed[0], count };
  return { kind: "none" };
}

function time(d: Date | null, fallback: number): number {
  return d ? d.getTime() : fallback;
}

/** "Basketball", "Basketball and Soccer", "Basketball, Soccer and 1 more". */
export function sportsLabel(sports: readonly string[] | null | undefined): string {
  const list = (sports ?? []).filter((s) => typeof s === "string" && s.trim());
  if (list.length === 0) return "Your availability";
  if (list.length === 1) return list[0];
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list[0]}, ${list[1]} and ${list.length - 2} more`;
}
