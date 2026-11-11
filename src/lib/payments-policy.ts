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

/**
 * A 16-17-year-old with a guardian pays for a game only once a guardian has
 * approved their request for it (enforce_guardian_before_payment). PayPal
 * checkout asks before any money moves, so this also tells them nothing was
 * charged.
 */
export const GUARDIAN_PAYMENT_MESSAGE =
  "A parent or guardian has to approve this game before you can pay. You weren't charged.";

/**
 * What the player reads for each code public.paypal_payment_precondition returns (supabase/migrations/
 * 20261111140000_paypal_payment_preconditions.sql). PayPal checkout asks before an order exists and again right before
 * the capture, so nothing has been charged when one of these is shown.
 */
export const PAYMENT_PRECONDITION_MESSAGES: Readonly<Record<string, string>> = {
  SIGN_IN_REQUIRED: "Sign in to pay for this game. You weren't charged.",
  GAME_NOT_FOUND: "This game isn't available. You weren't charged.",
  GAME_CANCELLED: "This game was cancelled. You weren't charged.",
  GAME_COMPLETED: "This game has already ended. You weren't charged.",
  OWN_GAME: "You host this game, so there's nothing to pay. You weren't charged.",
  PAYMENT_DESTINATION_INVALID: "This game can't take payments right now. You weren't charged.",
  PAYMENTS_NOT_AVAILABLE:
    "Payment coordination isn't available for this account yet. You weren't charged.",
  AGE_VERIFICATION_REQUIRED:
    "Add your date of birth to your profile before joining games. You weren't charged.",
  GAME_PARTICIPATION_BLOCKED:
    "A parent or guardian has to allow game participation before you can pay. You weren't charged.",
  BLOCKED_BY_HOST: "You can't join this host's games. You weren't charged.",
  ALREADY_PAID: "You've already paid for this game. You weren't charged.",
  PAYMENT_IN_PROGRESS:
    "Your earlier PayPal payment for this game is still being confirmed, so you can't pay again yet. Refresh this page in a few minutes, and contact support if it hasn't updated. You weren't charged.",
  HOST_APPROVAL_REQUIRED:
    "The host has to approve your request to join before you can pay. You weren't charged.",
  GUARDIAN_APPROVAL_REQUIRED: GUARDIAN_PAYMENT_MESSAGE,
  AGE_REQUIREMENT_NOT_MET:
    "This game has an age requirement, so the host has to approve your request to join first. You weren't charged.",
  GAME_JOINS_CLOSED: "Joining is closed for this game. You weren't charged.",
  GAME_FULL: "This game is full. You weren't charged.",
};

/** The payment check itself failed (or gave an answer the server does not know): checkout refuses. */
export const PAYMENT_CHECK_FAILED_MESSAGE =
  "We couldn't check this payment right now. Please try again in a moment. You weren't charged.";
export const PAYMENT_REFUSED_MESSAGE =
  "You can't pay for this game right now. You weren't charged.";
/** PayPal would not start the checkout (its own error stays in the server log). */
export const PAYPAL_UNAVAILABLE_MESSAGE =
  "PayPal checkout isn't available right now. Please try again in a moment. You weren't charged.";
/** paypal_orders.amount_cents above what payment_submissions.paid_amount accepts ($100,000). */
export const PAYMENT_TOO_LARGE_MESSAGE =
  "This game's fee is more than checkout can take. You weren't charged.";

/** The message for a precondition code; an unknown code still refuses. */
export function paymentPreconditionMessage(code: string | null | undefined): string {
  return (code && PAYMENT_PRECONDITION_MESSAGES[code]) || PAYMENT_REFUSED_MESSAGE;
}

// ---- capturing an approved PayPal order ---------------------------------------------------------------------------
/** The order is not one that can be captured (failed, cancelled, or not this player's). */
export const ORDER_NOT_CAPTURABLE_MESSAGE =
  "This PayPal checkout can't be completed. Please start again. You weren't charged.";
/** PayPal's order no longer matches the game's price or payee. */
export const PAYPAL_MISMATCH_MESSAGE =
  "This PayPal payment doesn't match the host's current checkout. Please start again. You weren't charged.";
/** PayPal declined the capture and the order is still uncaptured. */
export const CAPTURE_DECLINED_MESSAGE =
  "PayPal couldn't complete the payment. Please try again or use another method. You weren't charged.";
