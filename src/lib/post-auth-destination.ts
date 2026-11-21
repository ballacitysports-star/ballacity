import { ACCOUNT_TYPE_ROUTE, isAccountSetupEscape } from "@/lib/age-verification";

export const DEFAULT_POST_AUTH_DESTINATION = "/feed";

export type PostAuthDestinationInput = {
  /** The sanitized `next` search param from `/auth`, if present. */
  next: string | undefined;
  /**
   * The sanitized page stashed by the Google/Apple button before the provider
   * round trip (`openrun:oauth-next`, see `src/lib/oauth-next.ts`). It stands in
   * for `next` when the return to `/auth` arrives without one.
   */
  savedNext?: string | undefined;
  /** True when the signed-in account still needs to pick an account type. */
  needsAccountType: boolean;
  /**
   * The setup this account chose at sign-up and has not started yet
   * (`hrefForSetup(startSetupOf(user))`), if any.
   */
  startDestination?: string | undefined;
  /** Path recorded before the visitor was routed to `/auth`, if any. */
  lastVisited?: string | undefined;
  /** Same-origin referrer path, used when neither of the above is set. */
  referrer?: string | undefined;
};

/**
 * Where to send a member immediately after they authenticate.
 *
 * `AuthGate` already treats account-setup screens — guardian consent
 * (`/parent/consent/:token`), the Parent Center, safety/legal reading — as
 * escapes from the ordinary account-type gate (`isAccountSetupEscape`,
 * `skipTypeCheck` in `__root.tsx`). A brand-new guardian account signing in
 * from a consent link has no player/team/trainer/gym answer to give and
 * isn't supposed to need one to reach that screen.
 *
 * This function has to agree with that gate. If it sent every unresolved
 * account to the account-type picker first, a guardian would be forced
 * through a question the root gate itself skips for them, stranded one step
 * before the consent screen they were emailed a link to.
 *
 * An account that chose a role at sign-up goes to that role's setup before
 * anything it merely visited or was referred from — but never ahead of a page it
 * explicitly asked for (`next`), which it keeps.
 *
 * A page asked for before a Google/Apple round trip (`savedNext`) is the same
 * request as `next`. The usual return keeps `next`: a redirect sign-in comes
 * back to the site root (`redirect_uri` is the origin), not to `/auth`, and a
 * popup sign-in finishes on the `/auth?next=…` page it started from. So `/auth`
 * sees a stash without `next` only when it loads without the query while one is
 * stashed: an in-app browser that strips it, or a stash left by an earlier
 * attempt in this tab. Either way the root's sign-in listener honours the stash
 * (for any SIGNED_IN), so this must agree with it, or the full-page `leave()`
 * from `/auth` and the listener's navigation send the member to different
 * places and whichever runs last wins.
 */
export function postAuthDestination(input: PostAuthDestinationInput): string {
  const { needsAccountType, startDestination, lastVisited, referrer } = input;
  const next = input.next ?? input.savedNext;

  if (next && isAccountSetupEscape(next)) return next;
  if (needsAccountType) return ACCOUNT_TYPE_ROUTE;
  if (next !== undefined) return next;
  if (startDestination) return startDestination;
  return lastVisited ?? referrer ?? DEFAULT_POST_AUTH_DESTINATION;
}
