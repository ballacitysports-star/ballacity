/**
 * Predicate used by the game-detail sticky CTA to decide whether tapping
 * the button should trigger the "leave / withdraw" flow.
 *
 * The CTA also relies on a local `joined` flag (from `useIsJoined`) that
 * can lag or momentarily rehydrate after a realtime refetch. On games that
 * require approval OR payment, a stale `joined=true` MUST NOT re-route a
 * fresh "Request to join" tap into the leave branch — otherwise the user
 * sees "You left the game." toast right after they meant to re-request.
 *
 * Rules:
 *   - Confirmed viewers (approved + paid where applicable) always leave.
 *   - `joined` alone counts only on free, no-approval games where the local
 *     flag is the sole source of truth.
 */
export function shouldTriggerLeaveBranch(input: {
  isConfirmed: boolean;
  joined: boolean;
  requiresApproval: boolean;
  isPaid: boolean;
}): boolean {
  const { isConfirmed, joined, requiresApproval, isPaid } = input;
  return isConfirmed || (joined && !requiresApproval && !isPaid);
}
