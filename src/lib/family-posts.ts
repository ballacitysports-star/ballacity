/**
 * Family posts: a parent uploads a clip of their under-13 child to the PARENT's
 * account, tagged to the child. Step one is private: only the parent who owns the
 * reel can see it, never the feed, a profile, or other members. The database
 * enforces every rule (see 20261008150000_family_posts.sql); this module only
 * turns its error codes into words a person can act on.
 */

const MESSAGES: Record<string, string> = {
  FAMILY_POSTS_OFF: "Family posts aren't available yet.",
  FAMILY_POST_NOT_GUARDIAN:
    "Only a verified parent or guardian of this child can add a clip of them.",
  FAMILY_POST_UNDER_13_ONLY: "Family posts are only for children under 16.",
  FAMILY_POST_UNDER_16_ONLY: "Family posts are only for children under 16.",
  FAMILY_POST_AI_OFF:
    "Turn on AI video analysis for this child in the Parent Center first. Every clip is analysed by AI.",
};

/** A friendly message when `err` carries a family-post code, otherwise null. */
export function familyPostErrorMessage(err: unknown): string | null {
  const text =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "";
  for (const [code, message] of Object.entries(MESSAGES)) {
    if (text.includes(code)) return message;
  }
  return null;
}
