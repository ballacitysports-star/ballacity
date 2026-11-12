/**
 * Signed-in setup for the pay and game-page specs that inject the fixture
 * player's session (LOVABLE_BROWSER_SUPABASE_*).
 *
 * Those specs mock the payment reads they assert on, but every page load also
 * made a chain of real requests to the shared sandbox before the screen under
 * test could render, none of which the specs are about:
 *
 *   - `GET /auth/v1/user`: the auth store verifies the stored session with it
 *     before publishing a user, and a page load sends 9 to 26 of them;
 *   - the root gate's `getMyAgeStatus`, then `getOnboardingStatus` (5s cap each),
 *     server functions that themselves call the sandbox.
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
 * So answer these three from the session the spec already holds. The payment
 * and game reads each spec cares about still go where the spec sends them, and
 * the database still sees the real access token on every read that does reach it.
 */
import type { Page } from "@playwright/test";
import { onboardingStatusFor, stubServerFn } from "./server-fn";

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

/** Answer the session checks above from the injected session. Call before the first navigation. */
export async function answerSessionChecks(page: Page) {
  const user = (JSON.parse(SESSION_JSON!) as { user?: unknown }).user;
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
