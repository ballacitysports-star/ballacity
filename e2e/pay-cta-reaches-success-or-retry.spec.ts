import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: tapping the paid CTA on a game detail page must, within a bounded
 * time, either reach the pay screen's success/ready state (h1 title
 * rendered, no "Game not found") OR surface the retry/error affordance
 * ("Couldn't reach the payment service" + Retry button).
 *
 * Covers both branches:
 *   1. Happy path — backend responds fast, pay screen renders ready.
 *   2. Backend hang — game_payment_settings never resolves; within the
 *      client's 8s timeout the retry UI appears.
 *
 * Auto-skips when no signed-in Supabase session is available in env.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const FAKE_HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ENTRY_FEE = 10;
// Client-side pay-page timeout is 8s; give it a comfortable margin.
const OUTCOME_TIMEOUT_MS = 15_000;

function tableUrl(url: string | URL, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
}

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

async function mockEmptyLists(page: Page) {
  const empty = async (route: import("@playwright/test").Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  };
  await page.route((url) => tableUrl(url, "payment_submissions"), empty);
  await page.route((url) => tableUrl(url, "join_requests"), empty);
  await page.route((url) => tableUrl(url, "host_payment_methods"), empty);
  await page.route((url) => tableUrl(url, "payment_methods"), empty);
  await page.route((url) => tableUrl(url, "game_participants"), empty);
}

async function mockPaidSettingsOk(page: Page) {
  await page.route(
    (url) => tableUrl(url, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify([
          {
            id: "mock-settings-ok",
            game_id: GAME_ID,
            host_id: FAKE_HOST_ID,
            entry_fee: ENTRY_FEE,
            accepted_method_ids: [],
            payment_deadline: null,
            refund_policy: null,
            payment_instructions: null,
            requires_approval: false,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    },
  );
}

/** Hang the game_payment_settings GET indefinitely to force the client timeout. */
async function mockPaidSettingsHang(page: Page) {
  await page.route(
    (url) => tableUrl(url, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      // Never fulfill — Playwright releases pending routes on context close.
      await new Promise(() => {});
    },
  );
}

/**
 * Wait for the pay screen to resolve to EITHER the ready state (h1 visible,
 * no "Game not found") OR the retry/error state (Retry button visible).
 * Returns which outcome occurred so the caller can assert on it.
 */
async function waitForPayOutcome(page: Page): Promise<"ready" | "retry"> {
  const ready = page
    .locator("h1")
    .first()
    .waitFor({ state: "visible", timeout: OUTCOME_TIMEOUT_MS })
    .then(() => "ready" as const);
  const retry = page
    .getByRole("button", { name: /^retry$/i })
    .first()
    .waitFor({ state: "visible", timeout: OUTCOME_TIMEOUT_MS })
    .then(() => "retry" as const);
  return await Promise.race([ready, retry]);
}

test("Pay CTA reaches the ready pay screen when the backend responds", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await mockPaidSettingsOk(page);
  await mockEmptyLists(page);
  await restoreSession(page);

  await page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("link", { name: /pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  await page.waitForURL((u) => u.pathname === `/games/${GAME_ID}/pay`, {
    timeout: 10_000,
  });

  const outcome = await waitForPayOutcome(page);
  expect(outcome).toBe("ready");
  await expect(page.getByText(/game not found/i)).toHaveCount(0);
  await expect(page.getByText(/loading… \(/i)).toHaveCount(0);

  await ctx.close();
});

test("Pay CTA surfaces retry affordance when the payment service hangs", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await mockPaidSettingsHang(page);
  await mockEmptyLists(page);
  await restoreSession(page);

  await page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("link", { name: /pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  await page.waitForURL((u) => u.pathname === `/games/${GAME_ID}/pay`, {
    timeout: 10_000,
  });

  const outcome = await waitForPayOutcome(page);
  expect(outcome).toBe("retry");
  await expect(
    page.getByText(/couldn't reach the payment service/i).first(),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^retry$/i }).first()).toBeVisible();

  await ctx.close();
});
