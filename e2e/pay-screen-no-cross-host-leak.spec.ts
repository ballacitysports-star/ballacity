import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E: loading the pay screen for a game hosted by HOST_A must never
 * surface payment-method data belonging to a different host (HOST_B).
 *
 * Guards against the previous RLS leak where `host_payment_methods`
 * SELECT allowed any authenticated user to read every enabled host's
 * payment methods. After the fix, players fetch only a specific host's
 * enabled methods via the `get_game_host_payment_methods` RPC, and direct
 * table reads for another host must return zero rows.
 *
 * The test:
 *   1. Mocks game_payment_settings to point at HOST_A.
 *   2. Intercepts the get_game_host_payment_methods RPC — returns HOST_A's
 *      method when asked for HOST_A, and rejects (fails the test) if
 *      the client ever asks for HOST_B.
 *   3. Fulfills a direct table read for HOST_B with an empty list to
 *      simulate the RLS filter, and asserts nothing rendered leaks
 *      HOST_B's label or username.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const HOST_A = "11111111-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const HOST_B = "22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const HOST_A_LABEL = "Host A Venmo";
const HOST_A_USERNAME = "@hostA_venmo";
const HOST_B_LABEL = "Host B Venmo (SHOULD NOT APPEAR)";
const HOST_B_USERNAME = "@hostB_secret";
const ENTRY_FEE = 12;

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
            accepted_method_ids: ["method-a"],
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

test("Pay screen for HOST_A never renders or requests HOST_B's payment methods", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const rpcCalls: string[] = [];
  const leakedHostBRequests: string[] = [];

  // Intercept the security-definer RPC. Only HOST_A for GAME_ID is legitimate;
  // any HOST_B call is a leak and is recorded to fail the test below.
  await page.route(
    (url) => urlIncludes(url, "/rest/v1/rpc/get_game_host_payment_methods"),
    async (route) => {
      const req = route.request();
      if (req.method() !== "POST") return route.fallback();
      let body: { _host_id?: string; _game_id?: string } = {};
      try {
        body = JSON.parse(req.postData() || "{}");
      } catch {
        /* keep body empty */
      }
      rpcCalls.push(body._host_id ?? "");
      expect(body._game_id).toBe(GAME_ID);
      if (body._host_id === HOST_A) {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify([
            {
              id: "method-a",
              host_id: HOST_A,
              payment_type: "venmo",
              label: HOST_A_LABEL,
              username: HOST_A_USERNAME,
              payment_url: null,
              contact_info: null,
              instructions: null,
              is_enabled: true,
            },
          ]),
        });
        return;
      }
      // Never should be called for HOST_B — respond empty and record the leak.
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: "[]",
      });
    },
  );

  // Direct table reads: only owner rows should ever come back under the
  // tightened RLS. If any request asks the Data API for a different
  // host's rows, record it and simulate the RLS empty result.
  await page.route(
    (url) => urlIncludes(url, "/rest/v1/host_payment_methods"),
    async (route) => {
      const req = route.request();
      if (req.method() !== "GET") return route.fallback();
      const u = new URL(req.url());
      const hostFilter = u.searchParams.get("host_id") ?? "";
      if (hostFilter.includes(HOST_B)) {
        leakedHostBRequests.push(req.url());
      }
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

  // HOST_A's method must be rendered.
  await expect(page.getByText(HOST_A_LABEL).first()).toBeVisible({ timeout: 15_000 });

  // HOST_B's data must never appear anywhere on the pay screen.
  const bodyText = await page.locator("body").innerText();
  expect(bodyText).not.toContain(HOST_B_LABEL);
  expect(bodyText).not.toContain(HOST_B_USERNAME);
  expect(bodyText).not.toContain(HOST_B);

  // The RPC must only ever have been called for HOST_A.
  expect(rpcCalls.length).toBeGreaterThan(0);
  for (const arg of rpcCalls) {
    expect(arg).toBe(HOST_A);
  }

  // No direct Data API read against another host's rows.
  expect(leakedHostBRequests).toEqual([]);

  await ctx.close();
});
