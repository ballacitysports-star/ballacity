/**
 * Age-aware "Who can see this?" copy for the Reel page. Display only: the
 * database (reel_audience / family_post_viewer_access) stays the authority.
 */
export type ReelPrivacyCohort =
  | "child_under_13"
  | "teen_13_15"
  | "teen_16_17"
  | "adult"
  | "unknown"
  | null
  | undefined;

export interface ReelPrivacyInfo {
  summary: string;
  detail: string;
  /** Visibility choices shown (locked = needs a guardian). */
  options: { label: string; note: string; locked: boolean; isDefault: boolean }[];
  guardianControlled: boolean;
}

export function reelPrivacyFor(
  cohort: ReelPrivacyCohort,
  opts: { familyPost?: boolean } = {},
): ReelPrivacyInfo {
  if (opts.familyPost || cohort === "teen_13_15" || cohort === "child_under_13") {
    const under13 = cohort === "child_under_13" && !opts.familyPost;
    return {
      summary: under13
        ? "Private to your family and approved team spaces. Never public."
        : "Private by default. A verified guardian may share with approved teams and coaches. Not shown publicly.",
      detail:
        "This reel will not appear on public profiles, search, or Highlights.",
      options: [
        { label: "Guardian only", note: "Default", locked: false, isDefault: true },
        {
          label: "Verified team & coaches",
          note: "Guardian approval required",
          locked: !opts.familyPost,
          isDefault: false,
        },
      ],
      guardianControlled: true,
    };
  }
  if (cohort === "teen_16_17") {
    return {
      summary: "Visible to signed-in BallaCity members when shared. Public discovery is off.",
      detail: "Your reel won't appear for signed-out visitors or in public search.",
      options: [],
      guardianControlled: false,
    };
  }
  return {
    // Adults have two states today: a draft only they can see, and a posted reel
    // that is public. Say exactly that; there is no team-only or members choice.
    summary: "Private until you post. Posted reels appear on your profile and public Highlights.",
    detail: "Drafts are visible only to you. Once you post a reel, anyone can see it on your profile and public Highlights.",
    options: [],
    guardianControlled: false,
  };
}
