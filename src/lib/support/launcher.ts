/**
 * Where the floating Help button appears.
 *
 * Signed-in members only: the chat needs a member to run as. Signed-out
 * visitors reach the same drawer, with the written answers, from /contact.
 *
 * Hidden where it would sit on top of something the member is in the middle of:
 * sign-in and onboarding, the parental-approval link, the message composer, and
 * /contact itself (which has its own Help card).
 */

const HIDDEN_PREFIXES = ["/auth", "/onboarding", "/parent/consent", "/messages", "/contact"];

export function showSupportLauncher(pathname: string, signedIn: boolean): boolean {
  if (!signedIn) return false;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return !HIDDEN_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}
