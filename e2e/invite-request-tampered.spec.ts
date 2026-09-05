import { test, expect, type Page, type Route as PWRoute } from "@playwright/test";

/**
 * E2E: the "Request to join" CTA on an approval-gated game must show an error
 * and NOT fire a join_requests POST when the invite deep-link is malformed:
 *
 *   (a) `invite=1` present but `from` is missing.
 *   (b) `invite=1` + `from` present but `from` doesn't match the true host.
 *
 * Both variants seed a `game_invite` notification whose `link` is the
 * tampered URL, tap it from /notifications, click "Request to join", and
 * assert:
 *   - a Sonner error toast renders ("invalid or has been tampered with"),
 *   - no POST to /rest/v1/join_requests is ever made,
 *   - the tampered/missing invite params still stick on the URL (the app
 *     doesn't silently rewrite them).
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
const REAL_HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TAMPERED_HOST_ID = "ffffffff-0000-1111-2222-333333333333";

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

async function installMocks(page: Page, onJoinPost: () => void) {
  // Approval-gated settings owned by REAL_HOST_ID.
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
            host_id: REAL_HOST_ID,
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
  await page.route(
    (u) => isTable(u, "join_requests"),
    async (route: PWRoute) => {
      const method = route.request().method();
      if (method === "GET") {
        await route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
        return;
      }
      if (method === "POST") {
        // Fail loudly — this test asserts the POST never fires.
        onJoinPost();
        await route.fulfill({
          status: 201,
          contentType: "application/json",
          body: JSON.stringify([{ id: "should-not-happen" }]),
        });
        return;
      }
      return route.fallback();
    },
  );
}

async function seedInvite(page: Page, userId: string, title: string, link: string) {
  const res = await page.evaluate(
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
    { userId, title, link },
  );
  expect(res.ok, `seed insert failed: ${(res as any).message ?? ""}`).toBe(true);
}

async function runTamperedCase(
  browser: import("@playwright/test").Browser,
  variant: "missing-from" | "wrong-from",
) {
  const userId = sessionUserId();
  const suffix = variant === "missing-from" ? "" : `&from=${TAMPERED_HOST_ID}`;
  const link = `/games/${GAME_ID}?invite=1${suffix}`;
  const notifTitle = `E2E tampered invite [${variant}] ${Date.now()}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  let joinPostFired = false;
  await installMocks(page, () => {
    joinPostFired = true;
  });
  await restoreSession(page);
  await seedInvite(page, userId, notifTitle, link);

  // Tap invite in Alerts.
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  const item = page.getByText(notifTitle, { exact: false }).first();
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();

  // Land on game with the tampered/missing params exactly as encoded.
  await page.waitForURL(
    (u) => u.pathname === `/games/${GAME_ID}` && u.searchParams.get("invite") === "1",
    { timeout: 10_000 },
  );

  // Click "Request to join".
  const cta = page.getByRole("button", { name: /request to join/i }).first();
  await expect(cta).toBeVisible({ timeout: 10_000 });
  await cta.click();

  // Error toast surfaces.
  const toast = page.getByText(/invalid or has been tampered with/i).first();
  await expect(toast).toBeVisible({ timeout: 5_000 });

  // Give any (illegitimate) network fire a chance to land before asserting no POST.
  await page.waitForTimeout(500);
  expect(joinPostFired, "join_requests POST must NOT fire for a tampered invite").toBe(false);

  // URL still reflects the tampered/missing invite params — the app didn't
  // silently rewrite the link.
  const finalUrl = new URL(page.url());
  expect(finalUrl.pathname).toBe(`/games/${GAME_ID}`);
  expect(finalUrl.searchParams.get("invite")).toBe("1");
  if (variant === "missing-from") {
    expect(finalUrl.searchParams.get("from")).toBeNull();
  } else {
    expect(finalUrl.searchParams.get("from")).toBe(TAMPERED_HOST_ID);
  }

  await ctx.close();
}

test("invite tampered: missing `from` → CTA errors and no join_requests POST", async ({
  browser,
}) => {
  await runTamperedCase(browser, "missing-from");
});

test("invite tampered: wrong `from` → CTA errors and no join_requests POST", async ({
  browser,
}) => {
  await runTamperedCase(browser, "wrong-from");
});