/** Another request is capturing this order right now. */
export const CAPTURE_IN_PROGRESS_MESSAGE =
  "This payment is already being confirmed. Don't pay again: refresh this page in a minute to see it.";
/** The capture failed and PayPal could not say whether money moved. The order stays flagged for support. */
export const CAPTURE_UNCONFIRMED_MESSAGE =
  "We couldn't confirm with PayPal whether this payment went through. Don't pay again: refresh this page in a few minutes, and contact support if it hasn't updated.";
/** PayPal accepted the payment but has not completed it (a PENDING capture). The order is held for support. */
export const CAPTURE_PENDING_MESSAGE =
  "PayPal is still processing this payment, so it isn't confirmed yet and you're not on the roster. Don't pay again: we've flagged it, and support will record or refund it.";
/** PayPal took the money, it could not be recorded, and it was refunded in full. */
export const PAYMENT_REFUNDED_MESSAGE =
  "PayPal took your payment but we couldn't record it, so we refunded it in full. You're not on the roster for this payment. Please try again later or use another method.";
/** PayPal took the money, it could not be recorded, and the refund failed too. The order is flagged for support. */
export const PAYMENT_UNRECORDED_MESSAGE =
  "PayPal took your payment but we couldn't record it, and the automatic refund didn't go through. Don't pay again: we've flagged it, and support will refund or record it.";
/** An order already captured whose payment record could not be checked just now. */
export const PAYMENT_RECORD_UNCONFIRMED_MESSAGE =
  "Your PayPal payment went through, but we couldn't confirm it's recorded yet. Don't pay again: refresh this page in a minute.";
/**
 * PayPal took the money and the app could not finish with it: the payment record's write got no clear answer, or a
 * capture that completed after an earlier attempt could not be checked or held. Nothing settles it by itself; it is
 * reported, and a superadmin records or refunds it.
 */
export const PAYMENT_HELD_FOR_SUPPORT_MESSAGE =
  "Your PayPal payment went through, but we couldn't finish recording it, so your place isn't confirmed yet. Don't pay again: we've flagged it, and support will record or refund it.";
/**
 * An order PayPal captured whose payment record is gone (for example withdrawn after the host rejected it). The server
 * does not write it again on its own, since that would skip the payment rules; it is flagged for support.
 */
export const PAYMENT_RECORD_MISSING_MESSAGE =
  "Your PayPal payment for this order went through, but its payment record is missing. Don't pay again: we've flagged it, and support will settle it.";
/** The button's fallback for any other failure: the server may or may not have finished. */
export const CHECKOUT_UNCONFIRMED_MESSAGE =
  "We couldn't confirm the PayPal payment. Check this page before paying again.";

/** Messages a payment server function raises for the player to read as they are. */
export const PAYMENT_POLICY_MESSAGES: readonly string[] = [
  PAYMENTS_BLOCKED_MESSAGE,
  GUARDIAN_PAYMENT_MESSAGE,
  ...Object.values(PAYMENT_PRECONDITION_MESSAGES),
  PAYMENT_CHECK_FAILED_MESSAGE,
  PAYMENT_REFUSED_MESSAGE,
  PAYMENT_TOO_LARGE_MESSAGE,
  PAYPAL_UNAVAILABLE_MESSAGE,
  ORDER_NOT_CAPTURABLE_MESSAGE,
  PAYPAL_MISMATCH_MESSAGE,
  CAPTURE_DECLINED_MESSAGE,
  CAPTURE_IN_PROGRESS_MESSAGE,
  CAPTURE_UNCONFIRMED_MESSAGE,
  CAPTURE_PENDING_MESSAGE,
  PAYMENT_REFUNDED_MESSAGE,
  PAYMENT_UNRECORDED_MESSAGE,
  PAYMENT_RECORD_UNCONFIRMED_MESSAGE,
  PAYMENT_HELD_FOR_SUPPORT_MESSAGE,
  PAYMENT_RECORD_MISSING_MESSAGE,
];

/** The error's message when it is one of PAYMENT_POLICY_MESSAGES, else null. */
export function paymentPolicyMessageOf(e: unknown): string | null {
  const message = e instanceof Error ? e.message : null;
  return message && PAYMENT_POLICY_MESSAGES.includes(message) ? message : null;
}

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
