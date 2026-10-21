import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: while a join request is still unapproved, the pay page must not let
 * the viewer initiate a payment submission through the UI, and the backend
 * must reject any programmatic insert attempt.
 *
 * Verifies:
 *  1. Approval gate is rendered.
 *  2. Payment picker + "I have paid" submit surface are NOT rendered.
 *  3. Zero POSTs are made to `/rest/v1/payment_submissions` from the UI.
 *  4. A direct programmatic insert via the browser Supabase client
 *     receives the mocked trigger-style error (42501, "approval required").
 *
 * Auto-skips without a restored Supabase session.
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

test("payment submission is blocked while join request is unapproved", async ({ browser }) => {
  const userId = sessionUserId();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

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

  const submissionPosts: Array<{ at: number; body: string }> = [];
  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route: PWRoute) => {
      const req = route.request();
      if (req.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      if (req.method() === "POST") {
        submissionPosts.push({ at: Date.now(), body: req.postData() ?? "" });
        // Mirror the DB trigger: reject with the approval-required error.
        await route.fulfill({
          status: 403,
          contentType: "application/json",
          body: JSON.stringify({
            code: "42501",
            message: "Host approval required before payment can be submitted for this game.",
          }),
        });
        return;
      }
      return route.fallback();
    },
  );

  // Join request stays `pending` for the whole test.
  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: PWRoute) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "mock-join-id",
            game_id: GAME_ID,
            host_id: FAKE_HOST_ID,
            player_id: userId,
            status: "pending",
            message: null,
            reviewer_notes: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            reviewed_at: null,
            idempotency_key: `join:${GAME_ID}`,
          },
        ]),
      });
    },
  );

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  // 1. Approval gate is visible.
  const gate = page.getByTestId("approval-required-gate");
  await expect(gate).toBeVisible({ timeout: 10_000 });
  await expect(gate).toContainText(/waiting on host approval/i);

  // 2. Payment picker + submit surfaces are NOT rendered.
  await expect(page.getByText(/how do you want to pay|or pay another way/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /i have paid/i })).toHaveCount(0);
  await expect(page.getByText(/@testhost/i)).toHaveCount(0);

  // Give any stray UI-driven POST a chance to fire, then confirm none did.
  await page.waitForTimeout(600);
  expect(
    submissionPosts.length,
    `no UI-driven payment submissions should fire, saw ${submissionPosts.length}`,
  ).toBe(0);

  // 3. A direct programmatic insert via the browser Supabase client must be
  //    rejected — mirroring the server-side trigger.
  const attempt = await page.evaluate(
    async ({ gameId, hostId, methodId }) => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const { data, error } = await mod.supabase
        .from("payment_submissions")
        .insert({
          game_id: gameId,
          host_id: hostId,
          payment_method_id: methodId,
          payment_type: "venmo",
          screenshot_path: null,
          transaction_reference: null,
          notes: null,
        } as any)
        .select("id");
      return {
        data,
        error: error ? { code: (error as any).code, message: (error as any).message } : null,
      };
    },
    { gameId: GAME_ID, hostId: FAKE_HOST_ID, methodId: METHOD_ID },
  );

  expect(attempt.data).toBeNull();
  expect(attempt.error, "programmatic insert must be rejected").not.toBeNull();
  expect(attempt.error!.message).toMatch(/approval required/i);

  // The programmatic attempt reached the network (was intercepted) — confirm it.
  expect(submissionPosts.length).toBe(1);

  // Pay page URL is unchanged.
  expect(new URL(page.url()).pathname).toBe(`/games/${GAME_ID}/pay`);

  await ctx.close();
});
