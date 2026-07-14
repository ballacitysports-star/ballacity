import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: opening an invite deeplink directly (as if tapped from email/SMS)
 * must (a) land on /games/$gameId with invite=1 + from=<hostId> preserved,
 * (b) render the game detail page for the correct game, and
 * (c) allow tapping the paid CTA to reach /games/$gameId/pay with both
 *     invite params still preserved in the URL.
 *
 * Mirrors the notification-tap flow in invite-pay-and-join.spec.ts but
 * exercises the raw deeplink entry point.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const FAKE_HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const ENTRY_FEE = 15;

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

function tableUrl(url: string | URL, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
}

test("opening an invite deeplink lands on the game and the pay CTA routes to checkout", async ({
  browser,
}) => {
  const deeplink = `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Paid, no-approval settings owned by FAKE_HOST_ID.
  await page.route(
    (url) => tableUrl(url, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const settings = [
        {
          id: "mock-settings-id",
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
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify(settings),
      });
    },
  );
  await page.route(
    (url) => tableUrl(url, "payment_submissions"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );
  await page.route(
    (url) => tableUrl(url, "join_requests"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );
  await page.route(
    (url) => tableUrl(url, "payment_methods"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  await restoreSession(page);

  // Open the invite deeplink directly.
  await page.goto(deeplink, { waitUntil: "domcontentloaded" });

  // URL preserves both invite params on landing.
  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${GAME_ID}` &&
      u.searchParams.get("invite") === "1" &&
      u.searchParams.get("from") === FAKE_HOST_ID,
    { timeout: 10_000 },
  );

  // Correct game detail screen rendered with invite banner.
  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(/Pay & join/i);

  // Paid CTA — variant shows "Pay host · $X".
  const cta = page.getByRole("button", { name: /pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  // Should route to the checkout page with BOTH invite params preserved.
  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${GAME_ID}/pay` &&
      u.searchParams.get("invite") === "1" &&
      u.searchParams.get("from") === FAKE_HOST_ID,
    { timeout: 10_000 },
  );

  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).toBe(`/games/${GAME_ID}/pay`);
  expect(finalUrl.searchParams.get("invite")).toBe("1");
  expect(finalUrl.searchParams.get("from")).toBe(FAKE_HOST_ID);

  await ctx.close();
});
