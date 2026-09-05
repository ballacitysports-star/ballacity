import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: with realtime frames delayed / intermittently blocked, the pay page
 * must still flip from the approval gate to the payment picker EXACTLY ONCE
 * via the polling fallback, and late-arriving realtime frames must not
 * trigger duplicate payment submissions.
 *
 * Scenario:
 *  1. Realtime WebSocket is blocked at the network layer (frames "delayed").
 *  2. Host approves → the flip happens through the ~15s poll (exactly once).
 *  3. A late "postgres_changes" frame is simulated (as if realtime finally
 *     delivered) → UI stays approved, no extra POSTs.
 *  4. Player submits payment through the picker → exactly one submission row.
 *  5. Another late duplicate realtime frame is simulated → still one row.
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

async function fireLateRealtimeFrame(page: Page, userId: string) {
  return page.evaluate(
    async ({ userId, gameId, hostId }) => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const chans = mod.supabase.getChannels();
      let count = 0;
      for (const ch of chans as any[]) {
        if (typeof ch.topic !== "string" || !ch.topic.includes("pay-join-req:")) continue;
        const bindings =
          (ch.bindings && (ch.bindings.postgres_changes || ch.bindings["postgres_changes"])) || [];
        const payload = {
          schema: "public",
          table: "join_requests",
          commit_timestamp: new Date().toISOString(),
          eventType: "UPDATE",
          new: {
            id: "mock-join-id",
            game_id: gameId,
            host_id: hostId,
            player_id: userId,
            status: "approved",
          },
          old: {
            id: "mock-join-id",
            game_id: gameId,
            host_id: hostId,
            player_id: userId,
            status: "pending",
          },
          errors: null,
        };
        for (const b of bindings as any[]) {
          try {
            b.callback(payload);
            count += 1;
          } catch {
            /* ignore */
          }
        }
      }
      return count;
    },
    { userId, gameId: GAME_ID, hostId: FAKE_HOST_ID },
  );
}

test("delayed realtime: polling flips gate once, late frames create no duplicate submissions", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  const userId = sessionUserId();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // "Realtime frames delayed / intermittently blocked" — for the full test we
  // keep the realtime WebSocket unavailable. The client will still create
  // channel objects (with bindings) so we can synthesize a "late" frame
  // later in the test.
  await page.route(
    (u) => u.includes("/realtime/"),
    (route: PWRoute) => route.abort(),
  );

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

  // Track EVERY payment_submissions POST.
  type PostAttempt = { at: number; whenApproved: boolean };
  const posts: PostAttempt[] = [];
  const createdRows: any[] = [];
  let approved = false;
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
        posts.push({ at: Date.now(), whenApproved: approved });
        if (!approved) {
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
      if (route.request().method() !== "GET") return route.fallback();
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

  const gate = page.getByTestId("approval-required-gate");
  await expect(gate).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/pay host using/i)).toHaveCount(0);

  // No realtime channel should have joined (WS blocked).
  const joined = await page.evaluate(async () => {
    const mod = await import("/src/integrations/supabase/client.ts");
    return mod.supabase
      .getChannels()
      .some((c: any) => c.state === "joined" || c.state === "SUBSCRIBED");
  });
  expect(joined).toBe(false);

  // Host approves — polling must flip the UI.
  const getsBeforeApproval = joinGets;
  const approvedAt = Date.now();
  approved = true;

  await expect(gate).toHaveCount(0, { timeout: 45_000 });
  await expect(page.getByText(/pay host using/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/@testhost/i)).toBeVisible();
  const flipElapsed = Date.now() - approvedAt;
  expect(flipElapsed, "polling should take at least a tick").toBeGreaterThan(1_000);
  expect(joinGets).toBeGreaterThan(getsBeforeApproval);

  // A late realtime frame arrives AFTER polling already flipped the UI.
  const invoked1 = await fireLateRealtimeFrame(page, userId);
  expect(invoked1, "channel bindings must exist to simulate a late frame").toBeGreaterThan(0);

  // UI stays approved, still no submission POSTs from the late frame.
  await page.waitForTimeout(400);
  await expect(page.getByText(/pay host using/i)).toBeVisible();
  await expect(gate).toHaveCount(0);
  expect(posts.length, "no submission POSTs from late realtime frame").toBe(0);
  expect(createdRows.length).toBe(0);

  // Player picks method and submits — exactly ONE submission via the
  // approved path.
  await page
    .getByText(/@testhost/i)
    .first()
    .click();
  const submitBtn = page.getByRole("button", { name: /i have paid/i });
  await expect(submitBtn).toBeVisible({ timeout: 10_000 });
  await submitBtn.click();

  await expect(page.getByText(/submitted — host will verify/i).first()).toBeVisible({
    timeout: 10_000,
  });

  await page.waitForTimeout(400);
  expect(createdRows.length, "exactly one submission after approval").toBe(1);
  expect(posts.filter((p) => p.whenApproved).length).toBe(1);
  expect(posts.filter((p) => !p.whenApproved).length).toBe(0);

  // Another duplicate late realtime frame arrives after submission → still one row.
  const invoked2 = await fireLateRealtimeFrame(page, userId);
  expect(invoked2).toBeGreaterThan(0);
  await page.waitForTimeout(400);
  expect(createdRows.length, "late realtime frames must never re-submit").toBe(1);

  // URL unchanged.
  expect(new URL(page.url()).pathname).toBe(`/games/${GAME_ID}/pay`);

  await ctx.close();
});
