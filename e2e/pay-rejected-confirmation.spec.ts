import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E: end-to-end mocked payment that transitions to rejected.
 *
 * Submits a mocked payment on the pay screen, then simulates the host
 * rejecting it (mocked payment_submissions GET starts returning the same
 * row as `rejected` with reviewer_notes). Asserts the pay screen updates
 * to the rejected state with the correct rejection copy:
 *   - status timeline data-status="rejected"
 *   - "Rejected" badge
 *   - "Rejected — try again" step
 *   - reviewer notes rendered as the failure hint
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
const REJECT_NOTE = "Couldn't find your Venmo transfer — please resend.";

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

test("payment rejected by host updates pay screen to rejected state", async ({ browser }) => {
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

  // Stateful submissions: POST adds a pending row; flipping the flag flips
  // subsequent GETs to return the row as `rejected` with reviewer_notes.
  const submissions: Array<Record<string, unknown>> = [];
  let hostHasRejected = false;

  await page.route(
    (url) => tableUrl(url, "payment_submissions"),
    async (route: Route) => {
      const req = route.request();
      const method = req.method();
      if (method === "GET") {
        const rows = hostHasRejected
          ? submissions.map((s) => ({
              ...s,
              status: "rejected",
              reviewer_notes: REJECT_NOTE,
              reviewed_at: new Date().toISOString(),
            }))
          : submissions;
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
          body: JSON.stringify(rows),
        });
      }
      if (method === "POST") {
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

  // Amount (the $15 fee) and date (today) are prefilled and tucked away.

  const submitBtn = page.getByRole("button", { name: /i have paid/i });
  // Paying requires accepting the host's refund terms first.
  await page.getByRole("checkbox", { name: /refund terms/i }).check();
  await Promise.all([
    page.waitForRequest(
      (req) => tableUrl(req.url(), "payment_submissions") && req.method() === "POST",
      { timeout: 10_000 },
    ),
    submitBtn.click(),
  ]);

  const timeline = page.getByTestId("payment-status-timeline");
  await expect(timeline).toBeVisible({ timeout: 10_000 });
  await expect(timeline).toHaveAttribute("data-status", "pending");

  // Simulate host rejection: flip mocked state and nudge the pay screen's
  // focus-based refresh so it re-fetches submissions immediately.
  hostHasRejected = true;
  await page.evaluate(() => {
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
  });

  await expect(timeline).toHaveAttribute("data-status", "rejected", { timeout: 10_000 });
  await expect(timeline).toContainText(/rejected/i);
  await expect(timeline).toContainText(/rejected — try again/i);
  await expect(timeline).toContainText(REJECT_NOTE);

  await ctx.close();
});
