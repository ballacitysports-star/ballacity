/**
 * Whether the pay page may offer a NEW payment (the host's handles, the "Pay $X in Venmo" links, PayPal checkout and
 * the proof form) to this viewer.
 *
 * The game page sends a player on a paid game that needs no host approval straight to the pay page with a link, and
 * the pay page can also be opened from an invite or a bookmark, so the game page's own checks (lockedForNewJoin,
 * consentBlocksNewJoin) never ran for them. On a manual payment the money leaves the app (Venmo, Cash App...) before
 * any claim reaches the database, so the database refusing afterwards is too late for the player:
 *   - payments: enforce_game_payment_cohort refuses any new claim by an account whose age group may not coordinate
 *     payments, whose parental consent is not approved, or whose age is unknown (20261111120000). PayPal checkout asks
 *     the same before an order exists (paypal_payment_precondition). Applies to every viewer: the database refuses
 *     every new claim from such an account.
 *   - participation: enforce_child_game_participation refuses the roster place whoever writes it (consent, a
 *     guardian's "Can join games" switch). The claim itself is accepted, so a player could pay for a place that can
 *     never be given. A viewer who already holds a place keeps their page as it is.
 *   - locked: enforce_game_join_gate refuses a place in a cancelled or ended game, and while joining is closed or past
 *     the signup cutoff for a player the host has not approved. The claim itself is accepted. As on the game page
 *     (lockedForNewJoin), a viewer already in the flow (on the roster, a payment in, or approved by the host) keeps
 *     their way to pay.
 * A full roster is not decided here: the pay page keeps its "This game just filled up" warning (showFilledUpWarning).
 */
import type { FeatureDecision } from "@/lib/child-policy";
import { PAYMENTS_AGE_REQUIRED_MESSAGE, PAYMENTS_BLOCKED_MESSAGE } from "@/lib/payments-policy";

export type PayEntryBlock = {
  kind: "payments" | "participation" | "locked";
  message: string;
};

export const PARTICIPATION_BLOCKED_FALLBACK =
  "A parent or guardian must approve this account first.";

export function payEntryBlock(input: {
  /** The viewer is on the game's roster (their own game_participants row). */
  holdsPlace: boolean;
  /** A payment of theirs is in: pending, verified or disputed (hasPaymentIn). */
  paymentIn: boolean;
  /** The host approved their request to join. */
  approved: boolean;
  /** The game's join gate without the roster count (useJoinGate(game)). */
  gate: { locked: boolean; reason: string };
  /** canChildFeature("game_participation"). */
  participation: Pick<FeatureDecision, "allowed" | "reason">;
  /** canChildFeature("game_payments"). */
  payments: Pick<FeatureDecision, "allowed" | "reason" | "level">;
  /** The viewer has no date of birth on file (age cohort 'unknown'). */
  ageUnknown?: boolean;
}): PayEntryBlock | null {
  if (!input.payments.allowed) {
    const ageGroupRule = input.payments.level === "blocked" || input.payments.level === "never";
    return {
      kind: "payments",
      message: input.ageUnknown
        ? PAYMENTS_AGE_REQUIRED_MESSAGE
        : !ageGroupRule && input.payments.reason
          ? input.payments.reason
          : PAYMENTS_BLOCKED_MESSAGE,
    };
  }
  if (!input.participation.allowed && !input.holdsPlace) {
    return {
      kind: "participation",
      message: input.participation.reason || PARTICIPATION_BLOCKED_FALLBACK,
    };
  }
  if (input.gate.locked && !input.holdsPlace && !input.paymentIn && !input.approved) {
    return { kind: "locked", message: input.gate.reason };
  }
  return null;
}
