import type { AgeCohort } from "@/lib/child-policy";

/**
 * Pure rules for network posts (P1-2), shared by client code and server functions. The
 * database is the authority on who may post what and who can read it (guard_post_write,
 * private_sec.can_view_post); these only decide what the composer offers and how a
 * refusal reads, and must never be looser than the database.
 */
export type PostAudience = "public" | "followers" | "team" | "family";
export type PostedAs = "person" | "team" | "org";

export const AUDIENCE_LABELS: Record<PostAudience, { label: string; description: string }> = {
  public: { label: "Everyone", description: "Anyone on BallaCity, signed in or not." },
  followers: { label: "Followers", description: "People who follow you." },
  team: { label: "My team", description: "Members of the team you pick." },
  family: { label: "Family", description: "Your linked parents, guardians or children." },
};

/** What a person of this age may post to. Mirrors private_sec.post_audiences_allowed. */
export function audiencesForCohort(cohort: AgeCohort): PostAudience[] {
  switch (cohort) {
    case "adult":
      return ["public", "followers", "team", "family"];
    case "teen_16_17":
      return ["followers", "team", "family"];
    case "teen_13_15":
      return ["team", "family"];
    default:
      return [];
  }
}

/** A team posts publicly or to its members; a facility posts publicly. */
export function audiencesForEntity(postedAs: Exclude<PostedAs, "person">): PostAudience[] {
  return postedAs === "team" ? ["public", "team"] : ["public"];
}

/** Turns a database refusal into words for the member. Unknown errors pass through. */
export function postErrorMessage(message: string): string {
  if (/POST_LOCKED/.test(message))
    return "A parent or guardian needs to approve your account first.";
  if (/POST_AGE_NOT_ALLOWED/.test(message)) return "Posting isn't available for your account.";
  if (/POST_AUDIENCE_NOT_ALLOWED/.test(message))
    return "You can't share a post with that audience.";
  if (/POST_TARGET_INVALID/.test(message)) return "You can't post for that team or facility.";
  if (/POST_DELETED/.test(message)) return "That post was deleted.";
  return message;
}

export const NETWORK_POSTS_SETTING_KEY = "network_posts";

/** Reads {"enabled": boolean}; anything else is off. */
export function parseNetworkPostsFlag(value: unknown): boolean {
  return !!value && typeof value === "object" && (value as { enabled?: unknown }).enabled === true;
}
