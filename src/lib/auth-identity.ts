import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

/**
 * The signed-in identity a listener last reacted to: a user id, `null` for
 * signed out, or `undefined` while it has not reacted to any event yet.
 */
export type SeenIdentity = string | null | undefined;

/**
 * Whether an auth event changes who is signed in, so per-user data must be
 * reloaded.
 *
 * supabase-js emits SIGNED_IN for more than a sign-in. Every client start and
 * every time a tab becomes visible again, it re-reads the stored session and
 * emits SIGNED_IN with it, and it broadcasts that event to every other open
 * tab of the app. Treating each of those as a new sign-in made opening or
 * focusing one tab reload every query in every tab.
 *
 * - SIGNED_IN counts only when the user id differs from the one last seen.
 *   A first SIGNED_IN with nothing seen yet (`previous` undefined) counts, so
 *   a page still reloads once with the browser's session, as before. A
 *   listener that subscribes after the client started gets INITIAL_SESSION
 *   first, and `trackIdentity` seeds the identity from it, so the SIGNED_IN
 *   that supabase-js re-emits later for the same member does not count.
 * - USER_UPDATED (profile or email change) and SIGNED_OUT always count.
 * - Everything else (INITIAL_SESSION, TOKEN_REFRESHED, PASSWORD_RECOVERY,
 *   MFA_CHALLENGE_VERIFIED) never counts.
 */
export function isIdentityChange(
  previous: SeenIdentity,
  event: AuthChangeEvent,
  session: Session | null,
): boolean {
  if (event === "SIGNED_OUT" || event === "USER_UPDATED") return true;
  if (event !== "SIGNED_IN") return false;
  if (previous === undefined) return true;
  return (session?.user?.id ?? null) !== previous;
}

/** The identity to remember after reacting to `event`. */
export function identityAfter(event: AuthChangeEvent, session: Session | null): string | null {
  return event === "SIGNED_OUT" ? null : (session?.user?.id ?? null);
}

/**
 * One step of a listener's identity tracking: whether to reload for `event`,
 * and the identity to remember afterwards. INITIAL_SESSION never reloads, but
 * a listener that has seen nothing yet remembers who it names (or signed out),
 * so a later SIGNED_IN re-emitted for that same member is not a change.
 */
export function trackIdentity(
  previous: SeenIdentity,
  event: AuthChangeEvent,
  session: Session | null,
): { changed: boolean; seen: SeenIdentity } {
  if (event === "INITIAL_SESSION") {
    return {
      changed: false,
      seen: previous === undefined ? (session?.user?.id ?? null) : previous,
    };
  }
  if (!isIdentityChange(previous, event, session)) return { changed: false, seen: previous };
  return { changed: true, seen: identityAfter(event, session) };
}
