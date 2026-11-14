import { test, expect, type Page } from "@playwright/test";
import { restoreSession } from "./helpers/signed-in";
import { PAY_FIXTURE_HOST_ID, payFixtureGameRow, serveFixtureGame } from "./helpers/pay-fixtures";

/**
 * E2E: tapping the paid CTA on a game detail page must, within a bounded
 * time, either reach the pay screen's success/ready state (loading gone,
 * no "Game not found") OR surface the retry/error affordance
 * ("Couldn't reach the payment service" + Retry button).
 *
 * Covers both branches:
 *   1. Happy path — backend responds fast, pay screen renders ready.
 *   2. Backend hang — game_payment_settings never resolves on the pay screen;
 *      within the client's timeout the retry UI appears.
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
const FAKE_HOST_ID = PAY_FIXTURE_HOST_ID;
const ENTRY_FEE = 10;
// The pay screen gives up on its reads after 6s (withTimeout in
// src/routes/games.$gameId.pay.tsx, and PAYPAL_CONFIG_DEADLINE_MS for the PayPal
// config); give it a comfortable margin.
const OUTCOME_TIMEOUT_MS = 15_000;

function tableUrl(url: string | URL, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
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
  // The pay screen reads the host's methods through this RPC, not the table
  // above. Unanswered, it asked the real database for the real g2 host's
  // methods: what the "ready" screen showed, and how fast, depended on that.
  await page.route(
    (url) => String(url).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );
  // The game: served, hosted by the same mocked host as the settings above,
  // rather than read from whatever g2 row the target database holds.
  await serveFixtureGame(page, payFixtureGameRow(GAME_ID));
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

/**
 * Hang the game_payment_settings GET indefinitely, once `hang()` is called, to
 * force the pay screen's client timeout. The game page reads the same row to
 * decide its button (approval, fee), and with no answer it rightly falls back to
 * "Request Spot", so the settings answer there and hang only on the pay screen.
 */
async function mockPaidSettingsHangOnPay(page: Page) {
  let hanging = false;
  await mockPaidSettingsOk(page);
  await page.route(
    (url) => tableUrl(url, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET" || !hanging) return route.fallback();
      // Never fulfill — Playwright releases pending routes on context close.
      await new Promise(() => {});
    },
  );
  return {
    hang: () => {
      hanging = true;
    },
  };
}

/**
 * Wait for the pay screen to settle, then say whether it settled READY (no
 * "Loading payment options…", no Retry) or on the RETRY/error state.
 *
 * It used to race two waiters: "loading text hidden" (=> ready) against "Retry
 * visible" (=> retry). But the Retry state replaces the loading box in a single
 * render, so on a hang BOTH waiters are satisfied by the same DOM change, and
 * which promise settled first was down to polling order. Locally "retry" usually
 * won; in CI the same hang came back "ready" (run 43519522840: Expected "retry",
 * Received "ready"). So wait for the one thing both outcomes share, the loading
 * box being gone, and only then look at which state the screen is in.
 */
async function waitForPayOutcome(page: Page): Promise<"ready" | "retry"> {
  // First the pay screen itself (its fee card renders with the payment options
  // section). Until then "Loading payment options…" is not in the page at all,
  // so the wait below would count a screen that has not rendered yet as settled.
  await expect(page.getByText("Entry fee", { exact: true })).toBeVisible({
    timeout: OUTCOME_TIMEOUT_MS,
  });
  await expect(page.getByText(/loading payment options/i)).toHaveCount(0, {
    timeout: OUTCOME_TIMEOUT_MS,
  });
  const retryShown = await page.getByRole("button", { name: /^retry$/i }).count();
  return retryShown > 0 ? "retry" : "ready";
}

test("Pay CTA reaches the ready pay screen when the backend responds", async ({ browser }) => {
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
  // "Ready" above only means no loading box and no Retry, which an error screen
  // would satisfy too. So also see the ready screen itself: the host's methods
  // come back empty, so it says the host has none (or, if the target has PayPal
  // set up for checkout, offers it above "Or pay another way").
  await expect(
    page.getByText(
      /^(host hasn't set up payment yet|or pay another way|how do you want to pay\?)$/i,
    ),
  ).toBeVisible();

  await ctx.close();
});

test("Pay CTA surfaces retry affordance when the payment service hangs", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const settings = await mockPaidSettingsHangOnPay(page);
  await mockEmptyLists(page);
  await restoreSession(page);

  await page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("link", { name: /pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  settings.hang();
  await cta.click();

  await page.waitForURL((u) => u.pathname === `/games/${GAME_ID}/pay`, {
    timeout: 10_000,
  });

  const outcome = await waitForPayOutcome(page);
  expect(outcome).toBe("retry");
  await expect(page.getByText(/couldn't reach the payment service/i).first()).toBeVisible();
  await expect(page.getByRole("button", { name: /^retry$/i }).first()).toBeVisible();

  await ctx.close();
});
