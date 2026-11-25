/**
 * A player the host removed from a game (public.game_removals, 20261202100000_removal_sticks). Owner decisions
 * 2026-11-24: "Removal sticks on open games", and for the way back, "Ask the host, or an invite".
 *
 * host_remove_player records the removal; the database then refuses the player a place in that game
 * (REMOVED_BY_HOST: their own join, the server's place after a payment, a payment claim, PayPal) until a request of
 * theirs for the game is approved: an accepted invitation, or the host approving the request the player sends to ask
 * back. The record is deleted at that moment, so an approved request means the player is no longer removed.
 *
 * On the game page a removed player is in the request-to-join flow, whatever the game's own setting: the main button
 * reads "Ask the host to let you back in" and sends the ordinary join request, which the host answers like any other.
 * Its resend cooldown and attempt cap hold for a resend of a declined request; a request the player deleted (the
 * pending ask's cancel does this) starts over, an older gap recorded for the owner (996 pins it as NOT CLOSED). A guarded minor's request also waits for their guardian, as on a
 * game that needs the host's approval. Anything already under way keeps its button (a pending payment can still be
 * withdrawn), and a verified payment does not make a removed player "Confirmed".
 */

export const REMOVED_ASK_LABEL = "Ask the host to let you back in";

/** What a refused join reads (the join gate's REMOVED_BY_HOST). */
export const REMOVED_BY_HOST_MESSAGE =
  "The host removed you from this game. Ask them to let you back in from the game page.";

/**
 * Whether the viewer counts as removed on this page: the database has their record for the game, they are not the
 * host, they are not on the roster, and their request is not approved (an approval deletes the record, so a page that
 * has seen the approval but not yet re-read the record must not keep showing the removal).
 */
export function viewerRemoved(input: {
  recorded: boolean;
  isHost: boolean;
  joined: boolean;
  requestStatus: string | null | undefined;
}): boolean {
  return input.recorded && !input.isHost && !input.joined && input.requestStatus !== "approved";
}

/**
 * Whether the game page sends this viewer's tap to the host (a request) rather than joining them: the host's setting,
 * an age range the viewer (not the host) falls outside, or a removal by the host (whatever the game's setting). The
 * page's `requiresApproval`, which also decides the preflight's asksHost and the "Join as position" chips.
 */
export function viewerRequiresApproval(input: {
  hostRequiresApproval: boolean;
  isHost: boolean;
  ageNeedsApproval: boolean;
  removed: boolean;
}): boolean {
  return input.hostRequiresApproval || (!input.isHost && input.ageNeedsApproval) || input.removed;
}

/**
 * The game page's gate flags for a viewer who is not the host. `requiresApproval` is the game's own rule for this
 * viewer (the host's setting, or an age range they fall outside); a removed viewer always goes through the host.
 *
 * Order the main button follows (src/routes/games.$gameId.index.tsx):
 *   1. waiting on the parent (a guarded minor whose request the guardian has not approved);
 *   2. isConfirmed ("Confirmed · Tap to leave"): never for a removed viewer, whatever they paid;
 *   3. isPending: a request waiting on the host ("Request pending · Tap to cancel") or a payment waiting on the host
 *      ("Payment pending · Tap to withdraw"), for a removed viewer too, so a claim can still be taken back;
 *   4. the locks, the roster count and the parent's ask, as before;
 *   5. the request to the host: REMOVED_ASK_LABEL for a removed viewer, "Request Spot" otherwise.
 */
export function viewerJoinFlags(input: {
  requiresApproval: boolean;
  removed: boolean;
  isPaid: boolean;
  requestStatus: string | null | undefined;
  /** A guarded minor on an open game whose request only the guardian answers (never for a removed viewer). */
  guardianOnly: boolean;
  latestPaymentStatus: string | null | undefined;
  /** A guardian still has to approve (joinWait's onParent). */
  waitingOnParent: boolean;
}) {
  const hostDecides = input.requiresApproval || input.removed;
  const isApproved = input.requestStatus === "approved";
  const isRequestPending = input.requestStatus === "pending" && !input.guardianOnly;
  const isPaymentVerified = input.latestPaymentStatus === "verified";
  const isPaymentPending = input.latestPaymentStatus === "pending";
  // Approval-gated games treat approval as the first gate; payment becomes actionable only after the host approves.
  const approvalCleared = !hostDecides || isApproved;
  const paymentCleared = !input.isPaid || isPaymentVerified;
  // A minor whose guardian has not approved is not confirmed, whatever the host said.
  const isConfirmed =
    approvalCleared && paymentCleared && (hostDecides || input.isPaid) && !input.waitingOnParent;
  // "Payment pending" only once approval is cleared, so players don't see it before they've been approved; a removed
  // player keeps it, so a claim sent before the removal can still be withdrawn.
  const isPending = isRequestPending || ((approvalCleared || input.removed) && isPaymentPending);
  return {
    hostDecides,
    isApproved,
    isRequestPending,
    isPaymentVerified,
    isPaymentPending,
    approvalCleared,
    paymentCleared,
    isConfirmed,
    isPending,
  };
}

/**
 * The flow status the game page shows a removed player (the pill, the paid strip, the payment banner). The shared
 * status (useMyFlowStatus) knows nothing of a removal, so on an open paid game a removed player with a verified payment
 * would read "You're In!". A payment still with the host (sent, or declined and to be sent again) keeps its own status,
 * so its strip and its way to withdraw stay; otherwise the removed player's request decides: "requested" while their
 * ask waits for the host, else "rejected".
 */
export function removedFlowStatus<S extends string>(
  status: S,
  removed: boolean,
  requestStatus: string | null | undefined,
): S | "requested" | "rejected" {
  if (!removed) return status;
  if (status === "payment_submitted" || status === "payment_rejected") return status;
  return requestStatus === "pending" ? "requested" : "rejected";
}

/** The removed player's banner on the game page. */
export function removedBannerCopy(input: {
  requestPending: boolean;
  /** New joins are locked (started, ended, cancelled, closed by the host, past the cutoff): no request can be sent. */
  locked?: boolean;
  /** The roster is full: a request is refused (GAME_FULL) until a spot opens. */
  full?: boolean;
  capReached: boolean;
  /** formatCooldownLabel of the resend cooldown still running, or null. */
  cooldownLabel: string | null;
  attemptLimit: number;
  paymentVerified: boolean;
}): { title: string; body: string } {
  const title = "The host removed you from this game";
  const next = input.requestPending
    ? "You asked the host to let you back in. You'll get a notification when they answer."
    : input.locked
      ? "Signups for this game are closed, so you can't ask to come back."
      : input.full
        ? "The game is full right now. You can ask the host to let you back in once a spot opens. Joining the waitlist won't tell you when one does, so check back here."
        : input.capReached
          ? `You've reached the ${input.attemptLimit}-attempt limit for this game. Message the host instead.`
          : input.cooldownLabel
            ? `You can ask the host to let you back in again in ${input.cooldownLabel}.`
            : "You can ask the host to let you back in. If they invite you again, accepting the invitation also lets you back.";
  const paid = input.paymentVerified
    ? " Your payment is still recorded: if you won't be playing, ask the host to send it back."
    : "";
  return { title, body: `${next}${paid}` };
}

/** The host's notice for a removed player's request (the ordinary join_request / join_resubmitted types). */
export function removedAskNotice(gameTitle: string): { title: string; body: string } {
  return {
    title: `Asks to be let back in: ${gameTitle}`,
    body: "A player you removed asked to come back. Approve to let them back in, or decline.",
  };
}
