/**
 * Shared test account fixtures for multi-user E2E flows.
 *
 * These accounts are seeded via `seedTestAccounts` (admin-gated server fn).
 * Passwords are intentionally non-secret — they exist only on seeded
 * fixture accounts used for notification/messaging E2E tests.
 *
 * One account is reserved: `session` backs the single session snapshot
 * `e2e/global-setup.ts` mints and exports as LOVABLE_BROWSER_SUPABASE_*, which
 * ~40 specs inject instead of signing in. Keep the real-form specs off it: loop
 * REAL_FORM_ACCOUNTS, never TEST_ACCOUNTS, when signing in for real, so their
 * profile/onboarding mutations can't perturb a snapshot 40 other specs share.
 *
 * This split was originally forced by something sharper. The app used to call
 * `supabase.auth.signOut()` bare, and Supabase defaults that to *global* scope
 * — one sign-out revokes every refresh token for the user. The fixture-* specs
 * sign out through the real form, so when `player` backed the snapshot they
 * silently killed it mid-run and every injection spec ordered after them got
 * 403s and bounced to /auth. The app now signs out with `scope: "local"` (see
 * signOut() in @/hooks/use-auth), so that particular hazard is gone and the
 * `player` fallback in global-setup survives a full run.
 */
export const TEST_ACCOUNTS = [
  {
    key: "session",
    email: "e2e-session@lovable.test",
    password: "E2E-session-pass-2026!",
    displayName: "E2E Session",
    role: "player" as const,
    sport: "Basketball",
    skill: "Intermediate",
    city: "Brooklyn, NY",
  },
  {
    key: "host",
    email: "e2e-host@lovable.test",
    password: "E2E-host-pass-2026!",
    displayName: "E2E Host",
    role: "host" as const,
    sport: "Basketball",
    skill: "Intermediate",
    city: "Brooklyn, NY",
  },
  {
    key: "player",
    email: "e2e-player@lovable.test",
    password: "E2E-player-pass-2026!",
    displayName: "E2E Player",
    role: "player" as const,
    sport: "Basketball",
    skill: "Intermediate",
    city: "Brooklyn, NY",
  },
  {
    key: "player2",
    email: "e2e-player2@lovable.test",
    password: "E2E-player2-pass-2026!",
    displayName: "E2E Player Two",
    role: "player" as const,
    sport: "Soccer",
    skill: "Advanced",
    city: "Queens, NY",
  },
] as const;

export type TestAccountKey = (typeof TEST_ACCOUNTS)[number]["key"];

/** The account reserved for global-setup's injected session. */
export const SESSION_ACCOUNT_KEY = "session" satisfies TestAccountKey;

/**
 * Accounts that may be signed in (and out) through the real /auth form.
 * Excludes the session-injection account so real-form state changes stay off
 * the snapshot the injection specs share.
 */
export const REAL_FORM_ACCOUNTS = TEST_ACCOUNTS.filter((a) => a.key !== SESSION_ACCOUNT_KEY);

export function getTestAccount(key: TestAccountKey) {
  const acct = TEST_ACCOUNTS.find((a) => a.key === key);
  if (!acct) throw new Error(`Unknown test account: ${key}`);
  return acct;
}
