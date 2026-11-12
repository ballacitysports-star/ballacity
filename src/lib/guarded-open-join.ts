/**
 * A minor with a linked guardian on a game that does not need the host's approval (an "open" game).
 *
 * The database gives such a player a place, or takes their payment, only on a request for that game that a current
 * guardian approved (enforce_child_game_participation since 20261111160000, enforce_guardian_before_payment since
 * 20261110120000). On an open game the app used to offer "Join Run" or "Pay Host" straight away, so there was no
 * request: the join or the payment was refused and the guardian had nothing to approve.
 *
 * Here the player asks their parent instead. The request is the ordinary join request, marked with its idempotency
 * key, and only the guardian answers it: the host never has to, so it stays out of the host's queue while the game
 * stays open. If the host turns approval on later, the same request becomes a normal request the host answers too.
 */

/** Idempotency-key prefix of a request only a guardian answers. */
export const GUARDIAN_ONLY_KEY_PREFIX = "guardian-only:";

export function guardianOnlyRequestKey(gameId: string): string {
  return `${GUARDIAN_ONLY_KEY_PREFIX}${gameId}`;
}

export function isGuardianOnlyRequest(row: { idempotency_key?: string | null } | null | undefined) {
  return !!row?.idempotency_key?.startsWith(GUARDIAN_ONLY_KEY_PREFIX);
}

/**
 * Whether this viewer joins through their parent alone: not the host, has an active guardian link, and the game
 * (for this viewer) needs no host approval. A game that needs the host keeps its usual request, which the guardian
 * also answers.
 *
 * Two cases keep the ordinary button, matching what the database does:
 * - a paid game the viewer's age group cannot pay for (13-15, under 13): the parent's yes could not lead to a place,
 *   so the viewer gets Pay Host and the pay page's "payments aren't available" message, as before;
 * - a free game when the viewer is known to be 18 or over: the roster gate checks the guardian only for a minor, so
 *   an adult whose link is still active joins directly. On a paid game the payment gate checks the link itself, so
 *   the parent is still asked there. An unknown age counts as a minor.
 */
export function guardianOnlyJoin(input: {
  isHost: boolean;
  hasGuardian: boolean;
  requiresApproval: boolean;
  isPaid?: boolean;
  canPay?: boolean;
  viewerAge?: number | null;
}): boolean {
  if (input.isHost || !input.hasGuardian || input.requiresApproval) return false;
  if (input.isPaid) return input.canPay !== false;
  return input.viewerAge == null || input.viewerAge < 18;
}

/**
 * Whether the main button asks the parent (first time, or again after a no). Not while a payment is pending or
 * verified: the button then follows the payment (view it, or withdraw it), so a child whose parent said no after they
 * paid can still take the payment back.
 */
export function asksParent(
  step: GuardedOpenStep | null,
  latestPaymentStatus: string | null | undefined,
): boolean {
  if (step !== "ask_parent" && step !== "declined") return false;
  return !latestPaymentStatus || latestPaymentStatus === "rejected";
}

/**
 * Whether the host should see (and answer) a request. The only requests the host does not answer are those sent to
 * a guardian alone on a game that is open: requires_approval false. A game with no settings row is request-to-join,
 * so its requests stay with the host.
 */
export function hostAnswersRequest(
  row: { idempotency_key?: string | null },
  requiresApproval: boolean | null | undefined,
): boolean {
  return !(isGuardianOnlyRequest(row) && requiresApproval === false);
}

/** Where a guarded minor stands on an open game. */
export type GuardedOpenStep = "ask_parent" | "waiting_parent" | "declined" | "cleared";

export function guardedOpenStep(
  req: {
    status: "pending" | "approved" | "rejected";
    guardian_approved_at?: string | null;
  } | null,
): GuardedOpenStep {
  if (!req) return "ask_parent";
  if (req.status === "rejected") return "declined";
  return req.guardian_approved_at ? "cleared" : "waiting_parent";
}

/** The banner the player sees for each step. */
export function guardedOpenCopy(
  step: GuardedOpenStep,
  opts: { isPaid: boolean; declinedByGuardian?: boolean },
): { title: string; body: string } {
  switch (step) {
    case "ask_parent":
      return {
        title: "Ask your parent first",
        body: "Your parent is linked to your account, so they OK each game before you join. This game doesn't need the host's approval, only theirs.",
      };
    case "waiting_parent":
      return {
        title: "Waiting for your parent",
        body: "You're not in yet. Your parent can approve this game in their Parent Center, and we've let them know. The host doesn't need to answer.",
      };
    case "declined":
      return {
        title: opts.declinedByGuardian
          ? "Your parent said no to this game"
          : "This request was declined",
        body: "You can ask again later.",
      };
    case "cleared":
      return opts.isPaid
        ? {
            title: "Your parent said yes",
            body: "Pay the host to lock in your spot. You're on the roster once they confirm it.",
          }
        : { title: "Your parent said yes", body: "Tap Join Run to take your spot." };
  }
}

/**
 * The player's own line on a request card (Me tab, "My sent requests"). A request to the parent on an open game is
 * never answered by the host, so it must not say "Waiting for host approval"; a guardian's no is the parent's, not
 * the host's.
 */
export function playerRequestLine(r: {
  status: "pending" | "approved" | "rejected";
  idempotency_key?: string | null;
  guardian_approved_at?: string | null;
  reviewer_notes?: string | null;
}): string {
  if (r.status === "rejected")
    return r.reviewer_notes === "Declined by guardian"
      ? "Declined by your parent."
      : "Declined by host.";
  if (r.status === "approved") return "Approved — you're on the roster.";
  if (isGuardianOnlyRequest(r))
    return r.guardian_approved_at
      ? "Your parent said yes. Open the game to join."
      : "Waiting for your parent";
  return "Waiting for host approval";
}

/**
 * The player's own requests worth listing. A request to the parent stays pending after the child is on the roster
 * (the host never answers it), so it is left out for a game they have joined: its Cancel would only delete the
 * request and say "Request canceled." while the place stays.
 */
export function listablePlayerRequests<
  T extends { game_id: string; status: string; idempotency_key?: string | null },
>(rows: T[], joinedGameIds: Iterable<string>): T[] {
  const joined = new Set(joinedGameIds);
  return rows.filter(
    (r) => !(r.status === "pending" && isGuardianOnlyRequest(r) && joined.has(r.game_id)),
  );
}

/** The main button's label before the player is in. */
export const ASK_PARENT_LABEL = "Ask your parent";
export const ASK_PARENT_AGAIN_LABEL = "Ask your parent again";
