import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: opening an invite deeplink to an unpaid (free, no-approval) game and
 * tapping the join CTA must (a) land on /games/$gameId with `invite=1` +
 * `from=<hostId>` preserved on entry, (b) render the "Join Run" CTA in the
 * sticky action bar, and (c) after tapping the CTA, keep the user on the
 * same game detail page with BOTH invite params still preserved in the URL.
 *
 * Sibling to invite-deeplink-to-pay.spec.ts (paid CTA → /pay) and
 * invite-request-to-join.spec.ts (approval-gated CTA). This locks the
 * free-game path: joining must NOT navigate away from the invite context.
 *
 * Auto-skips without a restored Supabase session.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g1"; // sample-data free/no-approval game
const FAKE_HOST_ID = "11111111-2222-3333-4444-555555555555";

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

function tableUrl(url: string | URL, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
}

test("opening an invite deeplink to an unpaid game -> Join CTA keeps invite params on the detail page", async ({
  browser,
}) => {
  const userId = sessionUserId();
  const deeplink = `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Free, no-approval settings owned by FAKE_HOST_ID.
  await page.route(
    (url) => tableUrl(url, "game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const settings = [
        {
          id: "mock-settings-id",
          game_id: GAME_ID,
          host_id: FAKE_HOST_ID,
          entry_fee: 0,
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

  // Capture the game_participants insert triggered by the free-join CTA.
  let joinInsert: { body: any; urlAtRequest: string } | null = null;
  await page.route(
    (url) => tableUrl(url, "game_participants"),
    async (route) => {
      const req = route.request();
      const method = req.method();
      if (method === "GET" || method === "HEAD") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      if (method === "POST") {
        let parsed: any = null;
        try {
          parsed = JSON.parse(req.postData() ?? "null");
        } catch {
          /* ignore */
        }
        joinInsert = { body: parsed, urlAtRequest: page.url() };
        const rowArr = Array.isArray(parsed) ? parsed : [parsed];
        const rows = rowArr.map((r: any, i: number) => ({
          id: `mock-participant-${i}`,
          game_id: GAME_ID,
          user_id: userId,
          position: r?.position ?? null,
          created_at: new Date().toISOString(),
          ...r,
        }));
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          headers: { "content-range": "0-0/1" },
          body: JSON.stringify(rows),
        });
        return;
      }
      return route.fallback();
    },
  );

  await restoreSession(page);

  // Open the invite deeplink directly.
  await page.goto(deeplink, { waitUntil: "domcontentloaded" });

  // URL preserves both invite params on landing.
  await page.waitForURL(
    (u) => {
      const invite = u.searchParams.get("invite");
      return (
        u.pathname === `/games/${GAME_ID}` &&
        (invite === "1" || invite === "true") &&
        u.searchParams.get("from") === FAKE_HOST_ID
      );
    },
    { timeout: 10_000 },
  );

  // Invite banner reflects the free-join CTA copy.
  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(/tap\s+[“"']?Join[”"']?\s+below/i);
  await expect(banner).not.toContainText(/Request to join/i);
  await expect(banner).not.toContainText(/Pay & join/i);

  // CTA button shows "Join Run · N spots left".
  const cta = page.getByRole("button", { name: /join free/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  // The join insert should fire...
  await expect
    .poll(() => joinInsert, { timeout: 10_000, message: "game_participants insert never fired" })
    .not.toBeNull();
  expect(joinInsert!.body).toBeTruthy();
  const inserted = Array.isArray(joinInsert!.body) ? joinInsert!.body[0] : joinInsert!.body;
  expect(inserted.game_id).toBe(GAME_ID);
  expect(inserted.user_id).toBe(userId);

  // ...without navigating away — still on the game detail page.
  const atRequest = new URL(joinInsert!.urlAtRequest);
  expect(atRequest.pathname).toBe(`/games/${GAME_ID}`);
  expect(["1", "true"]).toContain(atRequest.searchParams.get("invite"));
  expect(atRequest.searchParams.get("from")).toBe(FAKE_HOST_ID);

  // Give the router a beat to settle, then re-check the URL.
  await page.waitForTimeout(200);
  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).toBe(`/games/${GAME_ID}`);
  expect(["1", "true"]).toContain(finalUrl.searchParams.get("invite"));
  expect(finalUrl.searchParams.get("from")).toBe(FAKE_HOST_ID);

  await ctx.close();
});
