import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E: the pay screen must fetch host payment options exclusively via
 * the `get_game_host_payment_methods` RPC (game + host scoped, security definer),
 * never via a direct `host_payment_methods` table SELECT. When the RPC
 * returns no rows, the screen must render the empty state.
 *
 * Guards against regressing back to `supabase.from("host_payment_methods")`
 * for the host lookup, which under the previous RLS policy leaked every
 * enabled host's payment data.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const HOST_A = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const ENTRY_FEE = 15;

function urlIncludes(url: string | URL, needle: string) {
  return String(url).includes(needle);
}

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

async function mockEmptyLists(page: Page) {
  const empty = async (route: Route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  };
  await page.route((url) => urlIncludes(url, "/rest/v1/payment_submissions"), empty);
  await page.route((url) => urlIncludes(url, "/rest/v1/join_requests"), empty);
  await page.route((url) => urlIncludes(url, "/rest/v1/game_participants"), empty);
}

async function mockPaidSettings(page: Page) {
  await page.route(
    (url) => urlIncludes(url, "/rest/v1/game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify([
          {
            id: "mock-settings",
            game_id: GAME_ID,
            host_id: HOST_A,
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

test("Pay screen uses host-scoped RPC and renders empty state when no methods", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const rpcCalls: string[] = [];
  const directTableGets: string[] = [];

  // The correct path: RPC returns empty list.
  await page.route(
    (url) => urlIncludes(url, "/rest/v1/rpc/get_game_host_payment_methods"),
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fallback();
      let body: { _host_id?: string; _game_id?: string } = {};
      try {
        body = JSON.parse(req.postData() || "{}");
      } catch {
        /* ignore */
      }
      rpcCalls.push(body._host_id ?? "");
      expect(body._game_id).toBe(GAME_ID);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    },
  );

  // Record any direct table GET so we can assert the client didn't
  // regress to `supabase.from("host_payment_methods").select(...)`
  // for the host lookup. Own-methods lookups (e.g. from /payments)
  // are allowed but shouldn't fire on the pay screen.
  await page.route(
    (url) => urlIncludes(url, "/rest/v1/host_payment_methods"),
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") directTableGets.push(req.url());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    },
  );

  await mockPaidSettings(page);
  await mockEmptyLists(page);
  await restoreSession(page);

  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  // Empty state renders.
  await expect(
    page.getByText(/host hasn't set up payment yet/i).first(),
  ).toBeVisible({ timeout: 15_000 });

  // The payment-method list heading ("How do you want to pay?") must not render when there are no methods.
  await expect(page.getByText(/how do you want to pay|or pay another way/i)).toHaveCount(0);

  // Give the client a moment to make any late requests it might make.
  await page.waitForTimeout(500);

  // The RPC was called exactly for HOST_A.
  expect(rpcCalls.length).toBeGreaterThan(0);
  for (const arg of rpcCalls) {
    expect(arg).toBe(HOST_A);
  }

  // No direct host_payment_methods table GET happened on the pay screen.
  expect(directTableGets).toEqual([]);

  await ctx.close();
});
