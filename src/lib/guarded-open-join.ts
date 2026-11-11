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
 */
export function guardianOnlyJoin(input: {
  isHost: boolean;
  hasGuardian: boolean;
  requiresApproval: boolean;
}): boolean {
  return !input.isHost && input.hasGuardian && !input.requiresApproval;
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

/** The main button's label before the player is in. */
export const ASK_PARENT_LABEL = "Ask your parent";
export const ASK_PARENT_AGAIN_LABEL = "Ask your parent again";
