/**
 * Age gate for game payment coordination.
 *
 * Single source of truth stays `PERMISSION_MATRIX.game_payments` in
 * child-policy.ts — this module only adapts it for the two enforcement
 * points (UI and server function), the same way messaging/hosting are
 * enforced in both layers. The database trigger
 * `public.enforce_game_payment_cohort` is the final backstop.
 *
 * LEGAL REVIEW REQUIRED: which cohorts may coordinate real money is a
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

export const PAYMENTS_BLOCKED_MESSAGE =
  "Payment coordination isn't available for this account yet.";

/** Can this member see and use payment coordination at all? */
export function paymentsFeatureDecision(
  subject: (PolicySubject & { controls?: ChildControls | null }) | null,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): FeatureDecision {
  if (!subject) return { allowed: true, level: "allowed", reason: null };
  return can("game_payments", subject, config);
}

export type PaymentPartyGate = { ok: boolean; reason: string | null };

/**
 * Server-side re-check: both sides of a payment must be allowed to
 * coordinate payments before anything is written. Client-side gating is
 * never sufficient on its own.
 */
export function paymentParticipantsGate(
  parties: {
    submitter: (PolicySubject & { controls?: ChildControls | null }) | null;
    recipient: (PolicySubject & { controls?: ChildControls | null }) | null;
  },
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): PaymentPartyGate {
  const submitter = paymentsFeatureDecision(parties.submitter, config);
  if (!submitter.allowed) {
    return { ok: false, reason: PAYMENTS_BLOCKED_MESSAGE };
  }
  const recipient = paymentsFeatureDecision(parties.recipient, config);
  if (!recipient.allowed) {
    return {
      ok: false,
      reason: "Payment coordination isn't available for this host account yet.",
    };
  }
  return { ok: true, reason: null };
}

/** Cohort-only convenience for callers that only know the cohort. */
export function paymentsAllowedForCohort(
  cohort: AgeCohort,
  config: AgePolicyConfig = DEFAULT_AGE_POLICY,
): boolean {
  return paymentsFeatureDecision({ cohort }, config).allowed;
}
