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
 *   - locked, cancelled game: enforce_game_join_gate refuses a place in a cancelled game to every writer, and
 *     paypal_payment_precondition refuses every player (GAME_CANCELLED). Applies to every viewer; the status timeline
 *     stays, so an existing claim can still be withdrawn or disputed.
 *   - locked, completed game: the same rules (GAME_COMPLETED). A viewer who already holds a place keeps their page.
 *   - participation: enforce_child_game_participation refuses the roster place whoever writes it (consent, a
 *     guardian's "Can join games" switch). The claim itself is accepted, so a player could pay for a place that can
 *     never be given. A viewer who already holds a place keeps their page as it is.
 *   - guardian: a player with an active guardian link pays for a game only on a request their guardian approved
 *     (enforce_guardian_before_payment on the claim; game_payment_guardian_ready for PayPal, 20261111100000). A
 *     host-approved request can still be waiting on the guardian, and host approval alone makes the host's handles
 *     readable. Applies to every viewer, as the trigger does.
 *   - locked, in progress / closed by the host / past the signup cutoff: enforce_game_join_gate and the PayPal
 *     precondition let a player the host approved through, so (as on the game page, lockedForNewJoin) a viewer already
 *     in the flow (on the roster, a payment in, or approved by the host) keeps their way to pay.
 * A full roster is not decided here: the pay page keeps its "This game just filled up" warning (showFilledUpWarning).
 * The game's age range is not decided here either. It needs the viewer's exact age (their birthday, get_my_birthday),
 * which the pay page does not read, and the server lets a player the host approved, or one on the roster, through it.
 * Those, and players with an earlier claim, are the only viewers who can read the host's payment settings and so see
 * any handles (private_sec.can_read_game_payment_settings); PayPal checkout asks the age rule itself before any order.
 */
import type { FeatureDecision } from "@/lib/child-policy";
import type { JoinState } from "@/lib/live-status";
import {
  PAYMENTS_AGE_REQUIRED_MESSAGE,
  PAYMENTS_BLOCKED_MESSAGE,
  PAYMENTS_GUARDIAN_APPROVAL_MESSAGE,
} from "@/lib/payments-policy";

export type PayEntryBlockKind = "payments" | "participation" | "guardian" | "locked";

export type PayEntryBlock = {
  kind: PayEntryBlockKind;
  message: string;
  /** For kind 'locked': the gate's state, so the page can tell a lock the host's approval lifts from one it does not. */
  joinState?: JoinState;
};

export const PARTICIPATION_BLOCKED_FALLBACK =
  "A parent or guardian must approve this account first.";

/** Lock states in which the server still lets a player the host approved (or one already in the flow) through. */
const IN_FLOW_EXEMPT: ReadonlySet<JoinState> = new Set<JoinState>([
  "in_progress",
  "closed_by_host",
  "closed_cutoff",
]);

export type PayEntryInput = {
  /** The viewer is on the game's roster (their own game_participants row). */
  holdsPlace: boolean;
  /** A payment of theirs is in: pending, verified or disputed (hasPaymentIn). */
  paymentIn: boolean;
  /** The host approved their request to join. */
  approved: boolean;
  /** The game's join gate without the roster count (useJoinGate(game)). */
  gate: { locked: boolean; reason: string; joinState: JoinState };
  /** canChildFeature("game_participation"). */
  participation: Pick<FeatureDecision, "allowed" | "reason">;
  /** canChildFeature("game_payments"). */
  payments: Pick<FeatureDecision, "allowed" | "reason" | "level">;
  /** The viewer has no date of birth on file (age cohort 'unknown'). */
  ageUnknown?: boolean;
  /** public.game_payment_guardian_ready(game) for the viewer. */
  guardianReady: boolean;
};

function lockBlock(input: PayEntryInput): PayEntryBlock | null {
  const { gate } = input;
  if (!gate.locked) return null;
  const block: PayEntryBlock = { kind: "locked", message: gate.reason, joinState: gate.joinState };
  if (gate.joinState === "cancelled") return block;
  if (gate.joinState === "completed") return input.holdsPlace ? null : block;
  if (IN_FLOW_EXEMPT.has(gate.joinState)) {
    return input.holdsPlace || input.paymentIn || input.approved ? null : block;
  }
  // roster_full is never asked for here (no roster count), and 'open' is not locked. Anything else: no new payment.
  return input.holdsPlace ? null : block;
}

export function payEntryBlock(input: PayEntryInput): PayEntryBlock | null {
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
  // A game that can take no new player at all is said first: asking a parent would not help.
  if (input.gate.joinState === "cancelled" || input.gate.joinState === "completed") {
    const block = lockBlock(input);
    if (block) return block;
  }
  if (!input.participation.allowed && !input.holdsPlace) {
    return {
      kind: "participation",
      message: input.participation.reason || PARTICIPATION_BLOCKED_FALLBACK,
    };
  }
  if (!input.guardianReady) {
    return { kind: "guardian", message: PAYMENTS_GUARDIAN_APPROVAL_MESSAGE };
  }
  return lockBlock(input);
}

/**
 * A loaded check, still loading, or failed with nothing loaded. A check that loaded once and then failed to refresh
 * keeps its last answer (react-query keeps the data), so only a first load can be 'loading' or 'error'.
 */
export type CheckState<T> =
  { state: "loading" } | { state: "error" } | { state: "ready"; value: T };

/** Map a react-query result to a CheckState: data wins, then an error, else still loading. */
export function checkStateOf<T>(query: {
  data: T | undefined | null;
  isError: boolean;
}): CheckState<T> {
  if (query.data !== undefined && query.data !== null) return { state: "ready", value: query.data };
  if (query.isError) return { state: "error" };
  return { state: "loading" };
}

export type PayEntryView =
  /** A minor-safety check has not answered yet: show the loading card, never the handles. */
  | { kind: "checking" }
  /** A minor-safety check failed before answering: show a retry, never the handles. */
  | { kind: "check_failed" }
  /**
   * 'replace': the block card takes the place of every payment option.
   * 'warn': the viewer was already shown how to pay (they picked a method or opened the payment app), and the
   * database would still record their claim, so the block shows as a warning above the proof form: if they already
   * paid, the claim lets the host see it and refund them.
   */
  | {
      kind: "blocked";
      block: PayEntryBlock;
      mode: "replace" | "warn";
      /** The viewer was already shown how to pay; the card says what to do if money already moved. */
      paymentStarted: boolean;
    }
  | { kind: "clear" };

/**
 * Block kinds the database still records a manual claim for (nothing on payment_submissions checks the join gate or
 * child_game_participation_allowed), so a player who already paid can at least tell the host. 'payments' and
 * 'guardian' claims are refused by enforce_game_payment_cohort and enforce_guardian_before_payment, so a proof form
 * would only fail for them.
 */
const CLAIM_STILL_RECORDED: ReadonlySet<PayEntryBlockKind> = new Set<PayEntryBlockKind>([
  "locked",
  "participation",
]);

/**
 * What the pay page shows in place of (or above) its payment options. Fails closed: while the child-status policy or
 * the guardian check has not answered, nothing that lets money move is shown.
 */
export function payEntryView(input: {
  holdsPlace: boolean;
  paymentIn: boolean;
  approved: boolean;
  gate: PayEntryInput["gate"];
  /** useMyChildStatus(): the two policy decisions and whether the age is unknown, once the status has loaded. */
  child: CheckState<{
    participation: PayEntryInput["participation"];
    payments: PayEntryInput["payments"];
    ageUnknown: boolean;
  }>;
  /** game_payment_guardian_ready(game) for the viewer. */
  guardian: CheckState<boolean>;
  /**
   * The viewer was already shown how to pay: a method was picked while nothing blocked, or the pay-opened marker
   * (markExternalPaymentOpened) exists for this game.
   */
  paymentStarted: boolean;
  /** The proof step (a picked method) is what the page would show next. */
  onProofStep: boolean;
}): PayEntryView {
  const { child, guardian } = input;
  if (child.state === "error" || guardian.state === "error") return { kind: "check_failed" };
  if (child.state === "loading" || guardian.state === "loading") return { kind: "checking" };
  const block = payEntryBlock({
    holdsPlace: input.holdsPlace,
    paymentIn: input.paymentIn,
    approved: input.approved,
    gate: input.gate,
    participation: child.value.participation,
    payments: child.value.payments,
    ageUnknown: child.value.ageUnknown,
    guardianReady: guardian.value,
  });
  if (!block) return { kind: "clear" };
  const warn = input.paymentStarted && input.onProofStep && CLAIM_STILL_RECORDED.has(block.kind);
  return {
    kind: "blocked",
    block,
    mode: warn ? "warn" : "replace",
    paymentStarted: input.paymentStarted,
  };
}

/**
 * Whether the block card comes before the "Waiting on host approval" card. It does, except for a lock the host's
 * approval lifts (in progress, closed by the host, past the cutoff) while the viewer's request is still pending: there
 * "Payment unlocks after the host approves you" is true. A 13-15 or consent-locked account, a cancelled or ended game,
 * a guardian's switch or a missing guardian approval is never lifted by the host, so it is said first.
 */
export function blockOutranksApproval(block: PayEntryBlock, requestPending: boolean): boolean {
  if (block.kind !== "locked") return true;
  if (!requestPending) return true;
  return !(block.joinState && IN_FLOW_EXEMPT.has(block.joinState));
}

/**
 * The game page's paid CTA: a link to /games/<id>/pay. It is a link only for a viewer the button path would also let
 * through. A locked game or a consent-blocked account falls through to the disabled button ("Signup closed", "In
 * progress", "Game ended", "Parent approval needed"); lockedForNewJoin already exempts a viewer on the roster, with a
 * request or payment pending, confirmed or approved, so they keep their link.
 */
export function payHostLinkShown(input: {
  isPaid: boolean;
  paymentCleared: boolean;
  approvalCleared: boolean;
  canEnterPaymentFlow: boolean;
  parentAsk: boolean;
  lockedForNewJoin: boolean;
  consentBlocksNewJoin: boolean;
}): boolean {
  return (
    input.isPaid &&
    !input.paymentCleared &&
    input.approvalCleared &&
    input.canEnterPaymentFlow &&
    !input.parentAsk &&
    !input.lockedForNewJoin &&
    !input.consentBlocksNewJoin
  );
}
