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
  /**
   * A minor-safety check, or the viewer's own flow state a block hangs on, has not answered yet: show the loading
   * card, never the handles (and never a block the answer could lift).
   */
  | { kind: "checking" }
  /** One of those failed before answering: show a retry, never the handles. */
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
/**
 * Whether a block was decided by the viewer's own flow state (their place, a payment in, the host's approval): a lock
 * other than a cancelled game, which every viewer gets, or the participation block, which a place lifts. Those inputs
 * only ever lift a block, so a block that is none of these stands whatever they turn out to be.
 */
function dependsOnFlow(block: PayEntryBlock): boolean {
  if (block.kind === "participation") return true;
  return block.kind === "locked" && block.joinState !== "cancelled";
}

export function payEntryView(input: {
  holdsPlace: boolean;
  paymentIn: boolean;
  approved: boolean;
  /**
   * Whether holdsPlace, paymentIn and approved are known: the viewer's request and payments for this game have been
   * read, and the roster store has loaded their places. 'loading' while any is still out, 'error' when a read failed
   * with nothing loaded. Until 'ready' the three count as false, and a block they could lift shows as 'checking' (or
   * 'check_failed'), never as "You can't pay for this game" to a player who may well be approved or on the roster.
   */
  flow: "loading" | "error" | "ready";
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
  // Until the flow state is known it counts as nothing (fail closed): those inputs only lift blocks, so a viewer with
  // no block now has none whatever they turn out to be, and an account-level block shows at once.
  const flowKnown = input.flow === "ready";
  const block = payEntryBlock({
    holdsPlace: flowKnown && input.holdsPlace,
    paymentIn: flowKnown && input.paymentIn,
    approved: flowKnown && input.approved,
    gate: input.gate,
    participation: child.value.participation,
    payments: child.value.payments,
    ageUnknown: child.value.ageUnknown,
    guardianReady: guardian.value,
  });
  if (!block) return { kind: "clear" };
  if (!flowKnown && dependsOnFlow(block)) {
    return input.flow === "error" ? { kind: "check_failed" } : { kind: "checking" };
  }
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
 * A game no new payment can be for, whoever the viewer is: a cancelled game, or an ended one for anyone without a
 * place (enforce_game_join_gate, paypal_payment_precondition's GAME_CANCELLED / GAME_COMPLETED). payEntryBlock blocks
 * these whatever the viewer's request or payments say; the game page uses it so its Pay Host link agrees.
 */
export function gameTakesNoPayment(joinState: JoinState, holdsPlace: boolean): boolean {
  return joinState === "cancelled" || (joinState === "completed" && !holdsPlace);
}

/**
 * Whether the pay page offers PayPal checkout. paypal_payment_precondition refuses an ended game to every player,
 * rostered or not (GAME_COMPLETED), and a cancelled one (GAME_CANCELLED), so a PayPal button there could only fail at
 * order creation. A rostered player who still owes for an ended game keeps the host's manual methods.
 */
export function payPalOffered(joinState: JoinState): boolean {
  return joinState !== "completed" && joinState !== "cancelled";
}

/**
 * The game page's paid CTA: a link to /games/<id>/pay. It is a link only for a viewer the button path would also let
 * through. A locked game or a consent-blocked account falls through to the disabled button ("Signup closed", "In
 * progress", "Game ended", "Parent approval needed"); lockedForNewJoin already exempts a viewer on the roster, with a
 * request or payment pending, confirmed or approved, so they keep their link, except on a game that takes no payment
 * at all (gameTakesNoPayment), where the pay page would only show its block card. A pending payment's "View status"
 * link stays there: the pay page shows that payment's timeline, and the button would open the same page anyway.
 */
export function payHostLinkShown(input: {
  /** The game's join state (useJoinGate(game).joinState). */
  joinState: JoinState;
  /** The viewer is on the roster. */
  holdsPlace: boolean;
  /**
   * A payment of theirs waits on the host: the link reads "Payment pending · View status" and opens the status
   * timeline (withdraw, dispute), not a way to pay, so it stays even on a game that takes no payment.
   */
  paymentPending: boolean;
  isPaid: boolean;
  paymentCleared: boolean;
  approvalCleared: boolean;
  canEnterPaymentFlow: boolean;
  parentAsk: boolean;
  lockedForNewJoin: boolean;
  consentBlocksNewJoin: boolean;
}): boolean {
  return (
    (input.paymentPending || !gameTakesNoPayment(input.joinState, input.holdsPlace)) &&
    input.isPaid &&
    !input.paymentCleared &&
    input.approvalCleared &&
    input.canEnterPaymentFlow &&
    !input.parentAsk &&
    !input.lockedForNewJoin &&
    !input.consentBlocksNewJoin
  );
}
