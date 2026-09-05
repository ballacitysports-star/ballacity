import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: after a network-error retry on "Request to join" succeeds, reloading
 * the page must keep the pending UI and preserve the original invite params
 * (`invite`, `from`, `exp`) in the URL. No additional POSTs should fire on
 * reload — the pending row is fetched via GET.
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

test("pending UI + invite params survive a reload after network-error retry", async ({
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
  const joinPosts: Array<{ attempt: number; at: number }> = [];
  const joinGets: Array<{ at: number }> = [];
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
        joinGets.push({ at: Date.now() });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(retrySucceeded ? [pendingRow()] : []),
        });
        return;
      }
      if (method === "POST") {
        postAttempt += 1;
        joinPosts.push({ attempt: postAttempt, at: Date.now() });
        if (postAttempt === 1) {
          await route.abort("failed");
          return;
        }
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

  // First tap — network error.
  await cta.click({ force: true });
  await expect
    .poll(() => joinPosts.length, { timeout: 10_000, message: "first POST never fired" })
    .toBeGreaterThanOrEqual(1);

  await expect(page.getByText(/could not send request|failed|network/i).first()).toBeVisible({
    timeout: 5_000,
  });

  const retryCta = page.getByRole("button", { name: /request to join/i }).first();
  await expect(retryCta).toBeEnabled();

  // Retry — succeeds.
  await retryCta.click({ force: true });
  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: /^request to join/i })).toHaveCount(0);

  // Sanity: exactly 2 POSTs so far.
  await page.waitForTimeout(300);
  expect(joinPosts.length, `expected 2 POSTs pre-reload, saw ${joinPosts.length}`).toBe(2);

  const postsBeforeReload = joinPosts.length;

  // Reload — pending UI must be restored from server state, no new POSTs.
  await page.reload({ waitUntil: "domcontentloaded" });

  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /you're invited to this game/i })
      .first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: /^request to join/i })).toHaveCount(0);
  await expect(page.getByText(/waiting for host approval/i).first()).toBeVisible({
    timeout: 5_000,
  });

  // Give any stray POSTs a chance to fire, then confirm none did.
  await page.waitForTimeout(500);
  expect(
    joinPosts.length,
    `no new POSTs should fire on reload, saw ${joinPosts.length - postsBeforeReload} new`,
  ).toBe(postsBeforeReload);

  // Reload should have re-fetched pending state via GET at least once.
  expect(joinGets.length).toBeGreaterThanOrEqual(2);

  // Invite params preserved after reload.
  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).toBe(`/games/${GAME_ID}`);
  expect(finalUrl.searchParams.get("invite")).toBe("1");
  expect(finalUrl.searchParams.get("from")).toBe(FAKE_HOST_ID);
  expect(finalUrl.searchParams.get("exp")).toBe(String(FUTURE_MS));

  await ctx.close();
});
