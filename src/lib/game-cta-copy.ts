/**
 * Wording only. Nothing here decides whether someone can join, leave or request a spot:
 * the callers pass flags the game page already computes, and these functions only name
 * what is already happening or what tapping the card leads to.
 */

/** What the card's footer cue says. The whole card is a link to the game page. */
export function gameCardCueLabel(input: {
  /** The viewer already has a request, payment or spot on this game. */
  inFlow: boolean;
  /** Joining is currently closed (full, started, closed by the host, ended, cancelled). */
  locked: boolean;
  /** Parent mode hides joining, so the card only leads to details. */
  parentMode: boolean;
}): string {
  if (input.inFlow) return "View your spot";
  if (input.parentMode || input.locked) return "View details";
  return "View & join";
}

/**
 * The call to action's label while its request is in flight. It mirrors the label branches
 * of the idle button so the wording matches what the person just tapped.
 */
export function joinBusyLabel(input: {
  isConfirmed: boolean;
  joined: boolean;
  isPaid: boolean;
  isPending: boolean;
  requiresApproval: boolean;
  isApproved: boolean;
  payingPending: boolean;
}): string {
  if (input.isConfirmed || (input.joined && !input.isPaid)) return "Leaving…";
  if (input.isPending) return input.payingPending ? "Withdrawing…" : "Cancelling request…";
  if (input.requiresApproval && !input.isApproved) return "Sending request…";
  return "Joining…";
}
