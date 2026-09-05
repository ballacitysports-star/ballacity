import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: rapidly tapping "Request to join" must result in exactly one pending
 * join_requests row. Even if the client-side double-tap guard were bypassed
 * and multiple POSTs reached the server, the server-side idempotency key
 * (unique per (player_id, idempotency_key)) collapses them onto the same row.
 *
 * This test allows every POST through to the mock server and asserts that
 * every POST carries the same idempotency_key and that only one pending row
 * exists at the end.
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
const FUTURE_MS = Date.now() + 24 * 60 * 60 * 1000;
const INVITE_URL = `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}&exp=${FUTURE_MS}`;
const POST_DELAY_MS = 400;

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

test("rapid taps on Request-to-join create exactly one pending row (server-side idempotency)", async ({
  browser,
}) => {
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

  // Server-side row store keyed by (player_id, idempotency_key).
  const rowsByKey = new Map<string, any>();
  const joinPosts: Array<{ idempotency_key: string | null; game_id: string | null }> = [];

  const makeRow = (idempotency_key: string) => ({
    id: `mock-join-${idempotency_key}`,
    game_id: GAME_ID,
    host_id: FAKE_HOST_ID,
    player_id: userId,
    status: "pending",
    message: null,
    reviewer_notes: null,
    idempotency_key,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: PWRoute) => {
      const req = route.request();
      const method = req.method();

      if (method === "GET") {
        const rows = Array.from(rowsByKey.values());
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(rows),
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
        const body = Array.isArray(parsed) ? parsed[0] : parsed;
        const key: string | null = body?.idempotency_key ?? null;
        joinPosts.push({
          idempotency_key: key,
          game_id: body?.game_id ?? null,
        });

        // Simulate network latency so multiple rapid taps overlap.
        await new Promise((r) => setTimeout(r, POST_DELAY_MS));

        // Server-side dedupe by (player_id, idempotency_key). Missing key = reject
        // (mirrors the DB trigger which requires idempotency_key).
        if (!key) {
          await route.fulfill({
            status: 400,
            contentType: "application/json",
            body: JSON.stringify({ code: "23514", message: "idempotency_key is required." }),
          });
          return;
        }

        const existing = rowsByKey.get(key);
        if (existing) {
          // Return the same row (idempotent success).
          await route.fulfill({
            status: 201,
            contentType: "application/json",
            headers: { "content-range": "0-0/1" },
            body: JSON.stringify([existing]),
          });
          return;
        }

        const row = makeRow(key);
        rowsByKey.set(key, row);
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
  await page.goto(INVITE_URL, { waitUntil: "domcontentloaded" });

  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });

  const cta = page.getByRole("button", { name: /request to join/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });

  // Fire a burst of rapid taps. Even if the client's in-flight guard swallows
  // most of them, any POST that DOES reach the server must dedupe.
  await Promise.all([
    cta.click({ force: true, noWaitAfter: true }).catch(() => {}),
    cta.click({ force: true, noWaitAfter: true }).catch(() => {}),
    cta.click({ force: true, noWaitAfter: true }).catch(() => {}),
    cta.click({ force: true, noWaitAfter: true }).catch(() => {}),
    cta.click({ force: true, noWaitAfter: true }).catch(() => {}),
  ]);

  // Wait for the pending UI (implies at least one POST resolved successfully).
  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: /^request to join/i })).toHaveCount(0);

  // Give any late in-flight POSTs a moment to settle.
  await page.waitForTimeout(POST_DELAY_MS + 300);

  // Every POST that hit the server must have carried an idempotency_key
  // for the same game, and they must all share the same key.
  expect(joinPosts.length, "expected at least one POST").toBeGreaterThanOrEqual(1);
  for (const p of joinPosts) {
    expect(p.idempotency_key, "every POST must carry an idempotency_key").toBeTruthy();
    expect(p.game_id).toBe(GAME_ID);
  }
  const uniqueKeys = new Set(joinPosts.map((p) => p.idempotency_key));
  expect(
    uniqueKeys.size,
    `rapid taps for the same game must reuse one idempotency_key, saw ${uniqueKeys.size}: ${JSON.stringify([...uniqueKeys])}`,
  ).toBe(1);

  // Exactly one row exists on the server, regardless of how many POSTs fired.
  expect(rowsByKey.size, `expected exactly 1 pending row, server holds ${rowsByKey.size}`).toBe(1);

  const [row] = Array.from(rowsByKey.values());
  expect(row.status).toBe("pending");
  expect(row.player_id).toBe(userId);
  expect(row.game_id).toBe(GAME_ID);
  expect(row.host_id).toBe(FAKE_HOST_ID);

  await ctx.close();
});
