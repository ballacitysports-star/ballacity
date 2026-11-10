import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: an expired invite deep-link (`invite=1&from=<hostId>&exp=<past-ms>`)
 * must render the "Invite expired" fallback state on the game detail page —
 * NOT the normal "You're invited" banner — and the primary CTA must route the
 * viewer safely to the /discover game-discovery page instead of firing any
 * join / request / payment flow.
 *
 * We seed a `game_invite` notification carrying the expired link so the whole
 * tap-through path is exercised (Alerts → game detail). Auto-skips without a
 * restored Supabase session.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

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

const GAME_ID = "g1";
const FAKE_HOST_ID = "11111111-2222-3333-4444-555555555555";
const EXPIRED_MS = Date.now() - 60 * 60 * 1000; // 1 hour ago

test("expired invite → renders Invite expired banner, CTA routes to /discover fallback", async ({
  browser,
}) => {
  const userId = sessionUserId();
  const link = `/games/${GAME_ID}?invite=1&from=${FAKE_HOST_ID}&exp=${EXPIRED_MS}`;
  const title = `E2E expired invite ${Date.now()}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await restoreSession(page);

  // Seed the expired invite notification.
  const insertRes = await page.evaluate(
    async ({ userId, title, link }) => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const { error } = await mod.supabase.from("notifications").insert({
        user_id: userId,
        type: "game_invite",
        title,
        body: "This invite has expired.",
        link,
      } as any);
      return error ? { ok: false, message: error.message } : { ok: true };
    },
    { userId, title, link },
  );
  expect(insertRes.ok, `seed insert failed: ${(insertRes as any).message ?? ""}`).toBe(true);

  // Track any join_requests / payment_submissions writes — must NOT fire.
  const writeAttempts: string[] = [];
  await page.route("**/rest/v1/join_requests**", (route) => {
    if (route.request().method() !== "GET") writeAttempts.push("join_requests");
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });
  await page.route("**/rest/v1/payment_submissions**", (route) => {
    if (route.request().method() !== "GET") writeAttempts.push("payment_submissions");
    return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
  });

  // Tap the seeded notification from Alerts.
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  const item = page.getByText(title, { exact: false }).first();
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();

  // URL preserves the invite/from/exp params on the game detail page.
  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${GAME_ID}` &&
      ["1", "true"].includes(u.searchParams.get("invite") ?? "") &&
      u.searchParams.get("from") === FAKE_HOST_ID &&
      u.searchParams.get("exp") === String(EXPIRED_MS),
    { timeout: 10_000 },
  );

  // Expired-state banner is shown (not the normal invite banner).
  const expired = page.getByTestId("invite-expired-banner");
  await expect(expired).toBeVisible({ timeout: 10_000 });
  await expect(expired).toContainText(/invite expired/i);
  await expect(expired).toContainText(/no longer valid/i);

  // The regular "You're invited" banner must NOT render.
  const normalBanner = page.getByRole("status").filter({ hasText: /you're invited to this game/i });
  await expect(normalBanner).toHaveCount(0);

  // The fallback CTA inside the banner points at /discover.
  const fallbackCta = expired.getByRole("link", { name: /browse open games/i });
  await expect(fallbackCta).toBeVisible();
  await expect(fallbackCta).toHaveAttribute("href", "/discover");

  // Following it lands on the discovery route — the safe fallback.
  await fallbackCta.click();
  await page.waitForURL((u) => u.pathname === "/discover", { timeout: 10_000 });

  // No join / payment write ever fired from the expired-invite flow.
  expect(writeAttempts, "expired invite must not trigger join/payment writes").toEqual([]);

  await ctx.close();
});
