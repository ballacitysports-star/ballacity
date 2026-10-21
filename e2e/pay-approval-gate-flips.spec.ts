import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: on the pay page, when the viewer's join request flips from `pending`
 * to `approved` (host approval simulated by swapping the mocked GET
 * response), the approval gate must disappear and the payment picker must
 * render — without a manual reload.
 *
 * Uses the pay page's polling fallback (~15s) so this exercises the same
 * refresh path that runs when realtime frames are dropped. Auto-skips
 * without a restored Supabase session.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const FAKE_HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const METHOD_ID = "mock-method-venmo";
const ENTRY_FEE = 15;

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

test("pay page auto-flips from approval gate to payment picker on approval", async ({
  browser,
}) => {
  test.setTimeout(60_000);

  const userId = sessionUserId();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Paid, approval-required settings owned by FAKE_HOST_ID.
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
            entry_fee: ENTRY_FEE,
            accepted_method_ids: [METHOD_ID],
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

  // One enabled Venmo method for the host so the picker has a row to show.
  await page.route(
    (u) => isTable(String(u), "host_payment_methods") || String(u).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    async (route: PWRoute) => {
      if (!["GET","POST"].includes(route.request().method())) return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: METHOD_ID,
            host_id: FAKE_HOST_ID,
            payment_type: "venmo",
            label: "Venmo",
            username: "@testhost",
            payment_url: "https://venmo.com/u/testhost",
            contact_info: null,
            instructions: null,
            is_enabled: true,
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

  // Join-request GET: starts `pending`, flips to `approved` when we say so.
  let approved = false;
  let joinGets = 0;
  const row = (status: "pending" | "approved") => ({
    id: "mock-join-id",
    game_id: GAME_ID,
    host_id: FAKE_HOST_ID,
    player_id: userId,
    status,
    message: null,
    reviewer_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    reviewed_at: status === "approved" ? new Date().toISOString() : null,
    idempotency_key: `join:${GAME_ID}`,
  });
  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: PWRoute) => {
      const req = route.request();
      if (req.method() !== "GET") return route.fallback();
      joinGets += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([row(approved ? "approved" : "pending")]),
      });
    },
  );

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  // Approval gate is visible; payment picker is not.
  const gate = page.getByTestId("approval-required-gate");
  await expect(gate).toBeVisible({ timeout: 10_000 });
  await expect(gate).toContainText(/waiting on host approval/i);
  await expect(page.getByText(/how do you want to pay|or pay another way/i)).toHaveCount(0);

  const getsBeforeApproval = joinGets;

  // Host approves — flip the mock so subsequent GETs return `approved`.
  approved = true;

  // Nudge the polling/focus refresh path so we don't wait the full 15s.
  // The pay page listens for `focus` and `visibilitychange`, so re-focusing
  // the page triggers an immediate refetch.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  // Gate disappears, picker appears — automatically, no reload.
  await expect(gate).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(/how do you want to pay|or pay another way/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/@testhost/i)).toBeVisible();

  // A refetch definitely happened after approval.
  expect(joinGets).toBeGreaterThan(getsBeforeApproval);

  // URL stayed on the pay page.
  expect(new URL(page.url()).pathname).toBe(`/games/${GAME_ID}/pay`);

  await ctx.close();
});
