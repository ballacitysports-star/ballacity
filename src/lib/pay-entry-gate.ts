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
 *   - age: the game's age range (min_age / max_age). The game page sends a viewer outside it, or one with no birthday
 *     on file, to request the host's approval (ageGateState in src/lib/game-age.ts, from useMyAge); the server's age
 *     rule (enforce_game_age_requirement; AGE_REQUIREMENT_NOT_MET in payment_claim_block, which both PayPal checkout
 *     and a manual claim ask) lets a player the host approved, or one on the roster, through. Owner decision
 *     2026-11-18 (#430 question 4): the pay page applies it, with the game page's source and rule. A viewer already in
 *     the flow (on the roster, a payment in, or approved) and the host are exempt.
 * A full roster is not decided here: the pay page keeps its "This game just filled up" warning (showFilledUpWarning),
 * and the database refuses the claim itself (GAME_FULL) for a player not on the roster.
 *
 * payRiskAckView (below) decides "Before you join" on the pay page (docs/paid-path-gates.md section 7, Option B).
 */
import type { FeatureDecision } from "@/lib/child-policy";
import type { JoinState } from "@/lib/live-status";
import {
  ageGateMessage,
  ageGateState,
  hasAgeRequirement,
  type AgeGateState,
  type AgeRequirement,
} from "@/lib/game-age";
import { planRiskAckTap, type RiskAckRead } from "@/lib/risk-ack-tap";
import { needsRiskAcknowledgment } from "@/lib/safety";
import {
  PAYMENTS_AGE_REQUIRED_MESSAGE,
  PAYMENTS_BLOCKED_MESSAGE,
  PAYMENTS_GUARDIAN_APPROVAL_MESSAGE,
} from "@/lib/payments-policy";

export type PayEntryBlockKind = "payments" | "participation" | "guardian" | "locked" | "age";

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
  /** The viewer hosts this game (the game page never applies the age range to the host). */
  isHost?: boolean;
  /**
   * The game's age range and where the viewer stands against it (ageGateState from the viewer's age, useMyAge, as the
   * game page decides it). Omitted, or state 'none', when the game has no range.
   */
  age?: { state: AgeGateState; req: AgeRequirement };
};

export const AGE_BLOCKED_FALLBACK =
  "This game has an age requirement. Ask the host to approve your request first.";

/**
 * The game's age range, for a viewer not yet in the flow. The game page turns an age outside the range, or no birthday
 * on file, into a request the host decides (requiresApproval); the server lets an approved or rostered player through.
 */
function ageBlock(input: PayEntryInput): PayEntryBlock | null {
  const age = input.age;
  if (!age || input.isHost) return null;
  if (age.state !== "needs_approval" && age.state !== "unknown_age") return null;
  if (input.holdsPlace || input.paymentIn || input.approved) return null;
  return { kind: "age", message: ageGateMessage(age.state, age.req) ?? AGE_BLOCKED_FALLBACK };
}

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
  return lockBlock(input) ?? ageBlock(input);
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
   * The block card takes the place of every payment option, the proof form included, even for a viewer who was
   * already shown how to pay: the database refuses their manual claim for every block this decides (see
   * payEntryView), so a proof form could only fail.
   */
  | {
      kind: "blocked";
      block: PayEntryBlock;
      /** The viewer was already shown how to pay; the card tells them to ask the host for a refund. */
      paymentStarted: boolean;
    }
  | { kind: "clear" };

/**
 * Whether a block was decided by the viewer's own flow state (their place, a payment in, the host's approval): a lock
 * other than a cancelled game, which every viewer gets, the participation block, which a place lifts, or the age range,
 * which any of the three lifts. Those inputs
 * only ever lift a block, so a block that is none of these stands whatever they turn out to be.
 */
function dependsOnFlow(block: PayEntryBlock): boolean {
  if (block.kind === "participation" || block.kind === "age") return true;
  return block.kind === "locked" && block.joinState !== "cancelled";
}

