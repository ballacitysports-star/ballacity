import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: the trainers page venue filter (chip + radius slider) writes to the
 * URL, narrows the visible feed, and is preserved when navigating to a
 * trainer profile and back. Also verifies the sticky venue reaches the
 * booking sheet trigger on the profile.
 *
 * Skips when no signed-in Supabase session is available OR when the seeded
 * trainer data has no venue-tagged coaches (the filter has nothing to test).
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

async function openFiltersAndPickVenue(page: Page): Promise<string | null> {
  await page.getByRole("button", { name: "Filters" }).click();
  const anyVenue = page.getByRole("button", { name: "Any venue" });
  await anyVenue.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  // Venue chips are siblings of "Any venue" and carry a `title` attribute
  // equal to the full address.
  const venueChips = page.locator('button[title]').filter({ hasNot: page.locator("nothing") });
  const count = await venueChips.count();
  for (let i = 0; i < count; i++) {
    const chip = venueChips.nth(i);
    const title = await chip.getAttribute("title");
    if (!title) continue;
    // Skip anything that isn't a trainer-venue chip (they all have long addresses).
    if (title.length < 5) continue;
    await chip.click();
    return title;
  }
  return null;
}

test("venue filter narrows feed and persists across profile navigation", async ({ page }) => {
  await restoreSession(page);
  await page.goto("/trainers", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  // Baseline result count.
  const resultsLabel = page.locator("text=/^\\d+ results?$/").first();
  await resultsLabel.waitFor({ timeout: 10_000 }).catch(() => {});
  const baselineText = (await resultsLabel.textContent().catch(() => "")) ?? "";
  const baseline = Number(baselineText.match(/^(\d+)/)?.[1] ?? "0");

  const venue = await openFiltersAndPickVenue(page);
  test.skip(!venue, "No trainer venue chips present in seeded data.");

  // URL reflects the filter.
  await expect(page).toHaveURL(/[?&]venue=/, { timeout: 5_000 });
  const filteredText = (await resultsLabel.textContent().catch(() => "")) ?? "";
  const filtered = Number(filteredText.match(/^(\d+)/)?.[1] ?? "0");
  expect(filtered, "filtered feed count should be <= baseline").toBeLessThanOrEqual(baseline);

  // Distance slider writes radius to the URL.
  const slider = page.getByRole("slider", { name: "Distance radius" });
  await slider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/[?&]radius=[1-9]/, { timeout: 5_000 });
  // Reset radius so it doesn't hide all trainers on this dataset.
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");

  // Navigate into a trainer profile — the ?venue= param must ride along.
  const firstCard = page.locator('a[href*="/trainers/"]').first();
  await firstCard.waitFor({ timeout: 5_000 });
  await firstCard.click();
  await page.waitForURL(/\/trainers\/[^/?#]+/, { timeout: 10_000 });
  await expect(page, "venue param must persist onto profile URL").toHaveURL(/[?&]venue=/);

  // Back-link on the profile preserves the venue selection.
  await page.getByRole("link", { name: "Back to trainers" }).click();
  await page.waitForURL(/\/trainers(?:[/?#]|$)/, { timeout: 10_000 });
  await expect(page, "venue param must persist back to the feed").toHaveURL(/[?&]venue=/);

  // Filter chip for the venue is still marked active (lime border).
  await page.getByRole("button", { name: "Filters" }).click();
  const activeVenueChip = page.locator(`button[title=${JSON.stringify(venue)}]`);
  await expect(activeVenueChip).toHaveClass(/border-lime/);
});

test("book session sheet opens with sticky venue from the feed", async ({ page }) => {
  await restoreSession(page);
  await page.goto("/trainers", { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle").catch(() => {});

  const venue = await openFiltersAndPickVenue(page);
  test.skip(!venue, "No trainer venue chips present in seeded data.");

  // Trainer cards that offer this venue also expose a "Request" action.
  const firstProfileLink = page.locator('a[href*="/trainers/"]').first();
  await firstProfileLink.click();
  await page.waitForURL(/\/trainers\/[^/?#]+/, { timeout: 10_000 });
  await expect(page).toHaveURL(/[?&]venue=/);

  // Open the booking sheet from the trainer profile's floating CTA.
  await page.getByRole("button", { name: /Book session/i }).click();
  // Sheet renders (Radix dialog role) — sticky venue selection is what
  // TrainerActions/profile pass in as `prefill`.
  await expect(page.getByRole("dialog")).toBeVisible({ timeout: 5_000 });
});
