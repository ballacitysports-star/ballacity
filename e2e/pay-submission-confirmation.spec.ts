import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E: end-to-end mocked payment submission.
 *
 * Navigates to the pay screen for a paid sample game with a fully mocked
 * backend, picks a payment method, fills the proof form (no file upload
 * required — proof screenshot is optional), taps "I have paid", and asserts
 * the post-payment confirmation UI (payment status timeline with a pending
 * submission) appears.
 *
 * Auto-skips when no signed-in Supabase session is available.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

// g2 is a paid sample game (price 8) in src/lib/sample-data.ts.
const GAME_ID = "g2";
const HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const METHOD_ID = "mock-method-venmo-1";

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

test("submitting mocked payment shows the post-payment confirmation UI", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const userId = (JSON.parse(SESSION_JSON!) as { user?: { id?: string } })?.user?.id;
  expect(userId, "session must contain user.id").toBeTruthy();

  // ---- Mocks ----------------------------------------------------------

  // Paid, no-approval settings owned by HOST_ID.
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

  // Host has one enabled Venmo method (no payment_url so no external launch
  // is triggered — clicking the row picks it and shows the proof form).
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

  // No pending join requests.
  await page.route(
    (url) => tableUrl(url, "join_requests"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  // No prior hosted game overrides.
  await page.route(
    (url) => tableUrl(url, "hosted_games"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  // Swallow best-effort game_participants writes triggered by joinGame().
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

  // Stateful payment_submissions: initially empty, then contains the row
  // created by the POST so the next GET drives the confirmation UI.
  const submissions: Array<Record<string, unknown>> = [];
  await page.route(
    (url) => tableUrl(url, "payment_submissions"),
    async (route: Route) => {
      const req = route.request();
      const method = req.method();
      if (method === "GET") {
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": `0-${Math.max(0, submissions.length - 1)}/${submissions.length}` },
          body: JSON.stringify(submissions),
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

  // Pick the Venmo method — the row's primary button (label/username area).
  const methodButton = page.getByRole("button", { name: /e2e-host|venmo/i }).first();
  await expect(methodButton).toBeVisible({ timeout: 10_000 });
  await methodButton.click();

  // Proof form is now visible.
  const amountInput = page.locator("#paid-amount");
  await expect(amountInput).toBeVisible({ timeout: 10_000 });
  await amountInput.fill("15");
  await page.locator("#paid-at").fill(new Date().toISOString().slice(0, 10));

  // Submit — proof screenshot is optional in the current UX.
  const submitBtn = page.getByRole("button", { name: /i have paid/i });
  // Paying requires accepting the host's refund terms first.
  await page.getByRole("checkbox", { name: /refund terms/i }).check();
  await expect(submitBtn).toBeEnabled();

  const [submitReq] = await Promise.all([
    page.waitForRequest(
      (req) =>
        tableUrl(req.url(), "payment_submissions") && req.method() === "POST",
      { timeout: 10_000 },
    ),
    submitBtn.click(),
  ]);
  expect(submitReq.method()).toBe("POST");

  // Post-payment confirmation: status timeline appears with a pending sub.
  const timeline = page.getByTestId("payment-status-timeline");
  await expect(timeline).toBeVisible({ timeout: 10_000 });
  await expect(timeline).toHaveAttribute("data-status", "pending");
  await expect(timeline).toContainText(/proof submitted/i);
  await expect(timeline).toContainText(/host reviewing/i);

  await ctx.close();
});
