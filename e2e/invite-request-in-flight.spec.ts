import { stickyRequestCta } from "./helpers/invite-join-cta";
import { fulfillRows } from "./helpers/invite-postgrest";
import { stubRiskAcknowledged } from "./helpers/risk-ack";
import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: double-tapping "Request to join" while the first POST is still
 * in flight must not create a duplicate join_requests row.
 *
 * Flow:
 *   1. Land on /games/$gameId with a well-formed, non-expired invite.
 *   2. Delay the POST /rest/v1/join_requests response by ~1.5s.
 *   3. Click the CTA, then click it again immediately (before the first
 *      response resolves).
 *   4. Assert only ONE POST reaches the network.
 *   5. After the response resolves, the pending UI must render. (The CTA
 *      flips to "Request pending" optimistically on the tap and stays
 *      disabled while the request is in flight.)
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
const POST_DELAY_MS = 1_500;

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

test("double-tapping Request to join while the first POST is in flight blocks the second submission", async ({
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

  const joinPosts: Array<{ body: any; at: number }> = [];
  let firstPostResolvedAt = 0;
  const pendingRow = () => ({
    id: "mock-join-id",
    game_id: GAME_ID,
    host_id: FAKE_HOST_ID,
    player_id: userId,
    status: "pending",
    message: null,
    reviewer_notes: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: PWRoute) => {
      const req = route.request();
      const method = req.method();
      if (method === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(firstPostResolvedAt > 0 ? [pendingRow()] : []),
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
        joinPosts.push({ body: parsed, at: Date.now() });
        // Hold the response so the second tap happens while the first is in flight.
        await new Promise((r) => setTimeout(r, POST_DELAY_MS));
        firstPostResolvedAt = Date.now();
        await fulfillRows(route, [pendingRow()], { status: 201 });
        return;
      }
      return route.fallback();
    },
  );

  await stubRiskAcknowledged(page);
  await restoreSession(page);

  await page.goto(INVITE_URL, { waitUntil: "domcontentloaded" });

  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });

  // The same sticky button through both labels: it reads "Request pending"
  // while the first request is in flight.
  const cta = stickyRequestCta(page);
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await expect(cta).toHaveAccessibleName(/^request spot/i);

  // Fire two rapid clicks — the second one happens while the first POST
  // is still hanging server-side.
  await cta.click({ force: true });
  await cta.click({ force: true, noWaitAfter: true }).catch(() => {
    /* button may already be disabled/replaced */
  });

  // While in flight, the first POST should already have registered.
  await expect
    .poll(() => joinPosts.length, { timeout: 5_000, message: "first POST never fired" })
    .toBeGreaterThanOrEqual(1);

  // The in-flight response must not have resolved yet.
  expect(firstPostResolvedAt, "first POST resolved before we could double-tap").toBe(0);
  // The CTA already reads "Request pending" (optimistic) but stays disabled
  // until the server answers, so a tap now can neither re-send nor cancel.
  await expect(cta).toHaveAccessibleName(/^request pending/i);
  await expect(cta).toBeDisabled();

  // Fire a third click for good measure, still mid-flight.
  await cta.click({ force: true, noWaitAfter: true }).catch(() => {
    /* ignore */
  });

  // Wait for the first POST to resolve; the pending UI must still be shown
  // with the server's row (the page flips to it optimistically on the tap).
  await expect
    .poll(() => firstPostResolvedAt, { timeout: POST_DELAY_MS + 5_000 })
    .toBeGreaterThan(0);
  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible({
    timeout: 5_000,
  });

  // Give the app a beat to (not) fire any additional POSTs.
  await page.waitForTimeout(750);

  expect(joinPosts.length, `expected exactly one join_requests POST, saw ${joinPosts.length}`).toBe(
    1,
  );

  // And "Request to join" CTA is gone.
  await expect(page.getByRole("button", { name: /^request spot/i })).toHaveCount(0);

  await ctx.close();
});
