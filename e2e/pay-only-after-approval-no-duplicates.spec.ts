import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: while the join request is `pending`, tapping "Pay" (and any direct
 * programmatic attempt) must NOT create a payment submission. After the host
 * approves, the picker appears and exactly one payment submission is created
 * — no duplicates from the earlier pending-phase attempts.
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

test("pay is blocked while pending; after approval exactly one submission is created", async ({
  browser,
}) => {
  test.setTimeout(60_000);

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

  // Mock join_requests GET with a flipping status flag.
  let approved = false;
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
            status: approved ? "approved" : "pending",
            message: null,
            reviewer_notes: null,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            reviewed_at: approved ? new Date().toISOString() : null,
            idempotency_key: `join:${GAME_ID}`,
          },
        ]),
      });
    },
  );

  // payment_submissions: mirror the DB trigger — reject POSTs while pending,
  // accept them once approved. Track every attempt.
  type PostAttempt = { at: number; whenApproved: boolean; ok: boolean };
  const posts: PostAttempt[] = [];
  const createdRows: any[] = [];

  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route: PWRoute) => {
      const req = route.request();
      if (req.method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(createdRows),
        });
        return;
      }
      if (req.method() === "POST") {
        if (!approved) {
          posts.push({ at: Date.now(), whenApproved: false, ok: false });
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
        const row = {
          id: `sub-${createdRows.length + 1}`,
          player_id: userId,
          game_id: GAME_ID,
          host_id: FAKE_HOST_ID,
          payment_method_id: METHOD_ID,
          payment_type: "venmo",
          screenshot_path: null,
          transaction_reference: null,
          notes: null,
          status: "pending",
          reviewer_notes: null,
          submitted_at: new Date().toISOString(),
          reviewed_at: null,
        };
        createdRows.push(row);
        posts.push({ at: Date.now(), whenApproved: true, ok: true });
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { "content-range": "0-0/1" },
          body: JSON.stringify([row]),
        });
        return;
      }
      return route.fallback();
    },
  );

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  // Approval gate is up, picker is not.
  const gate = page.getByTestId("approval-required-gate");
  await expect(gate).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/pay host using/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /i have paid/i })).toHaveCount(0);

  // "Clicking Pay" while pending: there's no picker button to click, so
  // simulate the strongest possible attempt — a direct programmatic insert
  // via the browser Supabase client. This must be rejected.
  const pendingAttempt = await page.evaluate(
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

  expect(pendingAttempt.data).toBeNull();
  expect(pendingAttempt.error?.message).toMatch(/approval required/i);
  expect(posts.length).toBe(1);
  expect(posts[0].ok).toBe(false);
  expect(createdRows.length).toBe(0);

  // Host approves.
  approved = true;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));

  // Gate flips to picker.
  await expect(gate).toHaveCount(0, { timeout: 20_000 });
  await expect(page.getByText(/pay host using/i)).toBeVisible({ timeout: 20_000 });

  // Pick the method → open the instructions/proof form.
  await page
    .getByText(/@testhost/i)
    .first()
    .click();
  const submitBtn = page.getByRole("button", { name: /i have paid/i });
  // Paying requires accepting the host's refund terms first.
  await page.getByRole("checkbox", { name: /refund terms/i }).check();
  await expect(submitBtn).toBeVisible({ timeout: 10_000 });

  // Submit the one legitimate payment via the approved path.
  await submitBtn.click();

  await expect(page.getByText(/submitted — host will verify/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // Exactly ONE approved-path row was created, no duplicates from the
  // earlier pending attempts.
  await page.waitForTimeout(400);
  expect(createdRows.length, "exactly one submission must be created").toBe(1);
  const okPosts = posts.filter((p) => p.ok);
  expect(okPosts.length, "only one POST should have succeeded").toBe(1);
  expect(okPosts[0].whenApproved).toBe(true);

  // Every failed POST happened while still pending.
  const failedPosts = posts.filter((p) => !p.ok);
  for (const p of failedPosts) expect(p.whenApproved).toBe(false);

  // URL unchanged.
  expect(new URL(page.url()).pathname).toBe(`/games/${GAME_ID}/pay`);

  await ctx.close();
});
