import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: applying the FilterBar sport chip on Feed, Players, Teams, and
 * Trainers writes the filter to the URL, and the selection is restored
 * from localStorage (via the usePersistedSearch hook) when returning
 * with a clean URL.
 *
 * These tabs are behind AuthGate, so the test requires the fixture
 * Supabase session env vars and skips otherwise.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

const SPORT = "Basketball";

async function restoreSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([k, v]) => window.localStorage.setItem(k!, v!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
  // Clear any leftover persisted filter selections from earlier runs.
  await page.evaluate(() => {
    for (const k of [
      "openrun:teams-search",
      "openrun:trainers-search",
      "openrun:players-search",
      "openrun.feedPrefs.v1",
    ]) {
      try { window.localStorage.removeItem(k); } catch { /* ignore */ }
    }
  });
}

async function countCards(page: Page): Promise<number> {
  // Feed/Players/Teams/Trainers render each result as an anchor link. This
  // covers grid, list, and map-off density variants without depending on
  // internal CSS class names.
  return await page.locator('a[href^="/games/"], a[href^="/players/"], a[href^="/teams/"], a[href^="/trainers/"], a[href^="/u/"]').count();
}

async function pickSport(page: Page, route: string) {
  // Feed and Players render SportChips inline; Teams and Trainers house
  // them inside the Filters bottom sheet — open it first.
  if (route === "/teams" || route === "/trainers") {
    await page.getByRole("button", { name: "Filters" }).click();
  }
  const chip = page.getByRole("button", { name: new RegExp(`\\b${SPORT}\\b`) }).first();
  await chip.waitFor({ state: "visible", timeout: 15_000 });
  await chip.click();
  await expect(page).toHaveURL(/[?&]sport=Basketball/, { timeout: 5_000 });
  // Close the sheet if it's still open so it doesn't cover cards.
  await page.keyboard.press("Escape").catch(() => {});
}

for (const route of ["/feed", "/players", "/teams", "/trainers"] as const) {
  test(`FilterBar sport filter updates results and persists on ${route}`, async ({ page }) => {
    await restoreSession(page);
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle").catch(() => {});
    // Wait until the tab has rendered content (any anchor card) OR the
    // sport chip is visible — whichever proves the page mounted.
    // For inline SportChips tabs, wait until they render.
    if (route === "/feed" || route === "/players") {
      await page
        .getByRole("button", { name: new RegExp(`\\b${SPORT}\\b`) })
        .first()
        .waitFor({ state: "visible", timeout: 15_000 });
    } else {
      await page.getByRole("button", { name: "Filters" }).waitFor({ state: "visible", timeout: 15_000 });
    }

    const baseline = await countCards(page);

    await pickSport(page, route);
    await page.waitForTimeout(500);
    const filtered = await countCards(page);
    expect(filtered, `${route}: filtered <= baseline`).toBeLessThanOrEqual(baseline);

    // Navigate away and back with a *clean* URL. usePersistedSearch must
    // restore the sport param from localStorage.
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/[?&]sport=Basketball/, { timeout: 5_000 });
    await page.waitForTimeout(400);
    const restored = await countCards(page);
    expect(restored, `${route}: restored count matches filtered count`).toBe(filtered);
  });
}
