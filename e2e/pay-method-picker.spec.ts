import { test, expect, type Page } from "@playwright/test";
import { restoreSession } from "./helpers/signed-in";
import { PAY_FIXTURE_HOST_ID, payFixtureGameRow, serveFixtureGame } from "./helpers/pay-fixtures";

/**
 * E2E: a host who takes more than one payment method gets the picker, and
 * tapping a method's row opens that method's proof step on this tab.
 *
 * The submission specs mock a host with one method, which the pay screen
 * preselects (it skips the picker), so they never show the picker. This one
 * mocks two: Venmo, whose row also carries a "Pay $15" button that leaves for
 * venmo.com, and Zelle, which has no link. It taps the Zelle row itself, not a
 * launch button, so nothing should leave the page.
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
const VENMO_ID = "mock-method-venmo-1";
const ZELLE_ID = "mock-method-zelle-1";
const ZELLE_CONTACT = "e2e-zelle@example.test";

function tableUrl(url: string | URL, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
}

async function json(page: Page, match: (url: URL) => boolean, body: unknown, methods = ["GET"]) {
  await page.route(match, async (route) => {
    if (!methods.includes(route.request().method())) return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(body),
    });
  });
}

test("picking one of the host's methods opens its proof step on this tab", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await json(page, (url) => tableUrl(url, "game_payment_settings"), [
    {
      id: "mock-settings",
      game_id: GAME_ID,
      host_id: HOST_ID,
      entry_fee: 15,
      accepted_method_ids: [VENMO_ID, ZELLE_ID],
      payment_deadline: null,
      refund_policy: null,
      payment_instructions: null,
      requires_approval: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ]);
  const method = (over: Record<string, unknown>) => ({
    host_id: HOST_ID,
    payment_url: null,
    contact_info: null,
    username: null,
    instructions: null,
    is_enabled: true,
    ...over,
  });
  await json(
    page,
    (url) =>
      tableUrl(url, "host_payment_methods") ||
      String(url).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    [
      method({ id: VENMO_ID, payment_type: "venmo", label: "Venmo", username: "e2e-host" }),
      method({ id: ZELLE_ID, payment_type: "zelle", label: "Zelle", contact_info: ZELLE_CONTACT }),
    ],
    ["GET", "POST"],
  );
  await json(page, (url) => tableUrl(url, "join_requests"), []);
  await json(page, (url) => tableUrl(url, "payment_submissions"), []);
  await json(page, (url) => tableUrl(url, "game_participants"), []);
  await serveFixtureGame(page, payFixtureGameRow(GAME_ID));

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  // The picker, with both methods. ("Or pay another way" when the target has
  // PayPal checkout set up for this game, above the same list.)
  await expect(
    page.getByRole("heading", { name: /^(how do you want to pay\?|or pay another way)$/i }),
  ).toBeVisible({ timeout: 15_000 });
  const venmoRow = page.getByRole("button").filter({ hasText: "e2e-host" });
  const zelleRow = page.getByRole("button").filter({ hasText: ZELLE_CONTACT });
  await expect(venmoRow).toBeVisible();
  await expect(zelleRow).toBeVisible();
  // Venmo has a launch button of its own; that is not what this test taps.
  await expect(page.getByRole("button", { name: /^pay \$15 in venmo$/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: /i have paid — submit proof/i })).toHaveCount(0);

  await zelleRow.click();

  // Zelle's proof step, on this tab: its contact to send to, and the proof form.
  await expect(page.getByRole("heading", { name: /i have paid — submit proof/i })).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(ZELLE_CONTACT).first()).toBeVisible();
  await expect(page.getByText("e2e-host", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /i have paid/i })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe(`/games/${GAME_ID}/pay`);
  expect(ctx.pages()).toHaveLength(1);

  await ctx.close();
});
