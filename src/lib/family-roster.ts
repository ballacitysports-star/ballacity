import { useMemo } from "react";
import { useMyChildren } from "@/lib/child-safety";
import type { AgeCohort } from "@/lib/child-policy";
import type { GuardianChild } from "@/lib/child-safety.functions";

/**
 * The guardian's roster: who is waiting on them, who is active, and what they
 * are allowed to see of each child.
 *
 * The Parent Center could previously only show one child at a time, behind a
 * switcher that appeared at two or more children. A guardian had no single
 * view answering "who needs me, and who is set up" — they had to click each
 * child in turn to find out. This builds that view.
 *
 * Kept free of React (like buildFamilyApprovals) so the grouping and the
 * visibility rule can be tested without rendering anything.
 */

export type RosterStatus = "awaiting_approval" | "consent_withdrawn" | "no_consent" | "approved";

export type RosterEntry = {
  child: GuardianChild;
  status: RosterStatus;
  /** Short label for the status chip. */
  statusLabel: string;
  /** True when the child's account is limited until the guardian acts. */
  needsGuardian: boolean;
  /** Age is disputed/unverified — shown alongside the status, not instead of it. */
  ageReviewRequired: boolean;
  /** Whether /players/$userId will actually render for this guardian. */
  publicProfileReachable: boolean;
};

export type FamilyRoster = {
  /** Children whose account is limited until the guardian does something. */
  needsAction: RosterEntry[];
  /** Children who are approved and playing. */
  approved: RosterEntry[];
  all: RosterEntry[];
};

const STATUS_LABEL: Record<RosterStatus, string> = {
  awaiting_approval: "Waiting on your approval",
  consent_withdrawn: "Consent withdrawn",
  no_consent: "No consent on file",
  approved: "Approved",
};

/**
 * What public.default_profile_visibility_for() returns for a cohort.
 *
 * Mirrored here so the UI can tell, before rendering a link, whether the
 * public profile page will be readable. Under-13 and unknown-age accounts are
 * `private`, which the profiles SELECT policy enforces against *everyone*
 * except the account itself — a guardian included. Linking a guardian to a
 * page that will not load for them is the dead end this avoids.
 */
export function defaultProfileVisibilityForCohort(
  cohort: AgeCohort,
): "public" | "members" | "private" {
  if (cohort === "adult") return "public";
  if (cohort === "teen_16_17" || cohort === "teen_13_15") return "members";
  return "private"; // child_under_13 and unknown
}

/**
 * True when a signed-in guardian can open this child's public profile page.
 *
 * Conservative on purpose: this reads the cohort default, and a child who has
 * tightened their own visibility further is not represented here. The link is
 * therefore never shown where it is certain to fail, and the inline summary
 * on the roster is what a guardian relies on either way.
 */
export function canGuardianOpenPublicProfile(child: GuardianChild): boolean {
  return defaultProfileVisibilityForCohort(child.cohort) !== "private";
}

function statusOf(child: GuardianChild): RosterStatus {
  const status = child.consent?.status ?? null;
  if (status === "approved") return "approved";
  if (status === "revoked") return "consent_withdrawn";
  if (status === "pending" || status === "required") return "awaiting_approval";
  return "no_consent";
}

export function buildFamilyRoster(children: GuardianChild[]): FamilyRoster {
  const all = children.map((child): RosterEntry => {
    const status = statusOf(child);
    return {
      child,
      status,
      statusLabel: STATUS_LABEL[status],
      needsGuardian: status !== "approved",
      ageReviewRequired: child.ageReviewRequired === true,
      publicProfileReachable: canGuardianOpenPublicProfile(child),
    };
  });

  // Whoever is blocked comes first, then alphabetically so the order is stable
  // between renders rather than following whatever order the query returned.
  const byName = (a: RosterEntry, b: RosterEntry) =>
    a.child.displayName.localeCompare(b.child.displayName);

  return {
    needsAction: all.filter((e) => e.needsGuardian).sort(byName),
    approved: all.filter((e) => !e.needsGuardian).sort(byName),
    all,
  };
}

/** Live roster for the signed-in guardian. */
export function useFamilyRoster() {
  const { children, isLoading } = useMyChildren();
  const roster = useMemo(() => buildFamilyRoster(children), [children]);
  return { ...roster, isLoading };
}
