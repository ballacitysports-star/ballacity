import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E: tapping the "Pay host" button on the game detail page must
 * navigate to /games/:gameId/pay and successfully render the payment
 * screen (game title as heading, no "Game not found") for BOTH:
 *
 *   1. a "custom" sample game (from src/lib/sample-data.ts)
 *   2. a "hosted" game (record loaded via hosted_games REST)
 *
 * Auto-skips when no signed-in Supabase session is available in env.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const FAKE_HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// g2 is a paid sample game (price 8) shipped in src/lib/sample-data.ts.
const CUSTOM_GAME_ID = "g2";
const CUSTOM_GAME_TITLE_MATCH = /./; // just require a non-empty h1

const HOSTED_GAME_ID = "e2e-hosted-pay-0001";
const HOSTED_GAME_TITLE = "E2E Hosted Paid Game";

function tableUrl(url: URL | string, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
}

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

/**
 * Common mocks that let the pay page render without any real data:
 * paid, no-approval settings; configurable submissions; no join requests;
 * empty payment methods list.
 */
function mockPendingSubmission(gameId: string) {
  return {
    id: `mock-pending-${gameId}`,
    player_id: "mock-player",
    game_id: gameId,
    host_id: FAKE_HOST_ID,
    payment_method_id: null,
    payment_type: "venmo",
    screenshot_path: null,
    transaction_reference: null,
    paid_amount: 10,
    paid_at: new Date().toISOString(),
    notes: null,
    status: "pending",
    reviewer_notes: null,
    submitted_at: new Date().toISOString(),
    reviewed_at: null,
  };
}

async function mockPaymentBackend(
  page: Page,
  gameId: string,
  options: { submissions?: unknown[]; writeAttempts?: string[] } = {},
) {
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
            id: `mock-settings-${gameId}`,
            game_id: gameId,
            host_id: FAKE_HOST_ID,
            entry_fee: 10,
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

  const submissions = options.submissions ?? [];
  await page.route((url) => tableUrl(url, "payment_submissions"), async (route) => {
    const method = route.request().method();
    if (method !== "GET") {
      options.writeAttempts?.push(`payment_submissions:${method}`);
      return route.fulfill({ status: 204, contentType: "application/json", body: "" });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": `0-${Math.max(0, submissions.length - 1)}/${submissions.length}` },
      body: JSON.stringify(submissions),
    });
  });

  const emptyList = async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  };
  await page.route((url) => tableUrl(url, "join_requests"), emptyList);
  await page.route((url) => tableUrl(url, "host_payment_methods"), emptyList);
  await page.route((url) => tableUrl(url, "game_participants"), emptyList);
}

async function assertPayScreenRendered(page: Page, gameId: string) {
  await page.waitForURL(
    (u) => u.pathname === `/games/${gameId}/pay`,
    { timeout: 10_000 },
  );
  // Must NOT show the not-found fallback.
  await expect(page.getByText(/game not found/i)).toHaveCount(0);
  // Title heading is rendered on the pay screen.
  await expect(page.locator("h1").first()).toBeVisible({ timeout: 10_000 });
}

test("Pay host button on a custom (sample) game routes to the pay screen", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await mockPaymentBackend(page, CUSTOM_GAME_ID);
  await restoreSession(page);

  await page.goto(`/games/${CUSTOM_GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("link", { name: /pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  await assertPayScreenRendered(page, CUSTOM_GAME_ID);
  await expect(page.locator("h1").first()).toContainText(CUSTOM_GAME_TITLE_MATCH);

  await ctx.close();
});

test("Payment status button with a pending submission still routes to the pay screen", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const writeAttempts: string[] = [];

  await mockPaymentBackend(page, CUSTOM_GAME_ID, {
    submissions: [mockPendingSubmission(CUSTOM_GAME_ID)],
    writeAttempts,
  });
  await restoreSession(page);
  await page.evaluate(
    (gameId) => window.localStorage.setItem("openrun.joinedGameIds.v1", JSON.stringify([gameId])),
    CUSTOM_GAME_ID,
  );

  await page.goto(`/games/${CUSTOM_GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("link", { name: /payment pending|pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  await assertPayScreenRendered(page, CUSTOM_GAME_ID);
  await expect(page.getByTestId("payment-status-timeline")).toHaveAttribute("data-status", "pending");
  expect(writeAttempts, "viewing a pending payment should not withdraw/delete it").toEqual([]);

  await ctx.close();
});

test("Pay host button on a hosted game routes to the pay screen", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Serve the hosted game record for both list (useHostedGames) and single
  // (fetchHostedGame) reads against /rest/v1/hosted_games.
  const now = new Date().toISOString();
  const hostedRow = {
    id: HOSTED_GAME_ID,
    sport: "Basketball",
    title: HOSTED_GAME_TITLE,
    host_snapshot: {
      name: "E2E Host",
      username: "e2ehost",
      avatar: "",
      rating: 5,
    },
    host_id: FAKE_HOST_ID,
    date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    duration: "60 min",
    location: "E2E Court",
    neighborhood: "Testville",
    distance_mi: 1,
    lat: 40.7,
    lng: -74,
    max_players: 10,
    joined: 1,
    skill: "All Levels",
    price: 10,
    indoor: false,
    is_private: false,
    urgent: false,
    trending: false,
    image: "",
    description: "hosted paid game for e2e",
    equipment: [],
    status: "scheduled",
    joins_closed: false,
    positions_needed: {},
    created_at: now,
    updated_at: now,
  };

  await page.route(
    (url) => tableUrl(url, "hosted_games"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify([hostedRow]),
      });
    },
  );

  await mockPaymentBackend(page, HOSTED_GAME_ID);
  await restoreSession(page);

  await page.goto(`/games/${HOSTED_GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("link", { name: /pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  await assertPayScreenRendered(page, HOSTED_GAME_ID);
  await expect(page.locator("h1").first()).toContainText(HOSTED_GAME_TITLE);

  await ctx.close();
});
