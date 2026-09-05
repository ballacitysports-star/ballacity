import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * E2E: complete the (mocked) payment verification and confirm the viewer is
 * marked as joined on the game page while invite=1 & from params survive.
 *
 * Flow:
 *   1. Seed a `game_invite` notification and tap it → /games/$gameId with invite params.
 *   2. Pay host → /games/$gameId/pay (invite params preserved).
 *   3. Pick method + "I have paid" → payment_submissions POST.
 *   4. Flip the mocked submission row from `pending` to `verified` (host approves).
 *   5. Navigate back to /games/$gameId?invite=1&from=<hostId>.
 *   6. Assert the join CTA reads "Confirmed · Tap to leave" AND both invite
 *      params are still on the URL.
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
const SUB_ID = "99999999-aaaa-bbbb-cccc-dddddddddddd";
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

test("invite → Pay & join → host-verified → Confirmed on game page (invite params preserved)", async ({
  browser,
}) => {
  const userId = sessionUserId();
  const link = `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}`;
  const notifTitle = `E2E pay-join-verified ${Date.now()}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // Paid, no-approval settings.
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

  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: Route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    },
  );

  // payment_submissions state machine:
  //   before POST → []
  //   after POST → [{ ...status }] where subStatus flips from "pending" to "verified"
  //   once we simulate host verification.
  let submitted = false;
  let subStatus: "pending" | "verified" = "pending";
  await page.route(
    (u) => isTable(u, "payment_submissions"),
    async (route: Route) => {
      const method = route.request().method();
      if (method === "POST") {
        submitted = true;
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify([{ id: SUB_ID }]),
        });
        return;
      }
      if (method === "GET") {
        const rows = submitted
          ? [
              {
                id: SUB_ID,
                game_id: GAME_ID,
                host_id: FAKE_HOST_ID,
                player_id: userId,
                payment_method_id: METHOD_ID,
                payment_type: "venmo",
                screenshot_path: null,
                transaction_reference: null,
                notes: null,
                status: subStatus,
                reviewer_notes: subStatus === "verified" ? "Confirmed by host" : null,
                submitted_at: new Date().toISOString(),
                reviewed_at: subStatus === "verified" ? new Date().toISOString() : null,
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

  // Seed invite notification.
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

  // Tap invite.
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  const item = page.getByText(notifTitle, { exact: false }).first();
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();

  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${GAME_ID}` &&
      u.searchParams.get("invite") === "1" &&
      u.searchParams.get("from") === FAKE_HOST_ID,
    { timeout: 10_000 },
  );

  // Pay host → /pay.
  await page
    .getByRole("button", { name: /pay host/i })
    .first()
    .click();
  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${GAME_ID}/pay` &&
      u.searchParams.get("invite") === "1" &&
      u.searchParams.get("from") === FAKE_HOST_ID,
    { timeout: 10_000 },
  );

  // Pick venmo + submit proof.
  await page.getByRole("button", { name: /venmo/i }).first().click();
  const submitBtn = page.getByRole("button", { name: /i have paid/i });
  await expect(submitBtn).toBeVisible({ timeout: 10_000 });
  const insertReq = page.waitForRequest(
    (req) => req.method() === "POST" && isTable(req.url(), "payment_submissions"),
    { timeout: 10_000 },
  );
  await submitBtn.click();
  await insertReq;

  // Pending-verification state renders on /pay.
  await expect(page.getByText(/pending verification/i).first()).toBeVisible({ timeout: 10_000 });

  // Host verifies the payment (flip the mocked status).
  subStatus = "verified";

  // Navigate back to the game page with invite params intact.
  await page.goto(`/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}`, {
    waitUntil: "domcontentloaded",
  });

  // Confirmed CTA renders — user is marked as joined via host-verified payment.
  const confirmedCta = page.getByRole("button", { name: /confirmed.*tap to leave/i });
  await expect(confirmedCta).toBeVisible({ timeout: 15_000 });

  // Invite params still preserved on the game page URL.
  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).toBe(`/games/${GAME_ID}`);
  expect(finalUrl.searchParams.get("invite")).toBe("1");
  expect(finalUrl.searchParams.get("from")).toBe(FAKE_HOST_ID);

  await ctx.close();
});
