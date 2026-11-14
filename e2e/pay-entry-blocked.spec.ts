import { test, expect, type Page, type Route } from "@playwright/test";
import { restoreSession } from "./helpers/signed-in";
import { serverFnId, stubServerFn } from "./helpers/server-fn";
import {
  PAY_FIXTURE_HOST_ID,
  blockRealtime,
  payFixtureGameRow,
  serveFixtureGame,
} from "./helpers/pay-fixtures";

/**
 * E2E: the pay page offers no payment to a viewer who can never be given the place
 * (src/lib/pay-entry-gate.ts, payEntryView), and still offers it to one the server lets through.
 *
 * On a manual payment the money moves in Venmo or Cash App before the app writes anything, so what the pay page shows
 * is the only safeguard before money moves. Every read that decides it is answered here, so nothing depends on the
 * data where the spec runs:
 *   - the game row (serveFixtureGame), the host's settings and methods, the viewer's request, payments and place;
 *   - the account's child status (restoreSession answers it for the fixture adult; the approved-viewer test asks the
 *     real getMyChildStatus server function instead, so a regression there that would hold every payment fails here)
 *     and the guardian check (game_payment_guardian_ready, answered true: an adult);
 *   - the PayPal checkout config (a server function, answered with a config) and PayPal's SDK script (a stand-in that
 *     draws nothing), so a PayPal button would be drawn if the page offered one. "No PayPal" below therefore means the
 *     page held it back, not that PayPal was not set up.
 *
 * Auto-skips when no signed-in Supabase session is available.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const HOST_ID = PAY_FIXTURE_HOST_ID;
const ENTRY_FEE = 8;
const VENMO_HANDLE = "e2e-block-venmo";
const CASHTAG = "e2eblockcash";

function sessionUserId(): string {
  const s = JSON.parse(SESSION_JSON!);
  const id: string | undefined = s?.user?.id;
  expect(id, "session must contain user.id").toBeTruthy();
  return id!;
}

const isTable = (url: URL | string, table: string) => String(url).includes(`/rest/v1/${table}`);

async function fulfillJson(route: Route, body: unknown) {
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function mockPayScreen(
  page: Page,
  opts: {
    game: Record<string, unknown>;
    requiresApproval: boolean;
    request: string | null;
    /** When set, the viewer's join request is answered only once it resolves. */
    requestGate?: Promise<void>;
  },
) {
  const now = new Date().toISOString();
  await page.route(
    (u) => isTable(u, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await fulfillJson(route, [
        {
          id: "mock-settings-block",
          game_id: GAME_ID,
          host_id: HOST_ID,
          entry_fee: ENTRY_FEE,
          accepted_method_ids: ["mock-venmo", "mock-cashapp"],
          payment_deadline: null,
          refund_policy: null,
          payment_instructions: null,
          requires_approval: opts.requiresApproval,
          created_at: now,
          updated_at: now,
        },
      ]);
    },
  );
  const method = (over: Record<string, unknown>) => ({
    host_id: HOST_ID,
    payment_url: null,
    contact_info: null,
    instructions: null,
    is_enabled: true,
    created_at: now,
    updated_at: now,
    ...over,
  });
  await page.route(
    (u) =>
      isTable(u, "host_payment_methods") ||
      String(u).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    async (route) => {
      if (!["GET", "POST"].includes(route.request().method())) return route.fallback();
      await fulfillJson(route, [
        method({ id: "mock-venmo", payment_type: "venmo", label: "Venmo", username: VENMO_HANDLE }),
        method({
          id: "mock-cashapp",
          payment_type: "cashapp",
          label: "Cash App",
          username: CASHTAG,
        }),
      ]);
    },
  );
  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      if (opts.requestGate) await opts.requestGate;
      await fulfillJson(
        route,
        opts.request
          ? [
              {
                id: "mock-join-block",
                game_id: GAME_ID,
                host_id: HOST_ID,
                player_id: sessionUserId(),
                status: opts.request,
                message: null,
                reviewer_notes: null,
                created_at: now,
                updated_at: now,
                reviewed_at: opts.request === "approved" ? now : null,
                guardian_approved_at: null,
                guardian_approved_by: null,
                idempotency_key: `join:${GAME_ID}`,
              },
            ]
          : [],
      );
    },
  );
  for (const table of ["payment_submissions", "game_participants"]) {
    await page.route(
      (u) => isTable(u, table),
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        await fulfillJson(route, []);
      },
    );
  }
  // The guardian check, as the database answers it for an adult.
  await page.route(
    (u) => String(u).includes("/rest/v1/rpc/game_payment_guardian_ready"),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await fulfillJson(route, true);
    },
  );
  // PayPal set up for this game, with a stand-in SDK, so the PayPal section is drawn whenever the page offers it.
  await stubServerFn(page, "getPayPalCheckoutConfig", {
    clientId: "e2e-paypal-client",
    merchantId: "e2e-paypal-merchant",
  });
  await page.route(/^https:\/\/www\.paypal\.com\/sdk\/js/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.paypal = { Buttons: function () { return { render: function () { return Promise.resolve(); } }; } };",
    });
  });
  await serveFixtureGame(page, payFixtureGameRow(GAME_ID, opts.game));
  await blockRealtime(page);
}

