import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: opening the same valid invite twice must not allow a second
 * "Request to join" submission.
 *
 * Flow:
 *   1. Land on /games/$gameId with a well-formed, non-expired invite and
 *      submit the join request (POST #1 fires; pending UI appears).
 *   2. Navigate away and re-open the exact same invite deep link.
 *   3. The app must reflect the existing pending request:
 *        - "Waiting for host approval" status banner
 *        - Sticky CTA reads "Request pending · Tap to cancel"
 *        - No "Request to join" CTA is offered
 *   4. Attempting to click the pending CTA must NOT fire a second POST to
 *      /rest/v1/join_requests.
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

test("re-opening a valid invite after submitting blocks a second join request", async ({
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

  // Track every POST to join_requests. Once the first one lands, subsequent
  // GETs return the pending row so the UI reflects the existing request.
  const joinPosts: Array<{ body: any; urlAtRequest: string }> = [];
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
          body: JSON.stringify(joinPosts.length > 0 ? [pendingRow()] : []),
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
        joinPosts.push({ body: parsed, urlAtRequest: page.url() });
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

  // ---- Visit #1: submit the join request. ----
  await page.goto(INVITE_URL, { waitUntil: "domcontentloaded" });

  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });

  const cta = page.getByRole("button", { name: /request to join/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  await expect
    .poll(() => joinPosts.length, {
      timeout: 10_000,
      message: "first join_requests POST never fired",
    })
    .toBe(1);

  await expect(page.getByText(/request pending · tap to cancel/i).first()).toBeVisible({
    timeout: 10_000,
  });

  // ---- Navigate away, then re-open the SAME invite link. ----
  await page.goto("/discover", { waitUntil: "domcontentloaded" });
  await page.goto(INVITE_URL, { waitUntil: "domcontentloaded" });

  // Existing pending state must be reflected on re-entry.
  const pendingBanner = page
    .getByRole("status")
    .filter({ hasText: /waiting for host approval/i })
    .first();
  await expect(pendingBanner).toBeVisible({ timeout: 10_000 });

  // Sticky action shows the pending/cancel state — NOT "Request to join".
  const pendingCta = page.getByText(/request pending · tap to cancel/i).first();
  await expect(pendingCta).toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("button", { name: /^request to join/i })).toHaveCount(0);

  const postCountBeforeSecondTap = joinPosts.length;
  expect(postCountBeforeSecondTap).toBe(1);

  // Tapping the pending CTA must not create a duplicate join_requests row.
  await pendingCta.click().catch(() => {
    /* cancel confirm dialogs are fine to ignore */
  });

  // Give the app a beat to (not) fire a second POST.
  await page.waitForTimeout(1_000);
  expect(joinPosts.length, "second Request to join submission must be blocked").toBe(
    postCountBeforeSecondTap,
  );

  // Params still preserved.
  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).toBe(`/games/${GAME_ID}`);
  expect(finalUrl.searchParams.get("invite")).toBe("1");
  expect(finalUrl.searchParams.get("from")).toBe(FAKE_HOST_ID);
  expect(finalUrl.searchParams.get("exp")).toBe(String(FUTURE_MS));

  await ctx.close();
});
