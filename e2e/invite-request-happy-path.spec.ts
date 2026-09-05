import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E happy path: a well-formed, non-expired invite deep-link on an
 * approval-gated game lets the viewer submit a join request and lands
 * them on the correct post-request UI:
 *
 *   - POST /rest/v1/join_requests fires with the correct game_id + host_id
 *   - success toast surfaces ("Request sent…")
 *   - the "Waiting for host approval" status banner renders
 *   - the sticky CTA flips to "Request pending · Tap to cancel"
 *   - the invite=1 and from=<hostId> params remain on the URL
 *   - the exp param (well-formed, future) is preserved
 *   - the "Invite expired" banner is NOT shown
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
const FUTURE_MS = Date.now() + 24 * 60 * 60 * 1000; // 24h from now

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

test("well-formed invite → Request to join succeeds and shows pending UI with params preserved", async ({
  browser,
}) => {
  const userId = sessionUserId();

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ---- REST mocks (install BEFORE session restore) ----
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

  // Return empty until the viewer POSTs; then return the pending row so the
  // UI advances to the post-request state.
  let joinPost: { body: any; urlAtRequest: string } | null = null;
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
          body: JSON.stringify(joinPost ? [pendingRow()] : []),
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
        joinPost = { body: parsed, urlAtRequest: page.url() };
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { "content-range": "0-0/1" },
          body: JSON.stringify([pendingRow()]),
        });
        return;
      }
      return route.fallback();
    },
  );

  await restoreSession(page);

  // Land directly on the game with a well-formed, non-expired invite.
  await page.goto(`/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}&exp=${FUTURE_MS}`, {
    waitUntil: "domcontentloaded",
  });

  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${GAME_ID}` &&
      u.searchParams.get("invite") === "1" &&
      u.searchParams.get("from") === FAKE_HOST_ID &&
      u.searchParams.get("exp") === String(FUTURE_MS),
    { timeout: 10_000 },
  );

  // Non-expired: the normal invite banner shows and the expired banner does NOT.
  await expect(page.getByTestId("invite-expired-banner")).toHaveCount(0);
  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(/Request to join/i);

  // Fire the CTA.
  const cta = page.getByRole("button", { name: /request to join/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  // POST captured with correct payload.
  await expect
    .poll(() => joinPost, { timeout: 10_000, message: "join_requests POST never fired" })
    .not.toBeNull();
  expect(joinPost!.body.game_id).toBe(GAME_ID);
  expect(joinPost!.body.host_id).toBe(FAKE_HOST_ID);
  if (joinPost!.body.status !== undefined) {
    expect(joinPost!.body.status).toBe("pending");
  }

  // Success toast surfaces.
  await expect(page.getByText(/request sent/i).first()).toBeVisible({ timeout: 5_000 });

  // Post-request UI: pending status banner.
  const pendingBanner = page
    .getByRole("status")
    .filter({ hasText: /waiting for host approval/i })
    .first();
  await expect(pendingBanner).toBeVisible({ timeout: 10_000 });
  await expect(pendingBanner).toContainText(/spot isn't held/i);

  // Sticky action flips to the cancel-pending state.
  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // Invite params (including exp) survive the whole flow.
  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).toBe(`/games/${GAME_ID}`);
  expect(finalUrl.searchParams.get("invite")).toBe("1");
  expect(finalUrl.searchParams.get("from")).toBe(FAKE_HOST_ID);
  expect(finalUrl.searchParams.get("exp")).toBe(String(FUTURE_MS));

  // Expired banner never rendered at any point.
  await expect(page.getByTestId("invite-expired-banner")).toHaveCount(0);

  await ctx.close();
});
