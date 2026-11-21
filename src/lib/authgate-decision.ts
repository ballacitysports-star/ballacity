/**
 * What AuthGate does with the current route before any network check, pulled
 * out of routes/__root.tsx so the order of its rules can be tested on its own.
 *
 * - "wait-for-auth": useAuth is still loading; decide nothing yet.
 * - "user-present", "public-skip", "auth-route-skip": render the page.
 * - "identity-switch-skip": no user, but this tab is between signing one
 *   session out and the next in (guardian <-> managed child). Hold on the
 *   loading fallback; the switch ends in its own full page load.
 * - "verify": no user on a protected page. Re-check the session and, if there
 *   is none, send the tab to /auth.
 */
export type AuthGateStep =
  | "wait-for-auth"
  | "user-present"
  | "public-skip"
  | "auth-route-skip"
  | "identity-switch-skip"
  | "verify";

export function decideAuthGateStep(input: {
  loading: boolean;
  hasUser: boolean;
  isPublic: boolean;
  pathname: string;
  /** From useIdentitySwitchHold: a switch is running and has not overrun its allowance. */
  holdForIdentitySwitch: boolean;
}): AuthGateStep {
  if (input.loading) return "wait-for-auth";
  if (input.hasUser) return "user-present";
  if (input.isPublic) return "public-skip";
  if (input.pathname === "/auth") return "auth-route-skip";
  if (input.holdForIdentitySwitch) return "identity-switch-skip";
  return "verify";
}

/**
 * How long AuthGate holds a signed-out tab for an identity switch before it
 * stops trusting the flag. Every switch path ends in a full page load after a
 * few auth calls; one that has not navigated after this long is stuck, and the
 * tab must not sit on the loading fallback forever. The normal sign-in check
 * then runs, exactly as for any signed-out visitor.
 */
export const IDENTITY_SWITCH_MAX_HOLD_MS = 15_000;

/** Milliseconds left in the hold for a switch that began at `startedAt` (0 when none is left). */
export function identitySwitchHoldRemainingMs(
  startedAt: number | null,
  now: number,
  maxMs: number = IDENTITY_SWITCH_MAX_HOLD_MS,
): number {
  if (startedAt === null) return 0;
  return Math.max(0, startedAt + maxMs - now);
}
