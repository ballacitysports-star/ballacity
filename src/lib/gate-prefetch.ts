/**
 * Start one of the root gate's server checks early, and hand its answer to the gate step that
 * needs it later.
 *
 * Before a protected page renders, the root AuthGate needs three answers, each of which waits
 * on the auth server (1-8 s per call on a loaded one): the auth store's verification of the
 * stored session (GET /auth/v1/user), the member's age (getMyAgeStatus) and whether they have
 * picked an account type (getOnboardingStatus); each server function verifies the token with
 * the auth server itself first. Asked one after the other, a first page load waited for three
 * round trips in a row.
 *
 * Only the *answers* have to wait their turn: nothing may render before the session is
 * verified, and the account-type picker must never show before the age is settled. Asking
 * early changes neither: the gate starts both checks for the stored session's user while that
 * session is being verified, and each step takes its answer when it runs, after the steps
 * before it. An answer is used at most once and only for the user it was asked for (a
 * verification that names someone else, or no one, never sees it), and a step drops what it
 * no longer trusts, so the next step asks afresh.
 */
export type GatePrefetch<T> = {
  /** Start the check for `userId` unless one is already out for them. */
  start(userId: string, fetcher: () => Promise<T>): void;
  /** The answer started for `userId`, once; null when none is out (ask afresh then). */
  take(userId: string): Promise<T> | null;
  /** Forget any answer started for `userId`. */
  drop(userId: string): void;
};

export function createGatePrefetch<T>(): GatePrefetch<T> {
  const pending = new Map<string, Promise<T>>();
  return {
    start(userId, fetcher) {
      if (pending.has(userId)) return;
      const p = Promise.resolve().then(fetcher);
      // A failure that comes back before anyone takes it is forgotten, so the step asks afresh
      // with whatever session it has by then: the early check may have gone out with a stored
      // token the auth server then refused, and the member can sign in again in the same tab.
      // (The age step treats a failed check as "let them through, the server still refuses
      // age-restricted actions"; that must only ever follow a check made for the session in
      // hand.) A taker that already holds the promise still sees the failure. Nobody may ever
      // take it (the session fails verification, the member signs out, a step stops for
      // input), so this also keeps the rejection from being reported as unhandled.
      p.catch(() => {
        if (pending.get(userId) === p) pending.delete(userId);
      });
      pending.set(userId, p);
    },
    take(userId) {
      const p = pending.get(userId) ?? null;
      pending.delete(userId);
      return p;
    },
    drop(userId) {
      pending.delete(userId);
    },
  };
}
