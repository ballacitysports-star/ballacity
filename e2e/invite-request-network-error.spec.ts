import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: if the first "Request to join" POST fails with a network error,
 * a second tap fired while that first request is still in flight must
 * still be blocked (no duplicate POST). After the error surfaces, the
 * user can retry and the second attempt succeeds.
 *
 * Auto-skips without a restored Supabase session.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const FAKE_HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const FUTURE_MS = Date.now() + 24 * 60 * 60 * 1000;
const INVITE_URL = `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}&exp=${FUTURE_MS}`;
const FIRST_POST_DELAY_MS = 1_200;

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

function sessionUserId(): string {
  const s = JSON.parse(SESSION_JSON!);
  const id: string | undefined = s?.user?.id;
  expect(id, "session must contain user.id").toBeTruthy();
  return id!;
}

const isTable = (url: string, table: string) => String(url).includes(`/rest/v1/${table}`);

test("network error on first Request-to-join blocks a mid-flight second tap, then allows a successful retry", async ({
  browser,
}) => {
  const userId = sessionUserId();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.route(
    (u) => isTable(u, "game_payment_settings"),
    async (route: PWRoute) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "mock-settings-id",
            game_id: GAME_ID,
            host_id: FAKE_HOST_ID,
            entry_fee: 0,
            accepted_method_ids: [],
            payment_deadline: null,
            refund_policy: null,
            payment_instructions: null,
            requires_approval: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    },
  );

  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route: PWRoute) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  let postAttempt = 0;
  let firstPostStartedAt = 0;
  let firstPostSettledAt = 0;
  const joinPosts: Array<{ attempt: number; at: number }> = [];
  let retrySucceeded = false;

  const pendingRow = () => ({
    id: "mock-join-id",
    game_id: GAME_ID,
    host_id: FAKE_HOST_ID,
    player_id: userId,
    status: "pending",
    message: null,
    reviewer_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: PWRoute) => {
      const req = route.request();
      const method = req.method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(retrySucceeded ? [pendingRow()] : []),
        });
        return;
      }
      if (method === "POST") {
        postAttempt += 1;
        const attempt = postAttempt;
        joinPosts.push({ attempt, at: Date.now() });
        if (attempt === 1) {
          firstPostStartedAt = Date.now();
          // Hold the first request open so the second tap fires while it's in flight,
          // then fail it with a network-style error.
          await new Promise((r) => setTimeout(r, FIRST_POST_DELAY_MS));
          firstPostSettledAt = Date.now();
          await route.abort("failed");
          return;
        }
        // Retry succeeds.
        retrySucceeded = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { "content-range": "0-0/1" },
          body: JSON.stringify([pendingRow()]),
        });
        return;
      }
      return route.fallback();
    },
  );

  await restoreSession(page);
  await page.goto(INVITE_URL, { waitUntil: "domcontentloaded" });

  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });

  const cta = page.getByRole("button", { name: /request to join/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });

  // First tap — starts the doomed POST.
  await cta.click({ force: true });

  // Wait for the first POST to actually leave the client.
  await expect
    .poll(() => joinPosts.length, { timeout: 5_000, message: "first POST never fired" })
    .toBeGreaterThanOrEqual(1);
  expect(firstPostStartedAt).toBeGreaterThan(0);
  expect(firstPostSettledAt, "first POST settled before we could double-tap").toBe(0);

  // Second tap while still in flight — must be swallowed.
  await cta.click({ force: true, noWaitAfter: true }).catch(() => {
    /* button may be disabled */
  });
  await cta.click({ force: true, noWaitAfter: true }).catch(() => {
    /* ignore */
  });

  // Wait for the first POST to fail.
  await expect
    .poll(() => firstPostSettledAt, { timeout: FIRST_POST_DELAY_MS + 5_000 })
    .toBeGreaterThan(0);

  // Only one POST should have been sent so far.
  expect(
    joinPosts.length,
    `expected exactly 1 POST during in-flight window, saw ${joinPosts.length}`,
  ).toBe(1);

  // Error surfaces via a toast + the CTA returns to "Request to join" (not pending).
  await expect(page.getByText(/could not send request|failed|network/i).first()).toBeVisible({
    timeout: 5_000,
  });

  const retryCta = page.getByRole("button", { name: /request to join/i }).first();
  await expect(retryCta).toBeVisible({ timeout: 5_000 });
  await expect(retryCta).toBeEnabled();
  // Pending UI must NOT be showing yet.
  await expect(page.getByText(/request pending · tap to cancel/i)).toHaveCount(0);

  // Retry — succeeds this time.
  await retryCta.click({ force: true });

  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: /^request to join/i })).toHaveCount(0);

  // Exactly two POSTs total: one failed, one successful retry.
  await page.waitForTimeout(500);
  expect(
    joinPosts.length,
    `expected exactly 2 join_requests POSTs (1 failed + 1 retry), saw ${joinPosts.length}`,
  ).toBe(2);

  await ctx.close();
});
