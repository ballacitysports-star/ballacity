import { ACCOUNT_TYPE_ROUTE, isAccountSetupEscape } from "@/lib/age-verification";
import type { AccountType } from "@/lib/account-type";

export const DEFAULT_POST_AUTH_DESTINATION = "/feed";

/** Where an account with this active profile kind lands, absent any more specific destination. */
export function defaultHomeFor(kind: AccountType | null | undefined): string {
  return kind === "parent" ? "/parent" : DEFAULT_POST_AUTH_DESTINATION;
}

export type PostAuthDestinationInput = {
  /** The sanitized `next` search param from `/auth`, if present. */
  next: string | undefined;
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
  /** The signed-in account's active profile kind, consulted only at the final fallback. */
  activeProfileKind?: AccountType | null;
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
 */
export function postAuthDestination(input: PostAuthDestinationInput): string {
  const { next, needsAccountType, startDestination, lastVisited, referrer, activeProfileKind } =
    input;

  if (next && isAccountSetupEscape(next)) return next;
  if (needsAccountType) return ACCOUNT_TYPE_ROUTE;
  if (next !== undefined) return next;
  if (startDestination) return startDestination;
  return lastVisited ?? referrer ?? defaultHomeFor(activeProfileKind);
}
