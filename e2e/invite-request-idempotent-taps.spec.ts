import { fulfillRows } from "./helpers/invite-postgrest";
import { PAY_FIXTURE_HOST_ID, payFixtureGameRow, serveFixtureGame } from "./helpers/pay-fixtures";
import { stubRiskAcknowledged } from "./helpers/risk-ack";
import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";
import { answerSessionChecks } from "./helpers/signed-in";

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
 * The mock server answers no POST until the whole burst has been tapped, so every
 * tap lands while the first request is still out, which is what "rapid" means
 * here. With a fixed answer delay instead (400 ms), a tap that a slow runner
 * delivered after the request had settled met "Request pending · tap to cancel"
 * and cancelled the request: the page then showed "Request Spot" again (seen
 * locally, 1 run in 10, with no added latency).
 *
 * The game row (`g2`) is served here too, as the pay specs do
 * (helpers/pay-fixtures.ts): the invite banner and the CTA wait for it, and the
 * real read queues behind the thirty-odd reads the game page sends at once,
 * which on the loaded shared sandbox took longer than the 10 seconds the
 * banner is given (CI run 45454024636, attempt 1).
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
const FAKE_HOST_ID = PAY_FIXTURE_HOST_ID;
const FUTURE_MS = Date.now() + 24 * 60 * 60 * 1000;
const INVITE_URL = `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}&exp=${FUTURE_MS}`;
/** After the burst, how long a request still on its way may take to reach the mock server and be counted. */
const LATE_POST_GRACE_MS = 700;

async function restoreSession(page: Page) {
  // Answer the session checks every load starts (GET /auth/v1/user and the root gate's
  // age, onboarding and child-status server functions) from the injected session, as the
  // pay specs do. They are not what this spec is about, and each signed-in load
  // otherwise sends the shared sandbox 8-13 requests for them. See helpers/signed-in.ts.
  await answerSessionChecks(page);
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
  // Opened once every tap of the burst has been delivered; no POST is answered before.
  let endBurst!: () => void;
  const burstDone = new Promise<void>((resolve) => (endBurst = resolve));
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

        // Keep the request out until the burst is over, so every tap overlaps it.
        await burstDone;

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
          await fulfillRows(route, [existing], { status: 201 });
          return;
        }

        const row = makeRow(key);
        rowsByKey.set(key, row);
        await fulfillRows(route, [row], { status: 201 });
        return;
      }

      return route.fallback();
    },
  );

  await serveFixtureGame(page, payFixtureGameRow(GAME_ID));
  await stubRiskAcknowledged(page);
  await restoreSession(page);
  await page.goto(INVITE_URL, { waitUntil: "domcontentloaded" });

  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });

  const cta = page.getByRole("button", { name: /request spot/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });

  // Fire a burst of rapid taps. Even if the client's in-flight guard swallows
  // most of them, any POST that DOES reach the server must dedupe. The taps go
  // to the button element itself: its label changes after the first tap, and a
  // locator by label would stop finding it.
  const button = await cta.elementHandle();
  expect(button, "the Request Spot button").not.toBeNull();
  await Promise.all(
    Array.from({ length: 5 }, () =>
      button!.click({ force: true, noWaitAfter: true, timeout: 5_000 }).catch(() => {}),
    ),
  );

  // The pending UI shows at once (optimistic), before the POST is sent.
  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByRole("button", { name: /^request spot/i })).toHaveCount(0);

  // The POST goes out once the app has asked the auth server who is signed in
  // (createJoinRequest), which a loaded sandbox can take seconds to answer.
  await expect
    .poll(() => joinPosts.length, { timeout: 10_000, message: "no join_requests POST was sent" })
    .toBeGreaterThanOrEqual(1);

  // Every tap is in: answer the request(s) now, and wait for the page to say it was sent.
  endBurst();
  await expect(page.getByText(/request sent\. the host will review it\./i).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible();

  // Give a POST still on its way from the burst the moment it needs to be counted.
  await page.waitForTimeout(LATE_POST_GRACE_MS);

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
