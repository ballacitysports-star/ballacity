import { test, expect, type Page, type Route } from "@playwright/test";
import { restoreSession } from "./helpers/signed-in";
import { stubServerFn } from "./helpers/server-fn";
import { stubRiskAcknowledged } from "./helpers/risk-ack";
import {
  PAY_FIXTURE_HOST_ID,
  blockRealtime,
  payFixtureGameRow,
  serveFixtureGame,
} from "./helpers/pay-fixtures";

/**
 * E2E: the pay page does not offer a manual payment (Venmo, Cash App, other) that the database will refuse on the
 * guardian rule (docs/paid-path-gates.md section 6 (d), owner decision 2026-11-18; payManualMethodsStep in
 * src/lib/pay-entry-gate.ts).
 *
 * The viewer here is an adult whose guardian link from before 18 was never ended: game_payment_guardian_ready (the
 * PayPal-side check, with its adult exemption) answers true, game_manual_claim_guardian_ready (the manual-claim
 * trigger's own rule, no exemption) answers false. PayPal takes their payment; the trigger would refuse their Venmo
 * proof. Every read that decides the page is answered here (the game, the host's settings and methods, the viewer's
 * request, payments and place, both guardian checks, the "Before you join" acknowledgment, the PayPal config and a
 * stand-in PayPal SDK), so nothing depends on the data where the spec runs.
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
const VENMO_HANDLE = "e2e-hold-venmo";
const CASHTAG = "e2eholdcash";
const MANUAL_RPC = "/rest/v1/rpc/game_manual_claim_guardian_ready";

const isTable = (url: URL | string, table: string) => String(url).includes(`/rest/v1/${table}`);

async function fulfillJson(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

/** 'pending': the request is held and never answered (the check stays loading). */
type ManualAnswer = boolean | "error" | "pending";

async function mockPayScreen(
  page: Page,
  opts: {
    /** game_manual_claim_guardian_ready's answers, in order; the last one repeats. */
    manual: ManualAnswer[];
    paypal: boolean;
  },
) {
  const now = new Date().toISOString();
  await page.route(
    (u) => isTable(u, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await fulfillJson(route, [
        {
          id: "mock-settings-hold",
          game_id: GAME_ID,
          host_id: HOST_ID,
          entry_fee: ENTRY_FEE,
          accepted_method_ids: ["mock-venmo", "mock-cashapp"],
          payment_deadline: null,
          refund_policy: null,
          payment_instructions: null,
          requires_approval: false,
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
  for (const table of ["join_requests", "payment_submissions", "game_participants"]) {
    await page.route(
      (u) => isTable(u, table),
      async (route) => {
        if (route.request().method() !== "GET") return route.fallback();
        await fulfillJson(route, []);
      },
    );
  }
  // The PayPal-side guardian check, as the database answers it for an adult (its adult exemption).
  await page.route(
    (u) => String(u).includes("/rest/v1/rpc/game_payment_guardian_ready"),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      await fulfillJson(route, true);
    },
  );
  // The manual-claim check (the trigger's own rule).
  const answers = [...opts.manual];
  await page.route(
    (u) => String(u).includes(MANUAL_RPC),
    async (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      const answer = answers.length > 1 ? answers.shift()! : answers[0];
      if (answer === "pending") return; // never fulfilled: the page stays on "checking"
      if (answer === "error") {
        await fulfillJson(route, { message: "e2e: manual-claim check failed" }, 500);
        return;
      }
      await fulfillJson(route, answer);
    },
  );
  await stubServerFn(
    page,
    "getPayPalCheckoutConfig",
    opts.paypal
      ? { clientId: "e2e-paypal-client", merchantId: "e2e-paypal-merchant" }
      : { clientId: null, merchantId: null },
  );
  await page.route(/^https:\/\/www\.paypal\.com\/sdk\/js/, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "window.paypal = { Buttons: function () { return { render: function () { return Promise.resolve(); } }; } };",
    });
  });
  await stubRiskAcknowledged(page);
  await serveFixtureGame(page, payFixtureGameRow(GAME_ID, {}));
  await blockRealtime(page);
}

/** No manual method on the page: no handle, no Venmo or Cash App link, no proof form. */
async function expectNoManualMethod(page: Page) {
  await expect(page.getByRole("button", { name: /^pay \$\d+ in venmo$/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^pay \$\d+ in cash app$/i })).toHaveCount(0);
  await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
  await expect(page.getByText(CASHTAG)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /i have paid/i })).toHaveCount(0);
}

