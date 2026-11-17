/**
 * Start the root gate's account-type check while its age check is still out.
 *
 * The root AuthGate runs two server checks before it renders a protected page: the member's
 * age (getMyAgeStatus), then whether they have picked an account type (getOnboardingStatus).
 * Each server function verifies the access token with the auth server first, so on a slow
 * auth server (1-8 s per call on the shared sandbox) asking one after the other doubled the
 * wait on every first page load of a tab.
 *
 * Only the *answer* has to wait for the age step: the account-type picker must never show
 * before the age is settled. Asking early does not change that. The gate starts the type check
 * here when it starts the age check, and the type step takes the answer when it runs. An answer
 * is used at most once, only for the user it was asked for, and is dropped when the age step
 * has to stop for input (the member may take minutes there), so the type step then asks again.
 */
export type OnboardingPrefetch<T> = {
  /** Start the check for `userId` unless one is already out for them. */
  start(userId: string, fetcher: () => Promise<T>): void;
  /** The answer started for `userId`, once; null when none is out (ask afresh then). */
  take(userId: string): Promise<T> | null;
  /** Forget any answer started for `userId`. */
  drop(userId: string): void;
};

export function createOnboardingPrefetch<T>(): OnboardingPrefetch<T> {
  const pending = new Map<string, Promise<T>>();
  return {
    start(userId, fetcher) {
      if (pending.has(userId)) return;
      const p = Promise.resolve().then(fetcher);
      // Nobody may ever take it (the member signs out, the age step stops for input): do not
      // report an unhandled rejection for it. The taker still sees the rejection.
      p.catch(() => {});
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