/** Nothing on the page lets money move: no handle, no Venmo or Cash App link, no PayPal, no proof form. */
async function expectNoPaymentOffered(page: Page) {
  await expect(page.getByRole("button", { name: /^pay \$\d+ in venmo$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^pay \$\d+ in cash app$/i })).toHaveCount(0);
  await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
  await expect(page.getByText(CASHTAG)).toHaveCount(0);
  await expect(page.getByText(/paypal or card/i)).toHaveCount(0);
  await expect(page.locator('[aria-label="Pay with PayPal or card"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /i have paid/i })).toHaveCount(0);
}

test("a host-closed paid game: a new viewer gets the block card, not the host's handles or PayPal", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await mockPayScreen(page, {
    game: { joins_closed: true },
    requiresApproval: false,
    request: null,
  });

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("pay-entry-blocked");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveAttribute("data-block", "locked");
  await expect(card).toHaveAttribute("data-mode", "replace");
  await expect(card).toContainText(/you can't pay for this game/i);
  await expect(card).toContainText(/the host has closed joining for this game/i);
  await expect(card).toContainText(/don't send the host any money/i);
  await expect(card.getByRole("link", { name: /back to game/i })).toBeVisible();
  await expectNoPaymentOffered(page);

  await ctx.close();
});

test("a cancelled game: even a host-approved viewer gets the block card", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await mockPayScreen(page, {
    game: { status: "cancelled", cancelled_at: new Date(Date.now() - 3600_000).toISOString() },
    requiresApproval: true,
    request: "approved",
  });

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("pay-entry-blocked");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveAttribute("data-block", "locked");
  await expect(card).toContainText(/the host cancelled this game/i);
  // Approved, so not the approval card either.
  await expect(page.getByTestId("approval-required-gate")).toHaveCount(0);
  await expectNoPaymentOffered(page);

  await ctx.close();
});

test("a host-closed paid game: a host-approved viewer still gets the payment options, and is never told they can't pay while their request loads", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Hold the viewer's join request: until it lands the page cannot know the host approved them.
  let releaseRequest!: () => void;
  const requestGate = new Promise<void>((resolve) => (releaseRequest = resolve));
  await mockPayScreen(page, {
    game: { joins_closed: true },
    requiresApproval: true,
    request: "approved",
    requestGate,
  });
  // Record the block card if it is ever drawn, however briefly.
  await page.addInitScript(() => {
    const w = window as unknown as { __payBlockSeen?: boolean };
    w.__payBlockSeen = false;
    new MutationObserver(() => {
      if (document.querySelector('[data-testid="pay-entry-blocked"]')) w.__payBlockSeen = true;
    }).observe(document, { childList: true, subtree: true });
  });

  await restoreSession(page);
  // The real child-status check (restoreSession stubbed it): the pay page offers nothing until it answers.
  await page.route("**/_serverFn/**", async (route) => {
    if (!serverFnId(route.request().url()).includes("getMyChildStatus")) return route.fallback();
    await route.continue();
  });
  const childStatus = page.waitForResponse(
    (r) => r.url().includes("/_serverFn/") && serverFnId(r.url()).includes("getMyChildStatus"),
  );
  const guardianCheck = page.waitForResponse((r) =>
    r.url().includes("/rest/v1/rpc/game_payment_guardian_ready"),
  );
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  const childResponse = await childStatus;
  expect(childResponse.ok(), "the real getMyChildStatus answers for the fixture adult").toBe(true);
  expect(await childResponse.text()).toContain("adult");
  await guardianCheck;

  // Every other check has answered; only the request is out. The page waits, it does not say "you can't pay".
  await expect(page.getByText("Loading payment options…")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("pay-entry-blocked")).toHaveCount(0);
  await expectNoPaymentOffered(page);

  releaseRequest();
  // The server lets an approved player through a host-closed game (enforce_game_join_gate,
  // paypal_payment_precondition), so the page offers every method.
  await expect(page.getByRole("button", { name: `Pay $${ENTRY_FEE} in Venmo` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: `Pay $${ENTRY_FEE} in Cash App` })).toBeVisible();
  await expect(page.getByText(VENMO_HANDLE)).toBeVisible();
  await expect(page.getByText(/paypal or card/i)).toBeVisible();
  await expect(page.getByTestId("pay-entry-blocked")).toHaveCount(0);
  await expect(page.getByTestId("approval-required-gate")).toHaveCount(0);
  expect(
    await page.evaluate(() => (window as unknown as { __payBlockSeen?: boolean }).__payBlockSeen),
    "the block card was never drawn",
  ).toBe(false);

  await ctx.close();
});