test("an adult with a guardian link from before 18: PayPal kept, Venmo and Cash App held back", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await mockPayScreen(page, { manual: [false], paypal: true });

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  const hold = page.getByTestId("pay-manual-guardian-hold");
  await expect(hold).toBeVisible({ timeout: 15_000 });
  await expect(hold).toContainText(/manual payments need a guardian's approval/i);
  await expect(hold).toContainText(/a guardian link from before you turned 18 is still active/i);
  await expect(hold).toContainText(/you can pay with paypal now/i);
  await expect(hold).toContainText(/parent center/i);
  await expect(hold).not.toContainText(/ask your parent/i);
  await expect(hold).not.toContainText(/refund/i);
  await expect(hold.getByRole("link", { name: /back to game/i })).toBeVisible();
  // PayPal is still offered: the server's PayPal precondition lets this viewer pay.
  await expect(page.getByText(/paypal or card/i)).toBeVisible();
  await expect(page.locator('[aria-label="Pay with PayPal or card"]')).toHaveCount(1);
  await expectNoManualMethod(page);
  await expect(page.getByTestId("pay-entry-blocked")).toHaveCount(0);

  await ctx.close();
});

test("the same viewer with no PayPal for the game: the block card, not an empty method list", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await mockPayScreen(page, { manual: [false], paypal: false });

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  const card = page.getByTestId("pay-entry-blocked");
  await expect(card).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveAttribute("data-block", "manual_guardian");
  await expect(card).toContainText(/a guardian link from before you turned 18 is still active/i);
  await expect(card).toContainText(/parent center/i);
  await expect(card).toContainText(/don't send the host any money/i);
  await expect(card).not.toContainText(/paypal/i);
  await expectNoManualMethod(page);
  await expect(page.getByText(/host hasn't set up payment/i)).toHaveCount(0);
  await expect(page.locator('[aria-label="Pay with PayPal or card"]')).toHaveCount(0);

  await ctx.close();
});

test("when the manual-claim check says yes, every method is offered", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await mockPayScreen(page, { manual: [true], paypal: true });

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  await expect(page.getByRole("button", { name: `Pay $${ENTRY_FEE} in Venmo` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: `Pay $${ENTRY_FEE} in Cash App` })).toBeVisible();
  await expect(page.getByText(VENMO_HANDLE)).toBeVisible();
  await expect(page.getByText(/paypal or card/i)).toBeVisible();
  await expect(page.getByTestId("pay-manual-guardian-hold")).toHaveCount(0);
  await expect(page.getByTestId("pay-entry-blocked")).toHaveCount(0);

  await ctx.close();
});

test("a failed manual-claim check offers a retry, never the handles; the retry then offers them", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Two failures (the hook retries once), then a yes.
  await mockPayScreen(page, { manual: ["error", "error", true], paypal: true });

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  const failed = page.getByTestId("pay-manual-check-failed");
  await expect(failed).toBeVisible({ timeout: 20_000 });
  await expectNoManualMethod(page);
  // PayPal does not depend on this check (its server precondition is game_payment_guardian_ready): still offered.
  await expect(page.getByText(/paypal or card/i)).toBeVisible();
  await expect(page.locator('[aria-label="Pay with PayPal or card"]')).toHaveCount(1);

  await failed.getByRole("button", { name: /retry/i }).click();
  await expect(page.getByRole("button", { name: `Pay $${ENTRY_FEE} in Venmo` })).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId("pay-manual-check-failed")).toHaveCount(0);
  await expect(page.locator('[aria-label="Pay with PayPal or card"]')).toHaveCount(1);

  await ctx.close();
});

test("while the manual-claim check has not answered, PayPal is offered and the handles are not", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await mockPayScreen(page, { manual: ["pending"], paypal: true });

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  await expect(page.locator('[aria-label="Pay with PayPal or card"]')).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(page.getByText(/loading payment options/i)).toBeVisible();
  await expectNoManualMethod(page);
  await expect(page.getByTestId("pay-manual-guardian-hold")).toHaveCount(0);

  await ctx.close();
});

for (const manual of [false, true]) {
  test(`the game page's Payments tab shows the handles only when the manual-claim check says yes (${manual})`, async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await mockPayScreen(page, { manual: [manual], paypal: true });

    await restoreSession(page);
    await page.goto(`/games/${GAME_ID}?tab=payments`, { waitUntil: "domcontentloaded" });

    const accepted = page.getByText("Accepted methods");
    await expect(accepted).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/Venmo/).first()).toBeVisible();
    if (manual) {
      await expect(page.getByText(VENMO_HANDLE)).toBeVisible();
      await expect(page.getByText(CASHTAG)).toBeVisible();
      await expect(page.getByTestId("payment-details-manual-held")).toHaveCount(0);
    } else {
      const held = page.getByTestId("payment-details-manual-held");
      await expect(held).toBeVisible();
      await expect(held).toContainText(
        /a guardian link from before you turned 18 is still active/i,
      );
      await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
      await expect(page.getByText(CASHTAG)).toHaveCount(0);
    }

    await ctx.close();
  });
}
