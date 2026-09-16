import { ACCOUNT_TYPE_ROUTE, isAccountSetupEscape } from "@/lib/age-verification";

export const DEFAULT_POST_AUTH_DESTINATION = "/feed";

export type PostAuthDestinationInput = {
  /** The sanitized `next` search param from `/auth`, if present. */
  next: string | undefined;
  /** True when the signed-in account still needs to pick an account type. */
  needsAccountType: boolean;
  /** Path recorded before the visitor was routed to `/auth`, if any. */
  lastVisited?: string | undefined;
  /** Same-origin referrer path, used when neither of the above is set. */
  referrer?: string | undefined;
};

/**
 * Where to send a member immediately after they authenticate.
 *
 * `AuthGate` already treats account-setup screens — guardian consent
 * (`/parent/consent/:token`), the Guardian Dashboard, safety/legal reading — as
 * escapes from the ordinary account-type gate (`isAccountSetupEscape`,
 * `skipTypeCheck` in `__root.tsx`). A brand-new guardian account signing in
 * from a consent link has no player/team/trainer/gym answer to give and
 * isn't supposed to need one to reach that screen.
 *
 * This function has to agree with that gate. If it sent every unresolved
 * account to the account-type picker first, a guardian would be forced
 * through a question the root gate itself skips for them, stranded one step
 * before the consent screen they were emailed a link to.
 */
export function postAuthDestination(input: PostAuthDestinationInput): string {
  const { next, needsAccountType, lastVisited, referrer } = input;

  if (next && isAccountSetupEscape(next)) return next;
  if (needsAccountType) return ACCOUNT_TYPE_ROUTE;
  return next ?? lastVisited ?? referrer ?? DEFAULT_POST_AUTH_DESTINATION;
}
