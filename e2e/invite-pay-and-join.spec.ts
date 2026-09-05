import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: tapping a `game_invite` notification for a paid game must
 * (a) navigate to /games/$gameId with `invite=1` + `from=<hostId>` preserved,
 * (b) render the "Pay & join" copy in the invite banner, and
 * (c) tapping the paid CTA routes to the checkout page
 *     (/games/$gameId/pay) with BOTH invite=1 and from=<hostId> preserved
 *     in the URL.
 *
 * game_payment_settings is mocked so the client sees a paid, no-approval
 * game owned by FAKE_HOST_ID. Auto-skips without a restored session.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2";
const FAKE_HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
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

function tableUrl(url: string, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
}

test("tapping invite -> Pay & join CTA routes to checkout with preserved invite params", async ({
  browser,
}) => {
  const userId = sessionUserId();
  const link = `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}`;
  const notifTitle = `E2E pay-and-join invite ${Date.now()}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Paid, no-approval settings owned by FAKE_HOST_ID.
  await page.route(
    (url) => tableUrl(url, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const settings = [
        {
          id: "mock-settings-id",
          game_id: GAME_ID,
          host_id: FAKE_HOST_ID,
          entry_fee: ENTRY_FEE,
          accepted_method_ids: [],
          payment_deadline: null,
          refund_policy: null,
          payment_instructions: null,
          requires_approval: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": "0-0/1" },
        body: JSON.stringify(settings),
      });
    },
  );
  // No existing submissions or join requests for this viewer.
  await page.route(
    (url) => tableUrl(url, "payment_submissions"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );
  await page.route(
    (url) => tableUrl(url, "join_requests"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );
  // Payment methods list on the pay page — return empty so the page renders
  // without needing a full method fixture. We only care about the URL landing.
  await page.route(
    (url) => tableUrl(url, "payment_methods"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  await restoreSession(page);

  // Seed the invite notification for the viewer.
  const insertRes = await page.evaluate(
    async ({ userId, title, link }) => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const { error } = await mod.supabase.from("notifications").insert({
        user_id: userId,
        type: "game_invite",
        title,
        body: "Soccer · Test Field",
        link,
      } as any);
      return error ? { ok: false, message: error.message } : { ok: true };
    },
    { userId, title: notifTitle, link },
  );
  expect(insertRes.ok, `seed insert failed: ${(insertRes as any).message ?? ""}`).toBe(true);

  // Open Alerts and tap the invite.
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  const item = page.getByText(notifTitle, { exact: false }).first();
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();

  // URL preserves both invite params on landing.
  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${GAME_ID}` &&
      u.searchParams.get("invite") === "1" &&
      u.searchParams.get("from") === FAKE_HOST_ID,
    { timeout: 10_000 },
  );

  // Banner reflects the paid CTA copy.
  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(/Pay & join/i);

  // CTA button — paid variant shows "Pay host · $X".
  const cta = page.getByRole("button", { name: /pay host/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  // Should route to the checkout page with BOTH invite params preserved.
  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${GAME_ID}/pay` &&
      u.searchParams.get("invite") === "1" &&
      u.searchParams.get("from") === FAKE_HOST_ID,
    { timeout: 10_000 },
  );

  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).toBe(`/games/${GAME_ID}/pay`);
  expect(finalUrl.searchParams.get("invite")).toBe("1");
  expect(finalUrl.searchParams.get("from")).toBe(FAKE_HOST_ID);

  await ctx.close();
});
