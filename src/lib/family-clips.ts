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

import { knownErrorMessage } from "@/lib/user-error";

export type FamilyClipVia = "owner" | "child" | "team";

export function familyClipVia(v: unknown): FamilyClipVia | null {
  return v === "owner" || v === "child" || v === "team" ? v : null;
}

/** What a viewer is told about why they can see a clip. No names, ever. */
export function familyClipViaLabel(via: FamilyClipVia): string {
  if (via === "owner") return "A clip you added";
  return via === "child" ? "A clip your parent added of you" : "Shared with your team";
}

export function teamShareErrorMessage(err: unknown): string | null {
  return knownErrorMessage(err) ?? null;
}
