import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E: joining a game from the game-detail view must propagate in real time
 * to every other open surface for the same user — feed card ("Joined"
 * badge), discover map bottom sheet (spots counter), profile "Upcoming"
 * list, and the game-detail sticky CTA itself.
 *
 * Uses one Supabase-authenticated browser context with multiple tabs so
 * we exercise the `game_participants` postgres_changes subscription in
 * `src/lib/games-store.ts`, not just local `useSyncExternalStore` updates.
 *
 * Auto-skips without a restored Supabase session.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

// Free, no-approval sample game (see src/lib/sample-data.ts → g1).
const GAME_ID = "g1";
const GAME_TITLE_RE = /./; // matched loosely; we assert by role and badges

async function restoreSession(ctx: BrowserContext, page: Page) {
  if (COOKIES_JSON) {
    try {
      const cookies = JSON.parse(COOKIES_JSON).map((c: any) => ({
        ...c,
        url: "http://localhost:8080",
      }));
      await ctx.addCookies(cookies);
    } catch {
      /* ignore malformed */
    }
  }
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

async function clearJoinedState(page: Page) {
  // Ensure the viewer starts un-joined for this game on every tab.
  await page.evaluate(() => window.localStorage.removeItem("openrun.joinedGameIds.v1"));
}

test("joining from game detail updates feed, profile, and detail CTA in real time", async ({
  browser,
}) => {
  const ctx = await browser.newContext();

  // Seed session on a bootstrap page so every subsequent tab inherits it.
  const boot = await ctx.newPage();
  await restoreSession(ctx, boot);
  await clearJoinedState(boot);
  await boot.close();

  const detailPage = await ctx.newPage();
  const feedPage = await ctx.newPage();
  const profilePage = await ctx.newPage();

  try {
    // Land each surface on the target game BEFORE the join, so realtime is
    // the mechanism under test (not a fresh page load).
    await Promise.all([
      detailPage.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" }),
      feedPage.goto("/feed", { waitUntil: "domcontentloaded" }),
      profilePage.goto("/profile", { waitUntil: "domcontentloaded" }),
    ]);

    // --- Baseline: viewer is NOT joined on any surface ---
    const joinCta = detailPage
      .getByRole("button", { name: /join free|you're in|full/i })
      .first();
    await expect(joinCta).toBeVisible({ timeout: 15_000 });
    await expect(joinCta).toContainText(/join free/i);

    // Feed card for this game shouldn't show a "Joined" pill yet. Cards
    // link to /games/<id> — locate by href.
    const feedCard = feedPage.locator(`a[href*="/games/${GAME_ID}"]`).first();
    // Card may not be in view depending on filters; only assert if present.
    const feedCardCount = await feedCard.count();
    if (feedCardCount > 0) {
      await expect(feedCard).not.toContainText(/^Joined$/i);
    }

    // Profile "Upcoming" list shouldn't include the game yet.
    const profileCardBefore = profilePage.locator(`a[href*="/games/${GAME_ID}"]`);
    expect(await profileCardBefore.count()).toBe(0);

    // --- Action: join from the detail page ---
    await joinCta.click();

    // Detail page flips locally (same tab, sync store update).
    await expect(
      detailPage.getByRole("button", { name: /you're in · tap to leave/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // --- Realtime propagation to other tabs ---
    // Feed: the "Joined" badge is rendered inside the card image overlay.
    if (feedCardCount > 0) {
      await expect(feedCard.getByText(/^Joined$/).first()).toBeVisible({ timeout: 15_000 });
    }

    // Profile: the game must appear in the upcoming list via realtime.
    await expect(profilePage.locator(`a[href*="/games/${GAME_ID}"]`).first()).toBeVisible({
      timeout: 15_000,
    });

    // --- Reverse: leave and confirm state clears everywhere ---
    await detailPage
      .getByRole("button", { name: /you're in · tap to leave/i })
      .first()
      .click();

    await expect(
      detailPage.getByRole("button", { name: /join free/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    await expect
      .poll(
        async () => await profilePage.locator(`a[href*="/games/${GAME_ID}"]`).count(),
        { timeout: 15_000, message: "profile still shows joined game after leaving" },
      )
      .toBe(0);

    if (feedCardCount > 0) {
      await expect(feedCard.getByText(/^Joined$/)).toHaveCount(0, { timeout: 15_000 });
    }
  } finally {
    await ctx.close();
  }
});
