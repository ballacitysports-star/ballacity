/**
 * Age-aware "Who can see this?" copy for the Reel page. Display only: the
 * database (reel_audience / family_post_viewer_access) stays the authority.
 */
export type ReelPrivacyCohort =
  "child_under_13" | "teen_13_15" | "teen_16_17" | "adult" | "unknown" | null | undefined;

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
      detail: "This reel will not appear on public profiles, search, or Highlights.",
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
      summary: "Private by default. Approved followers can watch if you allow it. Never public.",
      detail:
        "Your reel won't appear for signed-out visitors, in public search, or on public Highlights. You can let followers you've approved watch from Privacy settings.",
      options: [],
      guardianControlled: false,
    };
  }
  return {
    // Adults choose in Privacy settings: everyone (the default), followers, or only them.
    summary:
      "Private until you post. By default posted reels are public; you can limit them to followers.",
    detail:
      "Drafts are visible only to you. By default a posted reel appears on your profile and public Highlights. In Privacy settings you can limit your reels to your followers, or to only you.",
    options: [],
    guardianControlled: false,
  };
}
