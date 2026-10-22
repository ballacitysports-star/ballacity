/**
 * Who can watch a reel, by age. One source for the Reels page panel, the Parent Center
 * and the policy page, so the words never drift apart.
 *
 * This only explains the rules. The authority is the database: reel_audience() and
 * teen_reel_viewer_access() decide, and nothing here widens anything.
 */

import type { AgeCohort } from "@/lib/child-policy";

export const REEL_PRIVACY_PATH = "/reel-privacy";

export type PrivacyBand = "under_13" | "teen_13_15" | "teen_16_17" | "adult";

export function privacyBandFor(cohort: AgeCohort | string | null | undefined): PrivacyBand | null {
  switch (cohort) {
    case "child_under_13":
      return "under_13";
    case "teen_13_15":
      return "teen_13_15";
    case "teen_16_17":
      return "teen_16_17";
    case "adult":
      return "adult";
    default:
      return null; // unknown age: show nothing rather than guess
  }
}

export type BandCopy = {
  band: PrivacyBand;
  ageLabel: string;
  /** One line, shown collapsed. */
  summary: string;
  /** Who can see a reel, shown expanded. */
  audiences: string[];
  /** What is never allowed for this age. */
  never: string[];
};

export const BAND_COPY: Record<PrivacyBand, BandCopy> = {
  under_13: {
    band: "under_13",
    ageLabel: "Under 13",
    summary: "Private to your family and approved team spaces. Never public.",
    audiences: [
      "You and your parent or guardian.",
      "If your parent turns it on, one team you are on, through a parent-added family clip.",
    ],
    never: ["The highlights feed", "Public profiles", "Search", "Other members"],
  },
  teen_13_15: {
    band: "teen_13_15",
    ageLabel: "13 to 15",
    summary:
      "Private by default. A verified guardian may share with approved teams and coaches. Not shown publicly.",
    audiences: [
      "Guardian only (the default for every reel): you and your verified parent or guardian.",
      "Verified team & coaches: only if a parent or guardian approves it for one team you are on.",
    ],
    never: [
      "Public profiles, search or the highlights feed",
      "All signed-in members",
      "Followers",
      "Share links",
    ],
  },
  teen_16_17: {
    band: "teen_16_17",
    ageLabel: "16 to 17",
    summary: "Private by default. Approved followers can watch if you allow it. Never public.",
    audiences: [
      "You, always, and your verified parent or guardian.",
      "If you choose Followers: people you have approved who follow you. An adult follower also has to share a team with you.",
    ],
    never: [
      "Anonymous visitors",
      "All signed-in members",
      "Public Highlights or discovery",
      "Search engines",
    ],
  },
  adult: {
    band: "adult",
    ageLabel: "18 and over",
    summary:
      "Private until you post. By default posted reels are public; you can limit them to followers.",
    audiences: [
      "Drafts: only you.",
      "Everyone (the default): anyone, on your profile and the public Highlights feed.",
      "Followers: only people you have approved as followers.",
      "Only me: only you.",
    ],
    never: [],
  },
};

export function bandCopyFor(cohort: AgeCohort | string | null | undefined): BandCopy | null {
  const b = privacyBandFor(cohort);
  return b ? BAND_COPY[b] : null;
}

/** The two choices a 13-15 reel can have. A player never picks the second one. */
export const TEEN_REEL_OPTIONS = [
  {
    value: "guardian" as const,
    label: "Guardian only",
    hint: "You and your verified parent or guardian. This is the default.",
  },
  {
    value: "team" as const,
    label: "Verified team & coaches",
    hint: "One team you are on. Only a parent or guardian can approve this.",
  },
];

export const TEEN_RESTRICTION =
  "This reel will not appear on public profiles, search, or Highlights.";

export type TeenReelState = "guardian" | "team";

/** A reel's current state for a 13-15 player, from the stored columns. */
export function teenReelState(r: {
  team_share_team_id?: string | null;
  guardian_team_approved_by?: string | null;
}): TeenReelState {
  return r.team_share_team_id && r.guardian_team_approved_by ? "team" : "guardian";
}

const TEEN_ERRORS: Record<string, string> = {
  TEEN_TEAM_NOT_AVAILABLE: "Team sharing is only available for reels from ages 13 to 15.",
  TEEN_TEAM_GUARDIAN_ONLY: "Only a verified parent or guardian can approve this.",
  TEEN_TEAM_INCOMPLETE: "Choose a team to approve.",
  TEEN_TEAM_NOT_ON_TEAM: "Your child needs to be on that team.",
  TEEN_TEAM_NOT_READY: "The reel has to be finished, posted and not on hold first.",
};

export function teenReelErrorMessage(err: unknown): string | null {
  const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  for (const [code, msg] of Object.entries(TEEN_ERRORS)) if (text.includes(code)) return msg;
  return null;
}
