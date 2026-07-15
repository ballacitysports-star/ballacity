import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E: leaving a game with a verified payment must, in a single tap,
 *   1. flip the sticky CTA from "Confirmed · Tap to leave" back to
 *      "Request to join · N spots left" (approval + paid game),
 *   2. remove the viewer from the roster ("YOU" chip gone, count updates),
 *   3. hide the "Payment verified — you're on the roster" status strip
 *      and keep it hidden (guards a realtime-rehydrate regression),
 *   4. fire DELETE calls against `join_requests`, `payment_submissions`,
 *      and `game_participants` scoped to the viewer — which is exactly
 *      what clears them from the host's pending-approval list under RLS.
 *
 * Runs entirely against the local dev server with all Supabase REST
 * responses mocked via `page.route`, so no fixture DB rows are needed.
 * Auto-skips when the sandbox has not injected a Supabase session.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const METHOD_ID = "mock-method-venmo";
const JOIN_REQ_ID = "mock-join-req-id";
const SUBMISSION_ID = "mock-submission-id";

function tableUrl(url: string | URL, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
}

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

test("leaving with a verified payment flips CTA, roster, and clears host-visible rows", async ({
  browser,
}) => {
  test.setTimeout(45_000);

  const userId = (JSON.parse(SESSION_JSON!) as { user?: { id?: string } })?.user?.id;
  expect(userId, "session must contain user.id").toBeTruthy();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ---- Mutable state driving the mocks ------------------------------------
  // Flip these when the corresponding DELETE lands so subsequent GETs (and
  // realtime-triggered refetches) return the post-leave shape.
  let joinReqDeleted = false;
  let submissionDeleted = false;
  let participantDeleted = false;

  const deleteRequests = {
    join_requests: 0,
    payment_submissions: 0,
    game_participants: 0,
  };

  // ---- Static mocks -------------------------------------------------------

  // The game itself lives in sample data (`GAMES.find` fallback). Stub the
  // DB read so hydration doesn't wipe it and doesn't hit the network.
  await page.route(
    (u) => tableUrl(u, "hosted_games"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  await page.route(
    (u) => tableUrl(u, "game_payment_settings"),
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
            requires_approval: true,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
        ]),
      });
    },
  );

  await page.route(
    (u) =>
      tableUrl(u, "host_payment_methods") ||
      String(u).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    async (route) => {
      if (!["GET", "POST"].includes(route.request().method())) return route.fallback();
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

  // Profile lookups are noise for this spec.
  await page.route(
    (u) => tableUrl(u, "profiles"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  // ---- Stateful mocks -----------------------------------------------------

  // join_requests: approved row for viewer, then empty after DELETE.
  await page.route(
    (u) => tableUrl(u, "join_requests"),
    async (route: Route) => {
      const method = route.request().method();
      if (method === "GET") {
        const rows = joinReqDeleted
          ? []
          : [
              {
                id: JOIN_REQ_ID,
                game_id: GAME_ID,
                host_id: HOST_ID,
                player_id: userId,
                status: "approved",
                message: null,
                reviewer_notes: null,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                reviewed_at: new Date().toISOString(),
                idempotency_key: `join:${GAME_ID}`,
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
      if (method === "DELETE") {
        deleteRequests.join_requests += 1;
        joinReqDeleted = true;
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fallback();
    },
  );

  // payment_submissions: verified row for viewer, then empty after DELETE.
  await page.route(
    (u) => tableUrl(u, "payment_submissions"),
    async (route: Route) => {
      const method = route.request().method();
      if (method === "GET") {
        const rows = submissionDeleted
          ? []
          : [
              {
                id: SUBMISSION_ID,
                player_id: userId,
                game_id: GAME_ID,
                host_id: HOST_ID,
                payment_method_id: METHOD_ID,
                payment_type: "venmo",
                screenshot_path: null,
                transaction_reference: null,
                paid_amount: 15,
                paid_at: new Date().toISOString(),
                notes: null,
                status: "verified",
                reviewer_notes: "Thanks — see you at the game!",
                submitted_at: new Date().toISOString(),
                reviewed_at: new Date().toISOString(),
              },
            ];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
          body: JSON.stringify(rows),
        });
      }
      if (method === "DELETE") {
        deleteRequests.payment_submissions += 1;
        submissionDeleted = true;
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fallback();
    },
  );

  // game_participants: viewer on roster, then empty after DELETE.
  await page.route(
    (u) => tableUrl(u, "game_participants"),
    async (route: Route) => {
      const method = route.request().method();
      if (method === "GET") {
        const rows = participantDeleted
          ? []
          : [
              {
                id: "mock-participant-id",
                game_id: GAME_ID,
                user_id: userId,
                joined_at: new Date().toISOString(),
                position: null,
              },
            ];
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}` },
          body: JSON.stringify(rows),
        });
      }
      if (method === "DELETE") {
        deleteRequests.game_participants += 1;
        participantDeleted = true;
        return route.fulfill({ status: 204, body: "" });
      }
      return route.fallback();
    },
  );

  // ---- Flow ---------------------------------------------------------------

  await restoreSession(page);
  await page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });

  // 1. Baseline: confirmed state visible.
  const strip = page.getByTestId("your-status-strip");
  await expect(strip).toBeVisible({ timeout: 15_000 });
  await expect(strip).toContainText(/payment verified/i);

  const cta = page.getByRole("button", { name: /confirmed · tap to leave/i });
  await expect(cta).toBeVisible({ timeout: 10_000 });

  // Roster surfaces the viewer as "YOU".
  await expect(page.getByText(/^YOU$/).first()).toBeVisible({ timeout: 10_000 });

  const baselineJoinedText = await page
    .locator("text=/^\\d+\\s*\\/\\s*\\d+$/")
    .first()
    .textContent();
  const baselineJoined = baselineJoinedText
    ? parseInt(baselineJoinedText.split("/")[0]!.trim(), 10)
    : NaN;

  // 2. Tap leave → confirm.
  await cta.click();
  const confirmBtn = page.getByRole("button", { name: /^leave game$/i });
  await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
  await confirmBtn.click();

  // 3. CTA flips back to the pre-join state (approval + paid game → "Request to join").
  await expect(
    page.getByRole("button", { name: /request to join/i }),
  ).toBeVisible({ timeout: 15_000 });

  // 4. Status strip disappears — and stays gone after a realtime rehydrate window.
  await expect(strip).toHaveCount(0, { timeout: 10_000 });
  await page.waitForTimeout(3_000);
  await expect(strip).toHaveCount(0);

  // 5. Roster "YOU" chip gone.
  await expect(page.getByText(/^YOU$/)).toHaveCount(0, { timeout: 10_000 });

  // 6. Roster header count decremented (only assert when we captured a baseline).
  if (!Number.isNaN(baselineJoined)) {
    await expect
      .poll(
        async () => {
          const t = await page
            .locator("text=/^\\d+\\s*\\/\\s*\\d+$/")
            .first()
            .textContent();
          return t ? parseInt(t.split("/")[0]!.trim(), 10) : NaN;
        },
        { timeout: 10_000, message: "roster count did not decrement after leave" },
      )
      .toBeLessThan(baselineJoined);
  }

  // 7. All three DELETEs fired — this is the contract that clears the row
  //    from the host's pending-approval list under RLS.
  expect(
    deleteRequests.join_requests,
    "join_requests DELETE must fire so host's pending list clears",
  ).toBeGreaterThan(0);
  expect(
    deleteRequests.payment_submissions,
    "payment_submissions DELETE must fire so verified row no longer rehydrates",
  ).toBeGreaterThan(0);
  expect(
    deleteRequests.game_participants,
    "game_participants DELETE must fire so viewer leaves the roster server-side",
  ).toBeGreaterThan(0);

  await ctx.close();
});
