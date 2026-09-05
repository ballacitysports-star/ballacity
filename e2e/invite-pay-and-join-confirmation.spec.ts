import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E: end-to-end Pay & join flow starting from an invite notification.
 *
 * Steps:
 *   1. Seed a `game_invite` notification for the signed-in user.
 *   2. Tap it in /notifications → lands on /games/$gameId with invite=1 & from preserved.
 *   3. Click the paid CTA → routes to /games/$gameId/pay with the same invite params.
 *   4. Pick a payment method and click "I have paid" (submit proof without a file).
 *   5. Assert the confirmation state renders ("Pending verification") AND the URL
 *      still carries invite=1 and from=<hostId>.
 *
 * game_payment_settings / host_payment_methods / payment_submissions are mocked
 * so the flow is fully deterministic without any host-side seeding.
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
const METHOD_ID = "77777777-8888-9999-aaaa-bbbbbbbbbbbb";
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

const isTable = (url: string, table: string) => String(url).includes(`/rest/v1/${table}`);

test("invite → Pay & join → confirmation with invite params preserved", async ({ browser }) => {
  const userId = sessionUserId();
  const link = `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}`;
  const notifTitle = `E2E pay-and-join confirmation ${Date.now()}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Paid, no-approval settings owned by FAKE_HOST_ID.
  await page.route(
    (u) => isTable(u, "game_payment_settings"),
    async (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
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
        ]),
      });
    },
  );

  // One enabled payment method for the host.
  await page.route(
    (u) => isTable(String(u), "host_payment_methods") || String(u).includes("/rest/v1/rpc/get_game_host_payment_methods"),
    async (route: Route) => {
      if (!["GET","POST"].includes(route.request().method())) return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: METHOD_ID,
            host_id: FAKE_HOST_ID,
            payment_type: "venmo",
            label: "Venmo",
            username: "@fakehost",
            contact_info: null,
            payment_url: null,
            instructions: null,
            is_enabled: true,
            created_at: new Date().toISOString(),
          },
        ]),
      });
    },
  );

  // No existing join_requests for this viewer.
  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  // payment_submissions: empty until the POST succeeds, then one pending row.
  let submitted = false;
  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route: Route) => {
      const method = route.request().method();
      if (method === "POST") {
        submitted = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify([{ id: "mock-sub-id" }]),
        });
        return;
      }
      if (method === "GET") {
        const rows = submitted
          ? [
              {
                id: "mock-sub-id",
                game_id: GAME_ID,
                host_id: FAKE_HOST_ID,
                player_id: userId,
                payment_method_id: METHOD_ID,
                payment_type: "venmo",
                screenshot_path: null,
                transaction_reference: null,
                notes: null,
                status: "pending",
                reviewer_notes: null,
                submitted_at: new Date().toISOString(),
              },
            ]
          : [];
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(rows),
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

  // Landing on game detail with both invite params preserved.
  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${GAME_ID}` &&
      u.searchParams.get("invite") === "1" &&
      u.searchParams.get("from") === FAKE_HOST_ID,
    { timeout: 10_000 },
  );

  // Paid CTA → /pay with invite params preserved.
  const payCta = page.getByRole("button", { name: /pay host/i }).first();
  await expect(payCta).toBeVisible({ timeout: 10_000 });
  await payCta.click();

  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${GAME_ID}/pay` &&
      u.searchParams.get("invite") === "1" &&
      u.searchParams.get("from") === FAKE_HOST_ID,
    { timeout: 10_000 },
  );

  // Pick the mocked payment method.
  const methodBtn = page.getByRole("button", { name: /venmo/i }).first();
  await expect(methodBtn).toBeVisible({ timeout: 10_000 });
  await methodBtn.click();

  // Submit proof without a file — no upload path, just an insert.
  const submitBtn = page.getByRole("button", { name: /i have paid/i });
  await expect(submitBtn).toBeVisible({ timeout: 10_000 });

  const insertReq = page.waitForRequest(
    (req) => req.method() === "POST" && isTable(req.url(), "payment_submissions"),
    { timeout: 10_000 },
  );
  await submitBtn.click();
  const req = await insertReq;

  // Verify the insert payload matches the deep-linked game + host.
  const payload = JSON.parse(req.postData() || "{}");
  const row = Array.isArray(payload) ? payload[0] : payload;
  expect(row.game_id).toBe(GAME_ID);
  expect(row.host_id).toBe(FAKE_HOST_ID);
  expect(row.player_id).toBe(userId);
  expect(row.payment_method_id).toBe(METHOD_ID);

  // Confirmation state renders (pending verification submission list item).
  const pending = page.getByText(/pending verification/i).first();
  await expect(pending).toBeVisible({ timeout: 10_000 });

  // URL STILL preserves invite=1 and from=<hostId> at the confirmation step.
  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).toBe(`/games/${GAME_ID}/pay`);
  expect(finalUrl.searchParams.get("invite")).toBe("1");
  expect(finalUrl.searchParams.get("from")).toBe(FAKE_HOST_ID);

  await ctx.close();
});
