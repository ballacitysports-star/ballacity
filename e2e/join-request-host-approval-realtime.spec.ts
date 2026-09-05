import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: on the game view (`/games/:gameId`), a player creates a join
 * request against an approval-gated game and then a host approval
 * arrives over realtime — the status UI must flip live (no reload,
 * no focus event, well before any polling interval).
 *
 * Flow:
 *  1. Land on the game view (approval-gated, entry_fee = 0 so no pay gate).
 *  2. Tap "Request to join" → POST captured, "Waiting for host approval"
 *     banner + "Request pending · Tap to cancel" sticky CTA render.
 *  3. Flip the join_requests GET mock to "approved" and dispatch a
 *     `postgres_changes` UPDATE frame to the `join_requests:me:<gameId>:<userId>`
 *     realtime channel — exactly what supabase-js does on a live frame.
 *  4. Assert the status strip flips to "You're approved — see you there!"
 *     and the sticky CTA no longer says "Request pending".
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

test("join request → host approval arrives via realtime and status flips live", async ({
  browser,
}) => {
  test.setTimeout(45_000);

  const userId = sessionUserId();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ---- REST mocks ----
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

  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route: PWRoute) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  let joinPost: { body: any } | null = null;
  let approved = false;
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
      const req = route.request();
      const method = req.method();
      if (method === "GET") {
        joinGets += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(joinPost ? [row(approved ? "approved" : "pending")] : []),
        });
        return;
      }
      if (method === "POST") {
        let parsed: any = null;
        try {
          parsed = JSON.parse(req.postData() ?? "null");
        } catch {
          /* ignore */
        }
        joinPost = { body: parsed };
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { "content-range": "0-0/1" },
          body: JSON.stringify([row("pending")]),
        });
        return;
      }
      return route.fallback();
    },
  );

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });

  // Fire the CTA.
  const cta = page.getByRole("button", { name: /request to join/i }).first();
  await expect(cta).toBeVisible({ timeout: 15_000 });
  await cta.click();

  // POST captured with correct payload.
  await expect
    .poll(() => joinPost, { timeout: 10_000, message: "join_requests POST never fired" })
    .not.toBeNull();
  expect(joinPost!.body.game_id).toBe(GAME_ID);
  expect(joinPost!.body.host_id).toBe(FAKE_HOST_ID);

  // Pending UI is up.
  await expect(
    page.getByRole("status").filter({ hasText: /waiting for host approval/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // Wait for the player-side realtime channel to be registered.
  await expect
    .poll(
      async () =>
        page.evaluate(async () => {
          const mod = await import("/src/integrations/supabase/client.ts");
          return mod.supabase
            .getChannels()
            .some(
              (c: any) => typeof c.topic === "string" && c.topic.includes("join_requests:me:"),
            );
        }),
      { timeout: 10_000, message: "player-side join_requests realtime channel never registered" },
    )
    .toBe(true);

  const getsBeforeApproval = joinGets;

  // Host approves — flip the backing mock BEFORE firing the realtime frame
  // so any refetch the handler triggers sees `approved`.
  approved = true;

  // Deliver a postgres_changes UPDATE frame to the player-side channel.
  const invoked = await page.evaluate(
    async ({ userId, gameId, hostId }) => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const chans = mod.supabase.getChannels();
      let count = 0;
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
          reviewed_at: new Date().toISOString(),
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
      for (const ch of chans as any[]) {
        if (typeof ch.topic !== "string" || !ch.topic.includes("join_requests:me:")) continue;
        const bindings =
          (ch.bindings && (ch.bindings.postgres_changes || ch.bindings["postgres_changes"])) || [];
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

  expect(invoked, "at least one postgres_changes binding must be invoked").toBeGreaterThan(0);

  // Live flip: status strip switches to "approved" copy without reload.
  const t0 = Date.now();
  await expect(page.getByText(/you're approved — see you there/i).first()).toBeVisible({
    timeout: 5_000,
  });
  await expect(page.getByText(/request pending · tap to cancel/i)).toHaveCount(0);
  const elapsed = Date.now() - t0;
  expect(
    elapsed,
    `UI flip should be fast (realtime, not a poll), took ${elapsed}ms`,
  ).toBeLessThan(10_000);

  // The realtime handler triggered a refetch (proves handler ran, not just DOM patch).
  expect(joinGets).toBeGreaterThan(getsBeforeApproval);

  // No navigation happened.
  expect(new URL(page.url()).pathname).toBe(`/games/${GAME_ID}`);

  await ctx.close();
});
