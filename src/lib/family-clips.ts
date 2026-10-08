/**
 * Visibility tiers for a family post (a parent's clip of their under-13 child):
 *
 *   Private        the parent, and the linked child (read-only)       [default]
 *   Team & coaches verified members and staff of ONE team the parent chose
 *   Protected link a private link the parent sends
 *   Public         never; the database keeps a family post off the feed,
 *                  profiles and other members
 *
 * The rules live in the database (20261008170000_family_post_team_tier.sql); this
 * module only words its error codes for people.
 */

export type FamilyClipVia = "owner" | "child" | "team";

export function familyClipVia(v: unknown): FamilyClipVia | null {
  return v === "owner" || v === "child" || v === "team" ? v : null;
}

/** What a viewer is told about why they can see a clip. No names, ever. */
export function familyClipViaLabel(via: FamilyClipVia): string {
  if (via === "owner") return "A clip you added";
  return via === "child" ? "A clip your parent added of you" : "Shared with your team";
}

const TEAM_ERRORS: Record<string, string> = {
  FAMILY_TEAM_SHARE_OFF: "Sharing with a team isn't available yet.",
  FAMILY_TEAM_NOT_ALLOWED: "Turn on team sharing for this child in the Parent area first.",
  FAMILY_TEAM_NOT_FAMILY_POST: "Only a family clip can be shared with a team.",
  FAMILY_POST_NOT_GUARDIAN:
    "Only a verified parent or guardian of this child can choose who sees their clip.",
  FAMILY_TEAM_CHILD_NOT_ON_TEAM: "Your child isn't on that team.",
};

export function teamShareErrorMessage(err: unknown): string | null {
  const text =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message?: unknown }).message ?? "")
        : "";
  for (const [code, message] of Object.entries(TEAM_ERRORS)) {
    if (text.includes(code)) return message;
  }
  return null;
}
