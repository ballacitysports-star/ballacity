import { test, expect, type Page } from "@playwright/test";
import { restoreSession } from "./helpers/signed-in";
import {
  HARBOR_COACH,
  NORTHSIDE_COACH,
  stubTrainerDirectory,
} from "./helpers/misc-trainer-directory";

/**
 * E2E: the trainers page venue filter (chip + radius slider) writes to the
 * URL, narrows the visible feed, and is preserved when navigating to a
 * trainer profile and back. Also verifies the sticky venue reaches the
 * booking sheet trigger on the profile.
 *
 * The directory is fixed (two coaches at two venues, see
 * helpers/misc-trainer-directory.ts) so the filter always has something to
 * narrow, whatever trainers the backend holds. Skips only when no signed-in
 * Supabase session is available.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

test.beforeEach(async ({ page }) => {
  await stubTrainerDirectory(page);
  await restoreSession(page);
});

/** "2 results" above the list. */
const resultCount = (page: Page) => page.getByText(/^\d+ results?$/);

const filterSheet = (page: Page) => page.getByRole("dialog", { name: "Filter trainers" });

/** The venue chip shows the address up to the first comma; its title is the full address. */
const venueChip = (page: Page, address: string) =>
  filterSheet(page).getByRole("button", { name: address.split(",")[0] });

const coachCard = (page: Page, name: string) => page.getByRole("link", { name: new RegExp(name) });

async function openFilters(page: Page) {
  await page.getByRole("button", { name: "Filters" }).click();
  await expect(filterSheet(page)).toBeVisible();
}

async function closeFilters(page: Page) {
  await filterSheet(page).getByRole("button", { name: "Show results" }).click();
  await expect(filterSheet(page)).toBeHidden();
}

async function pickHarborVenue(page: Page) {
  await openFilters(page);
  await venueChip(page, HARBOR_COACH.venue).click();
  await expect(page).toHaveURL(/[?&]venue=/, { timeout: 5_000 });
}

test("venue filter narrows feed and persists across profile navigation", async ({ page }) => {
  await page.goto("/trainers", { waitUntil: "domcontentloaded" });

  // Baseline: both coaches.
  await expect(resultCount(page)).toHaveText("2 results", { timeout: 20_000 });
  await expect(coachCard(page, NORTHSIDE_COACH.name)).toBeVisible();

  await pickHarborVenue(page);
  expect(new URL(page.url()).searchParams.get("venue")).toBe(HARBOR_COACH.venue);

  // Distance slider writes radius to the URL.
  const slider = filterSheet(page).getByRole("slider", { name: "Distance radius" });
  await slider.focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(page).toHaveURL(/[?&]radius=5(?!\d)/, { timeout: 5_000 });
  // Reset radius so it doesn't hide trainers that have no measured distance.
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await expect(page).not.toHaveURL(/[?&]radius=[1-9]/, { timeout: 5_000 });
  await closeFilters(page);

  // The filter narrowed the feed to the coach at that venue.
  await expect(resultCount(page)).toHaveText("1 result");
  await expect(coachCard(page, NORTHSIDE_COACH.name)).toHaveCount(0);

  // Navigate into the trainer profile: the ?venue= param must ride along.
  await coachCard(page, HARBOR_COACH.name).click();
  await page.waitForURL(new RegExp(`/trainers/${HARBOR_COACH.id}(?:[?#]|$)`), {
    timeout: 10_000,
  });
  expect(new URL(page.url()).searchParams.get("venue"), "venue must persist onto profile").toBe(
    HARBOR_COACH.venue,
  );

  // The profile's back control returns to the feed with the venue selection.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.waitForURL(/\/trainers(?:[?#]|$)/, { timeout: 10_000 });
  expect(new URL(page.url()).searchParams.get("venue"), "venue must persist back").toBe(
    HARBOR_COACH.venue,
  );
  await expect(resultCount(page)).toHaveText("1 result");

  // Filter chip for the venue is still marked active (lime border).
  await openFilters(page);
  await expect(venueChip(page, HARBOR_COACH.venue)).toHaveClass(/border-lime/);
  await expect(venueChip(page, NORTHSIDE_COACH.venue)).not.toHaveClass(/border-lime/);
});

test("book session sheet opens with sticky venue from the feed", async ({ page }) => {
  await page.goto("/trainers", { waitUntil: "domcontentloaded" });
  await expect(resultCount(page)).toHaveText("2 results", { timeout: 20_000 });

  await pickHarborVenue(page);
  await closeFilters(page);

  // The card of a trainer who offers this venue carries it into the profile.
  await coachCard(page, HARBOR_COACH.name).click();
  await page.waitForURL(new RegExp(`/trainers/${HARBOR_COACH.id}(?:[?#]|$)`), {
    timeout: 10_000,
  });
  await expect(page).toHaveURL(/[?&]venue=/);

  // Open the booking sheet from the trainer profile's floating CTA. The sticky
  // venue selection is what the profile passes in as `prefill`.
  await page.getByRole("button", { name: /Book session/i }).click();
  await expect(page.getByRole("dialog", { name: "Book a session" })).toBeVisible({
    timeout: 5_000,
  });
});
