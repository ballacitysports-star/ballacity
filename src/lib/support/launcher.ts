/**
 * Where the floating Help button appears.
 *
 * Signed-in members only: the chat needs a member to run as. Signed-out
 * visitors reach the same drawer, with the written answers, from /contact.
 *
 * Hidden where it would sit on top of something the member is in the middle of:
 * sign-in and onboarding, the parental-approval link, the message composer, the
 * create-a-game form (its labels and the Review and publish button run under the
 * button's corner as the host scrolls), the team, organization and trainer create and
 * edit wizards (same reason: lifted above their Next bar, the button would sit on the
 * scrolling form's labels and input edges), the pay screen, and /contact itself (which
 * has its own Help card).
 *
 * Non-form pages with a fixed bottom bar (the game page's join bar, a trainer's
 * Message/Book bar) keep the button; the bar lifts it clear (see launcher-clearance.ts).
 */

const HIDDEN_PREFIXES = [
  "/auth",
  "/onboarding",
  "/parent/consent",
  "/messages",
  "/contact",
  "/create",
  "/orgs/create",
  "/teams/create",
  "/trainers/create",
];

/** Exact screens, matched after the trailing slash is dropped. */
const HIDDEN_PATTERNS = [
  /^\/games\/[^/]+\/pay$/,
  // The create/edit wizards' edit screens.
  /^\/(orgs|teams|trainers)\/[^/]+\/edit$/,
];

export function showSupportLauncher(pathname: string, signedIn: boolean): boolean {
  if (!signedIn) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (HIDDEN_PATTERNS.some((re) => re.test(path))) return false;
  return !HIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