/**
 * What the pay page shows in place of its payment options. Fails closed: while the child-status policy or the guardian
 * check has not answered, nothing that lets money move is shown.
 *
 * A block never shows a proof form, not even to a viewer who already picked a method or opened the payment app: the
 * database refuses their own manual claim for each kind. 'payments' by enforce_game_payment_cohort, 'guardian' by
 * enforce_guardian_before_payment, and (20261119200000, zz_payment_claim_preconditions) 'participation' as
 * GAME_PARTICIPATION_BLOCKED and a 'locked' game as GAME_CANCELLED, GAME_COMPLETED (ended, or over by the clock) or
 * GAME_JOINS_CLOSED (closed by the host or past the cutoff, for a player the host has not approved). A game in
 * progress with no cutoff and joining left open is the one lock the trigger lets a claim through for; it is blocked
 * here as on the game page, and the card's advice (ask the host for a refund) holds there too. The card tells a
 * viewer who was already shown how to pay to ask the host for a refund, rather than promising a proof the host would
 * never see.
 */
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
  /** The viewer hosts this game. */
  isHost?: boolean;
  /** The game's age range (game.minAge / game.maxAge); null or empty for none. */
  ageReq?: AgeRequirement | null;
  /**
   * The viewer's age (useMyAge, the game page's source): null when no birthday is on file. Only asked when the game
   * has an age range; until it answers the range counts as not met (fail closed), so a viewer it could block sees
   * 'checking' (or 'check_failed'), never the handles.
   */
  viewerAge?: CheckState<number | null>;
}): PayEntryView {
  const { child, guardian } = input;
  if (child.state === "error" || guardian.state === "error") return { kind: "check_failed" };
  if (child.state === "loading" || guardian.state === "loading") return { kind: "checking" };
  const ageReq = input.ageReq ?? null;
  const ageApplies = !input.isHost && hasAgeRequirement(ageReq);
  const viewerAge: CheckState<number | null> = input.viewerAge ?? { state: "loading" };
  // An age not known yet counts as outside the range: the block that answer gives is the worst the real age can give.
  const ageKnown = !ageApplies || viewerAge.state === "ready";
  const age = ageApplies
    ? {
        state:
          viewerAge.state === "ready"
            ? ageGateState({ req: ageReq, viewerAge: viewerAge.value })
            : ("unknown_age" as const),
        req: ageReq!,
      }
    : undefined;
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
    isHost: input.isHost,
    age,
  });
  if (!block) return { kind: "clear" };
  if (block.kind === "age" && !ageKnown) {
    return viewerAge.state === "error" || input.flow === "error"
      ? { kind: "check_failed" }
      : { kind: "checking" };
  }
  if (!flowKnown && dependsOnFlow(block)) {
    return input.flow === "error" ? { kind: "check_failed" } : { kind: "checking" };
  }
  return { kind: "blocked", block, paymentStarted: input.paymentStarted };
}

/**
 * Whether the block card comes before the "Waiting on host approval" card. It does, except for a lock the host's
 * approval lifts (in progress, closed by the host, past the cutoff), or the game's age range, while the viewer's
 * request is still pending: there
 * "Payment unlocks after the host approves you" is true. A 13-15 or consent-locked account, a cancelled or ended game,
 * a guardian's switch or a missing guardian approval is never lifted by the host, so it is said first.
 */
