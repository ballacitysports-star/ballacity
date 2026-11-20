import type { JoinRefusal, JoinTapStep } from "@/lib/join-preflight";

/**
 * Copy and rules for the one dialog that joins a free game
 * (src/components/game-detail/JoinGameDialog.tsx).
 */

export const JOIN_GAME_TITLE = "Join this game?";
export const JOIN_GAME_ACTION = "Join game";
/** The standalone "Before you join" dialog's own button wording. */
export const AGREE_AND_JOIN_ACTION = "Agree & join";

/** The confirm button's label: the acknowledgment's own wording when it is due. */
export function joinGameActionLabel(needsAck: boolean): string {
  return needsAck ? AGREE_AND_JOIN_ACTION : JOIN_GAME_ACTION;
}

/**
 * Whether the confirm button may be pressed: never while submitting, and,
 * when the risk acknowledgment is due, not until its checkbox is ticked.
 */
export function canConfirmJoin(input: {
  needsAck: boolean;
  checked: boolean;
  submitting: boolean;
}): boolean {
  if (input.submitting) return false;
  return !input.needsAck || input.checked;
}

/**
 * Whether a new join on this game is a free, instant one (executeJoinAction's
 * last branch): no parent to ask, no host approval pending, no fee. Only these
 * use the merged dialog; requests and paid joins keep "Before you join".
 */
export function isFreeInstantJoin(input: {
  asksParent: boolean;
  asksHost: boolean;
  isPaid: boolean;
}): boolean {
  return !input.asksParent && !input.asksHost && !input.isPaid;
}

export type JoinTapRoute =
  | { route: "refuse"; refusal: JoinRefusal }
  /** The merged "Join this game?" dialog, with the acknowledgment when it is due. */
  | { route: "join-dialog"; needsAck: boolean }
  /** The standalone "Before you join" dialog (request, parent ask, paid). */
  | { route: "risk-dialog" }
  /** Go ahead without a dialog (leave, cancel, or a join with nothing to ask). */
  | { route: "join" };

/**
 * Where a join tap goes once joinTapStep has decided it. Refusals stay first,
 * and a due acknowledgment is never skipped: it is either the merged dialog's
 * checkbox or the standalone dialog. `confirm` is the sticky CTA's free join,
 * which always asks "Join this game?" (with the reminder picker) first.
 */
export function joinTapRoute(
  step: JoinTapStep,
  input: { freeInstantJoin: boolean; confirm: boolean },
): JoinTapRoute {
  if (step.step === "refuse") return { route: "refuse", refusal: step.refusal };
  if (step.step === "acknowledge") {
    return input.freeInstantJoin
      ? { route: "join-dialog", needsAck: true }
      : { route: "risk-dialog" };
  }
  if (input.confirm && input.freeInstantJoin) return { route: "join-dialog", needsAck: false };
  return { route: "join" };
}

export type AckThenJoinResult = { ok: true } | { ok: false; stage: "ack" | "join"; error: unknown };

/**
 * "Join this game?" confirmed with the acknowledgment due: record it for the
 * current version first, and run the join only once that write has succeeded.
 * A failed write stops here (stage "ack"): nothing is joined and the caller
 * keeps the dialog open. The server still refuses a join without it.
 */
export async function recordAckThenJoin(steps: {
  /** Records the participant_risk acknowledgment; must reject if the write failed. */
  recordAck: () => Promise<void>;
  join: () => Promise<void>;
}): Promise<AckThenJoinResult> {
  try {
    await steps.recordAck();
  } catch (error) {
    return { ok: false, stage: "ack", error };
  }
  try {
    await steps.join();
  } catch (error) {
    return { ok: false, stage: "join", error };
  }
  return { ok: true };
}
