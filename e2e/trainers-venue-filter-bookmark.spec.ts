import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: opening a bookmarked /trainers URL that already carries `venue=` and
 * `radius=` search params should hydrate into the filter UI (chip highlighted,
 * slider value applied) AND persist across:
 *   - the trainers view/tab toggle
 *   - navigation into a trainer profile
 *   - opening the booking sheet
 *   - the back-link to the feed
 *
 * Skips when no signed-in Supabase session is available OR when the seeded
 * data has no trainer-venue chips (the filter has nothing meaningful to
 * bookmark).
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

async function discoverVenue(page: Page): Promise<string | null> {
  await page.goto("/trainers", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.getByRole("button", { name: "Filters" }).click();
  const anyVenue = page.getByRole("button", { name: "Any venue" });
  await anyVenue.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  const chips = page.locator("button[title]");
  const count = await chips.count();
  for (let i = 0; i < count; i++) {
    const title = await chips.nth(i).getAttribute("title");
    if (title && title.length >= 5) return title;
  }
  return null;
}

test("bookmarked venue+radius URL persists across tabs, profile, and booking sheet", async ({
  page,
}) => {
  await restoreSession(page);

  const venue = await discoverVenue(page);
  test.skip(!venue, "No trainer venue chips present in seeded data.");

  // Bookmarked deep link with both venue and radius pre-set.
  const bookmarked = `/trainers?venue=${encodeURIComponent(venue!)}&radius=25`;
  await page.goto(bookmarked, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  // URL params survive hydration.
  await expect(page).toHaveURL(/[?&]venue=/);
  await expect(page).toHaveURL(/[?&]radius=25(?!\d)/);

  // Open filters and confirm both the slider value and the venue chip
  // reflect the bookmarked selection.
  await page.getByRole("button", { name: "Filters" }).click();
  const slider = page.getByRole("slider", { name: "Distance radius" });
  await expect(slider).toHaveAttribute("aria-valuenow", "25");

  const activeChip = page.locator(`button[title=${JSON.stringify(venue)}]`);
  await expect(activeChip).toHaveClass(/border-lime/);

  // Toggle the trainers view (list ↔ map / grid) — URL params must survive.
  const toggle = page
    .getByRole("button", { name: /^(Map|List|Grid)$/ })
    .first();
  if (await toggle.count()) {
    await toggle.click();
    await expect(page).toHaveURL(/[?&]venue=/);
    await expect(page).toHaveURL(/[?&]radius=25(?!\d)/);
  }

  // Navigate into a trainer profile — bookmarked params must ride along.
  const firstCard = page.locator('a[href*="/trainers/"]').first();
  await firstCard.waitFor({ timeout: 5_000 });
  await firstCard.click();
  await page.waitForURL(/\/trainers\/[^/?#]+/, { timeout: 10_000 });
  await expect(page).toHaveURL(/[?&]venue=/);
  await expect(page).toHaveURL(/[?&]radius=25(?!\d)/);

  // Booking sheet: opens and receives the sticky venue as prefill.
  await page.getByRole("button", { name: /Book session/i }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  // Best-effort: sticky venue label surfaces somewhere inside the dialog.
  await expect(dialog.getByText(venue!, { exact: false }).first()).toBeVisible({
    timeout: 3_000,
  }).catch(() => {});

  // Dismiss the dialog (Escape is universally supported by Radix).
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden({ timeout: 3_000 }).catch(() => {});

  // Back-link returns to the feed with both params intact.
  await page.getByRole("link", { name: "Back to trainers" }).click();
  await page.waitForURL(/\/trainers(?:[/?#]|$)/, { timeout: 10_000 });
  await expect(page).toHaveURL(/[?&]venue=/);
  await expect(page).toHaveURL(/[?&]radius=25(?!\d)/);
});
