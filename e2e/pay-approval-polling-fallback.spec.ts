import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: the pay page must still flip from the approval gate to the payment
 * picker when realtime is unavailable — using the polling/refetch fallback
 * alone. Realtime WebSocket connections are blocked at the network layer so
 * no `postgres_changes` frame can arrive; the flip must come from the
 * ~15s interval poll.
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

test("pay page flips from gate to picker via polling when realtime is unavailable", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  const userId = sessionUserId();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Block realtime at the network layer — WebSocket handshakes to
  // /realtime/v1/websocket start as HTTP upgrades and can be aborted here.
  await page.route(
    (u) => String(u).includes("/realtime/"),
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

  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route: PWRoute) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  let approved = false;
  let joinGets = 0;
  const gatingGets: number[] = [];
  const approvedGets: number[] = [];
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
      (approved ? approvedGets : gatingGets).push(Date.now());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([row(approved ? "approved" : "pending")]),
      });
    },
  );

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}/pay`, { waitUntil: "domcontentloaded" });

  // Approval gate visible, picker not.
  const gate = page.getByTestId("approval-required-gate");
  await expect(gate).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/pay host using/i)).toHaveCount(0);

  // Sanity: realtime is truly blocked — no active realtime channel should be
  // in the SUBSCRIBED state (subscribe attempts should fail on the aborted
  // WebSocket upgrade). We still allow the channel object to exist.
  const anySubscribed = await page.evaluate(async () => {
    const mod = await import("/src/integrations/supabase/client.ts");
    const chans = mod.supabase.getChannels();
    return chans.some((c: any) => c.state === "joined" || c.state === "SUBSCRIBED");
  });
  expect(anySubscribed, "no realtime channel should be joined when WS is blocked").toBe(false);

  const getsBeforeApproval = joinGets;
  const approvedGetsBefore = approvedGets.length;
  const approvedAt = Date.now();

  // Host approves — flip the mock. Do NOT dispatch focus / visibility events
  // and do NOT reload. Only the interval poll (~15s) can pick this up.
  approved = true;

  // Wait for the polling path to notice — allow ~2 poll intervals of slack.
  await expect(gate).toHaveCount(0, { timeout: 45_000 });
  await expect(page.getByText(/pay host using/i)).toBeVisible({ timeout: 5_000 });
  await expect(page.getByText(/@testhost/i)).toBeVisible();

  // A refetch happened after approval, and it returned the approved row.
  expect(joinGets).toBeGreaterThan(getsBeforeApproval);
  expect(approvedGets.length).toBeGreaterThan(approvedGetsBefore);

  // The flip took at least a polling tick — not instant like realtime would be.
  const elapsed = Date.now() - approvedAt;
  expect(elapsed, `polling should take at least a few seconds, took ${elapsed}ms`).toBeGreaterThan(
    1_000,
  );

  // URL unchanged — no navigation / reload.
  expect(new URL(page.url()).pathname).toBe(`/games/${GAME_ID}/pay`);

  await ctx.close();
});
