import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: viewing the game as the host, when a player leaves (their
 * join_request DELETE reaches Postgres) the host's "Pickup requests"
 * list must update in realtime — the specific pending row disappears
 * and the pending counter drops — with no reload and no polling wait.
 *
 * Flow:
 *  1. Restore the sandbox session, mock `game_payment_settings` with
 *     `host_id = <sessionUserId>` so the viewer is the host of `g2`.
 *  2. Seed `join_requests` GET with one PENDING request from another
 *     player. Assert "Pickup requests · 1 pending" renders and a
 *     `HostRequestRow` for that player is visible.
 *  3. Flip the join_requests GET mock to `[]` and dispatch a
 *     `postgres_changes` DELETE frame to the
 *     `join_requests:host:<gameId>:<userId>` channel — exactly what
 *     supabase-js delivers when the player-side DELETE lands.
 *  4. Assert the specific pending row disappears, the counter clears
 *     to "No pickup requests yet.", and the realtime handler triggered
 *     a fresh GET (proves the wiring ran end-to-end, not just DOM).
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
const OTHER_PLAYER_ID = "11111111-2222-3333-4444-555555555555";
const JOIN_REQ_ID = "mock-pending-req-id";

const isTable = (url: string | URL, table: string) =>
  String(url).includes(`/rest/v1/${table}`);

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

test("host's pending list clears in realtime when the player's join_request is deleted", async ({
  browser,
}) => {
  test.setTimeout(45_000);

  const userId = (JSON.parse(SESSION_JSON!) as { user?: { id?: string } })?.user?.id;
  expect(userId, "session must contain user.id").toBeTruthy();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Mutable state driving the join_requests GET mock.
  let requestDeleted = false;
  let joinGets = 0;

  // hosted_games: rely on sample fallback for g2.
  await page.route(
    (u) => isTable(u, "hosted_games"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  // game_payment_settings: viewer is the host.
  await page.route(
    (u) => isTable(u, "game_payment_settings"),
    async (route: PWRoute) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify([
          {
            id: "mock-settings-id",
            game_id: GAME_ID,
            host_id: userId,
            entry_fee: 0,
            accepted_method_ids: [],
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

  // Silence unrelated tables.
  await page.route(
    (u) =>
      isTable(u, "host_payment_methods") ||
      isTable(u, "payment_submissions") ||
      isTable(u, "game_participants") ||
      isTable(u, "profiles"),
    async (route) => {
      const m = route.request().method();
      if (m !== "GET" && m !== "HEAD") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/0" },
        body: "[]",
      });
    },
  );

  // join_requests: one pending row from another player, until the DELETE
  // frame flips `requestDeleted` and subsequent GETs return empty.
  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: PWRoute) => {
      const method = route.request().method();
      if (method === "GET") {
        joinGets += 1;
        const rows = requestDeleted
          ? []
          : [
              {
                id: JOIN_REQ_ID,
                game_id: GAME_ID,
                host_id: userId,
                player_id: OTHER_PLAYER_ID,
                status: "pending",
                message: "Can I join?",
                reviewer_notes: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                reviewed_at: null,
                idempotency_key: `join:${GAME_ID}:${OTHER_PLAYER_ID}`,
                attempt_count: 1,
              },
            ];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
          body: JSON.stringify(rows),
        });
      }
      return route.fallback();
    },
  );

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });

  // 1. Host sees the pending request in the pickup list.
  await expect(page.getByText(/Pickup requests · 1 pending/i)).toBeVisible({
    timeout: 15_000,
  });

  // 2. Wait for the host-scoped realtime channel to register.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const mod = await import("/src/integrations/supabase/client.ts");
          return mod.supabase
            .getChannels()
            .some(
              (c: { topic?: string }) =>
                typeof c.topic === "string" && c.topic.includes("join_requests:host:"),
            );
        }),
      { timeout: 10_000, message: "host-side join_requests realtime channel never registered" },
    )
    .toBe(true);

  const getsBeforeDelete = joinGets;

  // 3. Flip the mock BEFORE dispatching realtime so any refetch the handler
  // triggers reflects the post-leave shape.
  requestDeleted = true;

  const invoked = await page.evaluate(
    async ({ userId, gameId, otherId, reqId }) => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const chans = mod.supabase.getChannels();
      let count = 0;
      const payload = {
        schema: "public",
        table: "join_requests",
        commit_timestamp: new Date().toISOString(),
        eventType: "DELETE",
        new: null,
        old: {
          id: reqId,
          game_id: gameId,
          host_id: userId,
          player_id: otherId,
          status: "pending",
        },
        errors: null,
      };
      for (const ch of chans as Array<{ topic?: string; bindings?: Record<string, unknown> }>) {
        if (typeof ch.topic !== "string" || !ch.topic.includes("join_requests:host:")) continue;
        const bindings =
          (ch.bindings && ((ch.bindings as Record<string, unknown>).postgres_changes as unknown[])) ||
          [];
        for (const b of bindings as Array<{ callback: (p: unknown) => void }>) {
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
    { userId: userId!, gameId: GAME_ID, otherId: OTHER_PLAYER_ID, reqId: JOIN_REQ_ID },
  );

  expect(
    invoked,
    "at least one host-side postgres_changes binding must be invoked",
  ).toBeGreaterThan(0);

  // 4. Pickup list collapses to the empty state; counter is gone.
  await expect(page.getByText(/Pickup requests · \d+ pending/i)).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(
    page.getByText(/No pickup requests yet\. You'll see them here as players ask to join/i),
  ).toBeVisible({ timeout: 10_000 });

  // 5. Handler actually refetched (proves realtime → refresh wiring, not
  // just a DOM patch off the payload).
  expect(joinGets).toBeGreaterThan(getsBeforeDelete);

  // No navigation happened.
  expect(new URL(page.url()).pathname).toBe(`/games/${GAME_ID}`);

  await ctx.close();
});