export function blockOutranksApproval(block: PayEntryBlock, requestPending: boolean): boolean {
  if (!requestPending) return true;
  if (block.kind === "age") return false;
  if (block.kind !== "locked") return true;
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

/**
 * The game page's join button for a viewer who still owes the fee on a game that takes no payment (a cancelled game,
 * or an ended one without a place, gameTakesNoPayment). lockedForNewJoin exempts a viewer on the roster, so a player
 * the host added to a cancelled paid game without a verified payment fell through to "Pay Host · $X", whose tap opens
 * a pay page that only says they cannot pay. With this the button is the disabled "Cancelled" / "Game ended" one. A
 * pending request or payment keeps its own button (cancel, withdraw), and a confirmed player keeps "Tap to leave".
 */
export function unpaidOnGameTakingNoPayment(input: {
  joinState: JoinState;
  holdsPlace: boolean;
  isPaid: boolean;
  /** The fee is settled (a verified payment), or the game is free. */
  paymentCleared: boolean;
  /** A request or payment of theirs waits on the host. */
  pending: boolean;
}): boolean {
  return (
    input.isPaid &&
    !input.paymentCleared &&
    !input.pending &&
    gameTakesNoPayment(input.joinState, input.holdsPlace)
  );
}

/**
 * "Before you join" on the pay page (docs/paid-path-gates.md section 7, Option B, owner decision 2026-11-18). The
 * game page asks it in handleJoin, which a paid game's "Pay Host" link and a direct visit to /pay never run, so the pay
 * page asks it before any payment option is drawn:
 *   - 'none': the host, a viewer already in the flow (on the roster, a payment in, or approved: the in-flow notion of
 *     payEntryBlock), or one whose acknowledgment of the current version is on file. The payment options show.
 *   - 'checking': the acknowledgment read has not answered yet, or the viewer's flow state (which could exempt them)
 *     is still loading. The loading card shows, never the payment options (fail closed).
 *   - 'ask': the dialog. Also when the read failed with no answer (fail closed, as src/lib/risk-ack-tap.ts does: the
 *     write is idempotent), and when the flow state failed to load (the viewer then counts as not in the flow).
 * The rule is needsRiskAcknowledgment's (src/lib/safety.ts), the same the join tap uses.
 */
export type PayRiskAckView = "none" | "checking" | "ask";

export function payRiskAckView(input: {
  isHost: boolean;
  holdsPlace: boolean;
  paymentIn: boolean;
  approved: boolean;
  /** As payEntryView's flow: whether holdsPlace, paymentIn and approved are known. */
  flow: "loading" | "error" | "ready";
  /** The participant_risk acknowledgment read (riskAckReadFrom(useSafetyAck(...))). */
  read: RiskAckRead;
}): PayRiskAckView {
  const inFlow = input.flow === "ready" && (input.holdsPlace || input.paymentIn || input.approved);
  const plan = planRiskAckTap(input.read, (acknowledgedVersion) =>
    needsRiskAcknowledgment({
      signedIn: true,
      isHost: input.isHost,
      alreadyJoined: inFlow,
      acknowledgedVersion,
    }),
  );
  if (plan.kind === "wait") return "checking";
  if (!plan.needsRiskAck) return "none";
  // Not on file: a viewer whose place, payment or approval has not been read yet may be exempt.
  return input.flow === "loading" ? "checking" : "ask";
}

/**
 * What the pay page draws for "Before you join" (payRiskAckView) once its other cards have had their say:
 *   - 'none': nothing; either no acknowledgment is owed, or a block card, a pending check or the approval card stands
 *     in front of the payment options (`outranked`), so asking would be for options the viewer could not use.
 *   - 'held': an acknowledgment is owed (or still being read), but the host's payment settings are not known yet
 *     (`settings` 'loading') or could not be read ('error'). Those settings decide whether the approval card outranks
 *     the dialog (requires_approval), so the dialog must not open before them: it would open, then close by itself
 *     when "Waiting on host approval" arrives, or ask in front of "Couldn't reach the payment service". The page shows
 *     its settings card (loading, or Retry) in its place. The payment options stay hidden: they wait on
 *     payRiskAckView's own answer as well.
 *   - 'checking' / 'ask': payRiskAckView's, once the settings are known.
 */
export type PayRiskAckStep = "none" | "held" | "checking" | "ask";

export function payRiskAckStep(input: {
  riskAck: PayRiskAckView;
  /** A block card, a pending check or the approval card is on screen in place of the payment options. */
  outranked: boolean;
  /** The host's payment settings and methods (getGamePaymentSettings, listPaymentMethodsForHost). */
  settings: "loading" | "error" | "ready";
}): PayRiskAckStep {
  if (input.outranked || input.riskAck === "none") return "none";
  if (input.settings !== "ready") return "held";
  return input.riskAck;
}

/**
 * Whether the pay page shows "Waiting on host approval" in place of the payment options. As on the game page
 * (requiresApproval = the host's setting, or the viewer outside the game's age range), a viewer whose only block is
 * the age range and whose request is pending waits on the host: their approval lifts the age rule
 * (enforce_game_age_requirement and AGE_REQUIREMENT_NOT_MET skip approved players), so "Payment unlocks after the
 * host approves you" is true, and "You can't pay for this game" would not be. With no request, or a declined one, the
 * age block card stays.
 */
export function payAwaitsApproval(input: {
  /** The host's payment settings require approval (game_payment_settings.requires_approval). */
  hostRequiresApproval: boolean;
  approved: boolean;
  requestPending: boolean;
  /** The block card payEntryView would draw in place of the payment options, if any. */
  replaceBlock: PayEntryBlock | null;
}): boolean {
  if (input.approved) return false;
  if (input.hostRequiresApproval) return true;
  return input.requestPending && input.replaceBlock?.kind === "age";
}
