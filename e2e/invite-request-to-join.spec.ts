import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: tapping a `game_invite` notification for an approval-gated game must
 * (a) navigate to /games/$gameId with `invite=1` + `from=<hostId>` preserved,
 * (b) render the "Request to join" CTA in the sticky action bar, and
 * (c) POST to the join_requests REST endpoint with the correct game_id +
 *     host_id (from the deep link) while the URL still carries both invite
 *     params after the CTA fires.
 *
 * Reads of game_payment_settings and join_requests are mocked so this test
 * is hermetic and doesn't depend on host-side seeded config. The join
 * request POST is intercepted mid-flight to inspect the payload and to
 * fulfill without touching the database.
 *
 * Auto-skips without a restored Supabase session.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const GAME_ID = "g2"; // sample-data soccer game — free/no-approval by default
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

/** Match Supabase REST reads/writes against a specific table. */
function tableUrl(url: string, table: string) {
  return String(url).includes(`/rest/v1/${table}`);
}

test("tapping invite -> Request to join CTA posts correct payload with preserved invite params", async ({
  browser,
}) => {
  const userId = sessionUserId();
  const link = `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}`;
  const notifTitle = `E2E request-to-join invite ${Date.now()}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // ---- REST mocks (installed BEFORE session restore so the app never sees real reads).
  // Mock game_payment_settings so the client thinks this game requires approval
  // and is owned by FAKE_HOST_ID.
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
          requires_approval: true,
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
  // No existing join request or payment submission for this viewer.
  await page.route(
    (url) => tableUrl(url, "payment_submissions"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  // Capture the join_requests POST payload.
  let joinPost: { body: any; urlAtRequest: string } | null = null;
  await page.route(
    (url) => tableUrl(url, "join_requests"),
    async (route) => {
      const req = route.request();
      if (req.method() === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      if (req.method() === "POST") {
        let parsed: any = null;
        try {
          parsed = JSON.parse(req.postData() ?? "null");
        } catch {
          /* ignore */
        }
        joinPost = { body: parsed, urlAtRequest: page.url() };
        const row = {
          id: "mock-join-id",
          game_id: GAME_ID,
          host_id: FAKE_HOST_ID,
          player_id: userId,
          status: "pending",
          message: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
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

  // Invite banner reflects approval-gated CTA copy.
  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });
  await expect(banner).toContainText(/Request to join/i);

  // CTA button shows "Request to join · N spot(s) left".
  const cta = page.getByRole("button", { name: /request to join/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  // Wait for the intercepted POST to be captured.
  await expect
    .poll(() => joinPost, { timeout: 10_000, message: "join_requests POST never fired" })
    .not.toBeNull();

  // Payload targets the correct game + host from the deep link.
  expect(joinPost!.body).toBeTruthy();
  expect(joinPost!.body.game_id).toBe(GAME_ID);
  expect(joinPost!.body.host_id).toBe(FAKE_HOST_ID);
  // status is enforced server-side to `pending`; either omitted or explicit is fine.
  if (joinPost!.body.status !== undefined) {
    expect(joinPost!.body.status).toBe("pending");
  }

  // Invite params must survive the CTA click (no navigation strips them).
  const atRequest = new URL(joinPost!.urlAtRequest);
  expect(atRequest.pathname).toBe(`/games/${GAME_ID}`);
  expect(atRequest.searchParams.get("invite")).toBe("1");
  expect(atRequest.searchParams.get("from")).toBe(FAKE_HOST_ID);

  // And still present after the click settles.
  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).toBe(`/games/${GAME_ID}`);
  expect(finalUrl.searchParams.get("invite")).toBe("1");
  expect(finalUrl.searchParams.get("from")).toBe(FAKE_HOST_ID);

  await ctx.close();
});
