/**
 * Shared test account fixtures for multi-user E2E flows.
 *
 * These accounts are seeded via `seedTestAccounts` (admin-gated server fn).
 * Passwords are intentionally non-secret — they exist only on seeded
 * fixture accounts used for notification/messaging E2E tests.
 *
 * One account is reserved: `session` backs the single session snapshot
 * `e2e/global-setup.ts` mints and exports as LOVABLE_BROWSER_SUPABASE_*, which
 * ~40 specs inject instead of signing in. Nothing may sign that account in or
 * out through the real form. `supabase.auth.signOut()` defaults to global
 * scope, so one sign-out revokes every refresh token for that user — when the
 * fixture-* specs did that to `player` (which used to back the snapshot), every
 * injection spec ordered after them got 403s and bounced to /auth. Loop
 * REAL_FORM_ACCOUNTS, never TEST_ACCOUNTS, when signing in for real.
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
 * Excludes the session-injection account, whose refresh token a global-scope
 * sign-out anywhere would revoke for the rest of the run.
 */
export const REAL_FORM_ACCOUNTS = TEST_ACCOUNTS.filter((a) => a.key !== SESSION_ACCOUNT_KEY);

export function getTestAccount(key: TestAccountKey) {
  const acct = TEST_ACCOUNTS.find((a) => a.key === key);
  if (!acct) throw new Error(`Unknown test account: ${key}`);
  return acct;
}
