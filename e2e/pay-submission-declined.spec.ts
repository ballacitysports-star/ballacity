import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E: submitting proof-of-payment fails (declined at the API layer).
 *
 * Mocks payment_submissions POST to return an error, then asserts:
 *   - an actionable error toast surfaces with the server message
 *   - the URL stays on the same game's pay screen (no navigation away)
 *   - the "I have paid" button is still enabled so the user can retry
 *   - a follow-up POST that succeeds transitions the timeline to pending
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
const HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const METHOD_ID = "mock-method-venmo-1";
const DECLINE_MSG = "Payment declined by processor — please try again.";

function tableUrl(url: string, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
}

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

test("declined submission shows actionable error and stays on the pay screen", async ({
  browser,
}) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const userId = (JSON.parse(SESSION_JSON!) as { user?: { id?: string } })?.user?.id;
  expect(userId, "session must contain user.id").toBeTruthy();

  // ---- Mocks ----------------------------------------------------------

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
            id: "mock-settings",
            game_id: GAME_ID,
            host_id: HOST_ID,
            entry_fee: 15,
            accepted_method_ids: [METHOD_ID],
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
    (url) => tableUrl(url, "host_payment_methods") || String(url).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    async (route) => {
      if (!["GET","POST"].includes(route.request().method())) return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: METHOD_ID,
            host_id: HOST_ID,
            payment_type: "venmo",
            label: "Venmo",
            username: "e2e-host",
            payment_url: null,
            contact_info: null,
            instructions: null,
            is_enabled: true,
          },
        ]),
      });
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
    (url) => tableUrl(url, "hosted_games"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  await page.route(
    (url) => tableUrl(url, "game_participants"),
    async (route) => {
      const method = route.request().method();
      if (method === "GET") {
        return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
      }
      if (method === "POST") {
        return route.fulfill({ status: 201, contentType: "application/json", body: "[]" });
      }
      return route.fallback();
    },
  );

  // Stateful submissions: first POST is declined, subsequent POSTs succeed
  // so we can prove the user can retry from the same screen.
  const submissions: Array<Record<string, unknown>> = [];
  let postAttempts = 0;

  await page.route(
    (url) => tableUrl(url, "payment_submissions"),
    async (route: Route) => {
      const req = route.request();
      const method = req.method();
      if (method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: {
            "content-range": `0-${Math.max(0, submissions.length - 1)}/${submissions.length}`,
          },
          body: JSON.stringify(submissions),
        });
      }
      if (method === "POST") {
        postAttempts += 1;
        if (postAttempts === 1) {
          // PostgREST-style error payload; supabase-js surfaces `message`.
          return route.fulfill({
            status: 402,
            contentType: "application/json",
            body: JSON.stringify({
              code: "P0001",
              message: DECLINE_MSG,
              details: null,
              hint: null,
            }),
          });
        }
        let payload: Record<string, unknown> = {};
        try {
          const raw = JSON.parse(req.postData() || "{}");
          payload = Array.isArray(raw) ? raw[0] : raw;
        } catch {
          /* ignore */
        }
        const now = new Date().toISOString();
        const row = {
          id: `sub-${Date.now()}`,
          player_id: userId,
          game_id: GAME_ID,
          host_id: HOST_ID,
          payment_method_id: METHOD_ID,
          payment_type: "venmo",
          screenshot_path: null,
          transaction_reference: null,
          paid_amount: 15,
          paid_at: now,
          notes: null,
          status: "pending",
          reviewer_notes: null,
          submitted_at: now,
          reviewed_at: null,
          ...payload,
        };
        submissions.unshift(row);
        return route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify([row]),
        });
      }
      return route.fallback();
    },
  );

  // ---- Flow ----------------------------------------------------------

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  const methodButton = page.getByRole("button", { name: /e2e-host|venmo/i }).first();
  await expect(methodButton).toBeVisible({ timeout: 10_000 });
  await methodButton.click();

  await page.locator("#paid-amount").fill("15");
  await page.locator("#paid-at").fill(new Date().toISOString().slice(0, 10));

  const submitBtn = page.getByRole("button", { name: /i have paid/i });
  // Paying requires accepting the host's refund terms first.
  await page.getByRole("checkbox", { name: /refund terms/i }).check();

  // First submit: mocked decline.
  const [declinedResp] = await Promise.all([
    page.waitForResponse(
      (res) =>
        tableUrl(res.url(), "payment_submissions") &&
        res.request().method() === "POST" &&
        res.status() === 402,
      { timeout: 10_000 },
    ),
    submitBtn.click(),
  ]);
  expect(declinedResp.status()).toBe(402);

  // Actionable error surfaces via the toast layer (sonner renders under
  // role=status). The exact wording comes from the server message.
  const errorToast = page.getByText(DECLINE_MSG, { exact: false });
  await expect(errorToast).toBeVisible({ timeout: 10_000 });

  // Still on the same pay screen — no redirect on failure.
  await expect(page).toHaveURL(new RegExp(`/games/${GAME_ID}/pay(\\?|$)`));

  // Timeline never advances past pre-submission — no pending row exists.
  await expect(page.getByTestId("payment-status-timeline")).toHaveCount(0);

  // Submit button is still enabled so the user can retry from the same
  // context without losing form state.
  await expect(submitBtn).toBeEnabled();
  await expect(page.locator("#paid-amount")).toHaveValue("15");

  // Retry: second POST succeeds and the timeline advances to pending.
  await Promise.all([
    page.waitForResponse(
      (res) =>
        tableUrl(res.url(), "payment_submissions") &&
        res.request().method() === "POST" &&
        res.status() === 201,
      { timeout: 10_000 },
    ),
    submitBtn.click(),
  ]);

  const timeline = page.getByTestId("payment-status-timeline");
  await expect(timeline).toBeVisible({ timeout: 10_000 });
  await expect(timeline).toHaveAttribute("data-status", "pending");
  await expect(page).toHaveURL(new RegExp(`/games/${GAME_ID}/pay(\\?|$)`));

  await ctx.close();
});
