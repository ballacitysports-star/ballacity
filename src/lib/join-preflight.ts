/**
 * What a tap on the game page's join CTA does first, before anything is sent.
 *
 * Joining asks the player to acknowledge the activity's risks ("Before you
 * join", `needsRiskAcknowledgment` in ./safety), and accepting stores a
 * consent row. Some joins the page can already refuse on its own: an expired
 * invite, an invite link whose host does not match, a locked game, a full
 * roster, a host who cannot take requests. Those refusals come first. A
 * player must not be asked to accept the risks, and have that recorded, for a
 * join that is then turned down.
 *
 * The refusals mirror the guards in `executeJoinAction`
 * (src/routes/games.$gameId.index.tsx), in the same order and with the same
 * messages. They only cover a tap that starts a new join or request: leaving,
 * cancelling a pending request and paying for an approved spot never show the
 * risk dialog, and keep their own handling there.
 */

export const INVITE_EXPIRED_MESSAGE = "This invite has expired. Browse open games instead.";
export const GAME_FULL_MESSAGE = "This game is full.";
export const NO_REQUEST_HOST_MESSAGE = "This host can't take requests yet.";
export const INVITE_TAMPERED_MESSAGE = "This invite link is invalid or has been tampered with.";

export type JoinRefusal =
  | { kind: "invite_expired"; message: string; redirectTo: "/discover" }
  | { kind: "locked"; message: string }
  | { kind: "full"; message: string }
  | { kind: "no_request_host"; message: string }
  | { kind: "invite_tampered"; message: string };

export type JoinPreflightInput = {
  /** Opened from an invite link whose `exp` has passed or is malformed. */
  inviteExpired: boolean;
  /** Started, host-closed or inside the sign-up blackout (the page's join gate). */
  locked: boolean;
  /** The join gate's reason, shown when `locked`. */
  lockedReason: string;
  spotsLeft: number;
  /** A guarded minor on an open game: the tap asks the parent, not the host. */
  asksParent: boolean;
  /** Paid game whose approval step is cleared: the tap opens the pay page. */
  goesToPayment: boolean;
  /** Approval-gated and not yet approved: the tap sends the host a request. */
  asksHost: boolean;
  /** Who a request would go to (settings host, else the game's host). */
  requestHostId: string | null;
  /** The URL claims `invite=1`. */
  isInvite: boolean;
  /** The invite link's `from` (the inviting host). */
  inviteFrom: string | null | undefined;
};

/**
 * The refusal a new join or request runs into before any write, or null when
 * the page has nothing to refuse and the join may go ahead.
 */
export function joinPreflightRefusal(input: JoinPreflightInput): JoinRefusal | null {
  if (input.inviteExpired) {
    return { kind: "invite_expired", message: INVITE_EXPIRED_MESSAGE, redirectTo: "/discover" };
  }
  if (input.asksParent) {
    if (input.locked) return { kind: "locked", message: input.lockedReason };
    if (input.spotsLeft <= 0) return { kind: "full", message: GAME_FULL_MESSAGE };
    if (!input.requestHostId) return { kind: "no_request_host", message: NO_REQUEST_HOST_MESSAGE };
    return null;
  }
  // The pay page has its own checks for an approved (or approval-free) paid spot.
  if (input.goesToPayment) return null;
  if (input.locked) return { kind: "locked", message: input.lockedReason };
  if (input.spotsLeft <= 0) return { kind: "full", message: GAME_FULL_MESSAGE };
  if (input.asksHost) {
    if (!input.requestHostId) return { kind: "no_request_host", message: NO_REQUEST_HOST_MESSAGE };
    if (input.isInvite && (!input.inviteFrom || input.inviteFrom !== input.requestHostId)) {
      return { kind: "invite_tampered", message: INVITE_TAMPERED_MESSAGE };
    }
  }
  return null;
}

export type JoinTapStep =
  { step: "refuse"; refusal: JoinRefusal } | { step: "acknowledge" } | { step: "join" };

/**
 * The first step of a tap on the join CTA. Without a pending risk
 * acknowledgment the join runs as usual (its own guards refuse what they
 * must). With one, a refusal the page can decide wins over the dialog, and
 * only a join that could go ahead asks for the acknowledgment.
 */
export function joinTapStep(input: JoinPreflightInput & { needsRiskAck: boolean }): JoinTapStep {
  if (!input.needsRiskAck) return { step: "join" };
  const refusal = joinPreflightRefusal(input);
  if (refusal) return { step: "refuse", refusal };
  return { step: "acknowledge" };
}
