import { openAlertsAndTap } from "./helpers/invite-alerts";
import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: tapping a `game_invite` notification in the in-app Alerts list must
 * navigate to the deep-linked game detail page with the `invite=1` and
 * `from=<hostId>` query params preserved, and the "You're invited" banner
 * must render CTA-specific copy driven by the game's join settings
 * ("Join Run" / "Request Spot" / "Pay Host", the sticky CTA's labels).
 *
 * We seed the notification row directly via the browser Supabase client
 * (RLS: users can insert their own notifications) so the test is decoupled
 * from the sender-side flow already covered by
 * src/lib/invite-deeplink.integration.test.ts.
 *
 * Auto-skips without a restored Supabase session.
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

test("tapping an invite notification opens the game with preserved invite params + CTA copy", async ({
  browser,
}) => {
  const userId = sessionUserId();
  // A free/no-approval game (settings mocked below) — CTA should be "Join Run".
  const gameId = "g1";
  const fakeHostId = "11111111-2222-3333-4444-555555555555";
  const link = `/games/${gameId}?invite=1&from=${fakeHostId}`;
  const title = `E2E invite ${Date.now()}`;

  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  // The banner copy below comes from these mocked settings, not from g1's real
  // row, on purpose. This spec checks that a tapped invite lands on the game
  // with its params and that the banner names the CTA the settings call for.
  // g1's real settings row lives in a shared backend (the hosted sandbox in
  // CI) where other specs and seeds can change its fee or approval step, which
  // would flip the expected label without anything being wrong with invites.
  // g1's real row is still read end to end by the realtime join specs
  // (join-cross-device-*, join-realtime-cross-views), which tap the same
  // "Join Run" CTA without mocking settings.
  // Free, no-approval settings → the CTA is "Join Run".
  await page.route(
    (url) => String(url).includes("/rest/v1/game_payment_settings"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify([
          {
            id: "mock-settings-id",
            game_id: gameId,
            host_id: fakeHostId,
            entry_fee: 0,
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

  await restoreSession(page);

  // Seed a game_invite notification for the signed-in user.
  const insertRes = await page.evaluate(
    async ({ userId, title, link }) => {
      const mod = await import("/src/integrations/supabase/client.ts");
      const { error } = await mod.supabase.from("notifications").insert({
        user_id: userId,
        type: "game_invite",
        title,
        body: "Basketball · Test Court",
        link,
      } as any);
      return error ? { ok: false, message: error.message } : { ok: true };
    },
    { userId, title, link },
  );
  expect(insertRes.ok, `seed insert failed: ${(insertRes as any).message ?? ""}`).toBe(true);

  // Open Alerts and tap the seeded invite.
  await openAlertsAndTap(page, title);

  // URL must preserve both invite params exactly.
  await page.waitForURL(
    (u) =>
      u.pathname === `/games/${gameId}` &&
      ["1", "true"].includes(u.searchParams.get("invite") ?? "") &&
      u.searchParams.get("from") === fakeHostId,
    { timeout: 10_000 },
  );

  // Invite banner renders...
  const banner = page
    .getByRole("status")
    .filter({ hasText: /you're invited to this game/i })
    .first();
  await expect(banner).toBeVisible({ timeout: 10_000 });
  // ...with CTA-specific copy. g1 is free + no-approval → "Join Run".
  // The banner names the sticky CTA by its label: "Join Run" (free), "Request
  // Spot" (approval) or "Pay Host" (paid).
  await expect(banner).toContainText(/tap\s+[“"']?Join Run[”"']?\s+below/i);
  await expect(banner).not.toContainText(/Request Spot/i);
  await expect(banner).not.toContainText(/Pay Host/i);

  await ctx.close();
});
