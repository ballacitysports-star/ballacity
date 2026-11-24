/**
 * Signed-in setup for the pay and game-page specs that inject the fixture
 * player's session (LOVABLE_BROWSER_SUPABASE_*).
 *
 * Those specs mock the payment reads they assert on, but every page load also
 * made a chain of real requests to the shared sandbox before the screen under
 * test could render, none of which the specs are about:
 *
 *   - `GET /auth/v1/user`: the auth store verifies the stored session with it
 *     before publishing a user (on 2026-11-12 a page load sent 9 to 26 of them;
 *     since the game and pay pages read the user id from the stored session,
 *     a game page load sends about one);
 *   - the root gate's `getMyAgeStatus` and `getOnboardingStatus` (5s cap each),
 *     server functions that themselves call the sandbox. They now start while
 *     the session is being verified (src/lib/gate-prefetch.ts), but each still
 *     waits on the auth server;
 *   - `getMyChildStatus`, the account's age and consent policy. The pay page
 *     shows no payment option until it has answered (it fails closed for
 *     minors), so a slow answer would hold every pay spec's first screen.
 *
 * The sandbox slows down under the suite's own traffic. Measured locally on
 * 2026-11-12 (2 workers, these specs repeated): `/auth/v1/user` went from a
 * ~100ms median to 1-8s about three minutes in, the realtime handshake to 7s,
 * and the tests that failed were exactly the ones running then. One trace:
 * `/auth/v1/user` answered after 8079ms, the auth store gave up at 6s, and the
 * test hit its 10s timeout on "Loading your account…". CI shows the same
 * shape: a different pay test times out each run, while the test running beside
 * it on the other worker is also 2.7-5x slower than its median.
 *
 * So answer these from the session the spec already holds. The payment
 * and game reads each spec cares about still go where the spec sends them, and
 * the database still sees the real access token on every read that does reach it.
 */
import type { Page } from "@playwright/test";
import { onboardingStatusFor, stubServerFn } from "./server-fn";
import { DEFAULT_AGE_POLICY } from "../../src/lib/child-policy";

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

/** What `getMyAgeStatus` answers for the fixture player, an adult with a birthday on file. */
const ADULT_AGE_STATUS = {
  cohort: "adult",
  ageCategory: "adult",
  reviewRequired: false,
  status: "active",
  birthdaySet: true,
};

/**
 * What `getMyChildStatus` answers for the same adult: no parental consent record, no guardian controls. A spec that
 * walks a minor's flow stubs it again after this (the newest route handler answers first).
 */
export const ADULT_CHILD_STATUS = {
  cohort: "adult",
  ageReviewRequired: false,
  jurisdiction: "US_FEDERAL",
  consent: null,
  controls: null,
  policy: DEFAULT_AGE_POLICY,
  hasBirthday: true,
};

const answered = new WeakSet<Page>();

/**
 * Answer the session checks above from the injected session. Call before the first navigation.
 *
 * Used by every spec that injects the fixture player's session to test a mocked screen (the pay,
 * invite, join-request and leave specs). It registers its handlers once per page, so a spec that
 * re-seeds the same page does not stack them. Specs about sign-in itself (oauth-*, onboarding-*,
 * social-login-*, child-lifecycle-*, *-refresh-protected) keep the real checks.
 */
export async function answerSessionChecks(page: Page) {
  await answerSessionChecksFor(page, (JSON.parse(SESSION_JSON!) as { user?: unknown }).user);
}

/**
 * The same, for a session the spec signed in itself (helpers/fixture-session.ts, for the specs that drive two fixture
 * accounts at once): `/auth/v1/user` answers with that session's user, and the three gate checks answer as for an adult
 * member who has finished onboarding.
 */
export async function answerSessionChecksFor(page: Page, user: unknown) {
  if (answered.has(page)) return;
  answered.add(page);
  await page.route(/\/auth\/v1\/user(?:\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(user),
    });
  });
  await stubServerFn(page, "getMyAgeStatus", ADULT_AGE_STATUS);
  await stubServerFn(page, "getOnboardingStatus", onboardingStatusFor("player", "email"));
  await stubServerFn(page, "getMyChildStatus", ADULT_CHILD_STATUS);
}

/** Answer the session checks, then put the fixture session where the app reads it. */
export async function restoreSession(page: Page) {
  await answerSessionChecks(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}
