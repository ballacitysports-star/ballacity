/**
 * Age gate for game hosting.
 *
 * Single source of truth stays `PERMISSION_MATRIX.game_hosting` in
 * child-policy.ts — this module only adapts it for the client-side UX check,
 * exactly like payments-policy.ts does for `game_payments`. The database
 * trigger `public.block_child_hosting` is the real backstop.
 *
 * LEGAL REVIEW REQUIRED: which cohorts may host in-person games is a
 * product/legal threshold, not a statement of what any law mandates.
 */
import {
  DEFAULT_AGE_POLICY,
  can,
  type AgeCohort,
  type AgePolicyConfig,
  type ChildControls,
  type FeatureDecision,
  type PolicySubject,
} from "@/lib/child-policy";

export const HOSTING_BLOCKED_MESSAGE = "Hosting isn't available for this account yet.";

/** Can this member set up and host a game at all? */
export function hostingFeatureDecision(
  subject: (PolicySubject & { controls?: ChildControls | null }) | null,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): FeatureDecision {
  if (!subject) return { allowed: true, level: "allowed", reason: null };
  return can("game_hosting", subject, config);
}

/** Cohort-only helper for callers that only know the cohort. */
export function hostingAllowedForCohort(
  cohort: AgeCohort,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): boolean {
  return hostingFeatureDecision({ cohort }, config).allowed;
}
