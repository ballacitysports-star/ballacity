/**
 * Shared test account fixtures for multi-user E2E flows.
 *
 * These accounts are seeded via `seedTestAccounts` (admin-gated server fn).
 * Passwords are intentionally non-secret — they exist only on seeded
 * fixture accounts used for notification/messaging E2E tests.
 */
export const TEST_ACCOUNTS = [
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

export function getTestAccount(key: TestAccountKey) {
  const acct = TEST_ACCOUNTS.find((a) => a.key === key);
  if (!acct) throw new Error(`Unknown test account: ${key}`);
  return acct;
}
