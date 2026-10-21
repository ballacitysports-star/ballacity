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

function mockRejectedSubmission(gameId: string) {
  return {
    ...mockPendingSubmission(gameId),
    id: `mock-rejected-${gameId}`,
    status: "rejected",
    reviewer_notes: "Could not match the transaction.",
    reviewed_at: new Date().toISOString(),
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

  await page.route(
    (url) => String(url).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  const submissions = options.submissions ?? [];
  await page.route((url) => tableUrl(url, "payment_submissions"), async (route) => {
    const method = route.request().method();
    if (method !== "GET" && method !== "HEAD") {
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
    if (route.request().method() !== "GET" && route.request().method() !== "HEAD") {
      options.writeAttempts?.push(`${new URL(route.request().url()).pathname.split("/rest/v1/")[1]?.split("?")[0] ?? "unknown"}:${route.request().method()}`);
      return route.fulfill({ status: 204, contentType: "application/json", body: "" });
    }
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
  const writeAttempts: string[] = [];

  await mockPaymentBackend(page, CUSTOM_GAME_ID, { writeAttempts });
  await restoreSession(page);

  await page.goto(`/games/${CUSTOM_GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("link", { name: /pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await expect(cta).toHaveAttribute("href", new RegExp(`/games/${CUSTOM_GAME_ID}/pay`));
  await cta.click();

  await assertPayScreenRendered(page, CUSTOM_GAME_ID);
  await expect(page.locator("h1").first()).toContainText(CUSTOM_GAME_TITLE_MATCH);
  expect(writeAttempts, "opening pay should not join/cancel/delete from the detail CTA").toEqual([]);

  await ctx.close();
});

test("Pay host still renders when optional status lookups hang", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const writeAttempts: string[] = [];

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
            id: `mock-settings-${CUSTOM_GAME_ID}`,
            game_id: CUSTOM_GAME_ID,
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
  await page.route(
    (url) => String(url).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );
  await page.route((url) => tableUrl(url, "payment_submissions"), async (route) => {
    if (route.request().method() !== "GET" && route.request().method() !== "HEAD") {
      writeAttempts.push(`payment_submissions:${route.request().method()}`);
      return route.fulfill({ status: 204, contentType: "application/json", body: "" });
    }
    await new Promise(() => {});
  });
  await page.route((url) => tableUrl(url, "join_requests"), async (route) => {
    if (route.request().method() !== "GET" && route.request().method() !== "HEAD") {
      writeAttempts.push(`join_requests:${route.request().method()}`);
      return route.fulfill({ status: 204, contentType: "application/json", body: "" });
    }
    await new Promise(() => {});
  });
  await page.route((url) => tableUrl(url, "game_participants"), async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route((url) => tableUrl(url, "host_payment_methods"), async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await restoreSession(page);
  await page.goto(`/games/${CUSTOM_GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("link", { name: /pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  await assertPayScreenRendered(page, CUSTOM_GAME_ID);
  await expect(
    page.getByText(/host hasn't set up payment yet/i).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/couldn't reach the payment service/i)).toHaveCount(0);
  expect(writeAttempts, "opening pay should remain read-only").toEqual([]);

  await ctx.close();
});

test("Pay screen exits payment-options loading when payment settings hang", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await page.route(
    (url) => tableUrl(url, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await new Promise(() => {});
    },
  );
  await page.route((url) => tableUrl(url, "payment_submissions"), async (route) => {
    if (route.request().method() !== "GET" && route.request().method() !== "HEAD") {
      return route.fulfill({ status: 204, contentType: "application/json", body: "" });
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route((url) => tableUrl(url, "join_requests"), async (route) => {
    if (route.request().method() !== "GET" && route.request().method() !== "HEAD") {
      return route.fulfill({ status: 204, contentType: "application/json", body: "" });
    }
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route((url) => tableUrl(url, "game_participants"), async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  await restoreSession(page);
  await page.goto(`/games/${CUSTOM_GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  await assertPayScreenRendered(page, CUSTOM_GAME_ID);
  await expect(page.getByText(/game fee/i)).toBeVisible();
  await expect(page.getByText(/loading payment options/i)).toBeVisible();
  await expect(page.getByText(/couldn't reach the payment service/i)).toBeVisible({
    timeout: 8_000,
  });
  await expect(page.getByText(/loading payment options/i)).toHaveCount(0);

  await ctx.close();
});

test("Pay host button remains a pay link when local joined state is stale", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const writeAttempts: string[] = [];

  await mockPaymentBackend(page, CUSTOM_GAME_ID, { writeAttempts });
  await restoreSession(page);
  await page.evaluate(
    (gameId) => window.localStorage.setItem("openrun.joinedGameIds.v1", JSON.stringify([gameId])),
    CUSTOM_GAME_ID,
  );

  await page.goto(`/games/${CUSTOM_GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("link", { name: /pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await expect(cta).toHaveAttribute("href", new RegExp(`/games/${CUSTOM_GAME_ID}/pay`));
  await cta.click();

  await assertPayScreenRendered(page, CUSTOM_GAME_ID);
  expect(writeAttempts, "stale joined state should not trigger leave/cancel/delete").toEqual([]);

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
  await expect(cta).toHaveAttribute("href", new RegExp(`/games/${CUSTOM_GAME_ID}/pay`));
  await cta.click();

  await assertPayScreenRendered(page, CUSTOM_GAME_ID);
  await expect(page.getByTestId("payment-status-timeline")).toHaveAttribute("data-status", "pending");
  expect(writeAttempts, "viewing a pending payment should not withdraw/delete it").toEqual([]);

  await ctx.close();
});

test("Payment rejected button routes back to the pay screen without deleting the attempt", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const writeAttempts: string[] = [];

  await mockPaymentBackend(page, CUSTOM_GAME_ID, {
    submissions: [mockRejectedSubmission(CUSTOM_GAME_ID)],
    writeAttempts,
  });
  await restoreSession(page);
  await page.evaluate(
    (gameId) => window.localStorage.setItem("openrun.joinedGameIds.v1", JSON.stringify([gameId])),
    CUSTOM_GAME_ID,
  );

  await page.goto(`/games/${CUSTOM_GAME_ID}`, { waitUntil: "domcontentloaded" });

  const cta = page.getByRole("link", { name: /payment rejected|pay again|pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await expect(cta).toHaveAttribute("href", new RegExp(`/games/${CUSTOM_GAME_ID}/pay`));
  await cta.click();

  await assertPayScreenRendered(page, CUSTOM_GAME_ID);
  await expect(page.getByTestId("payment-status-timeline")).toHaveAttribute("data-status", "rejected");
  expect(writeAttempts, "viewing a rejected payment should not withdraw/delete it").toEqual([]);

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
  await expect(cta).toHaveAttribute("href", new RegExp(`/games/${HOSTED_GAME_ID}/pay`));
  await cta.click();

  await assertPayScreenRendered(page, HOSTED_GAME_ID);
  await expect(page.locator("h1").first()).toContainText(HOSTED_GAME_TITLE);

  await ctx.close();
});
