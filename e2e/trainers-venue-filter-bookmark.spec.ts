import { test, expect, type Page } from "@playwright/test";
import { restoreSession } from "./helpers/signed-in";
import {
  HARBOR_COACH,
  NORTHSIDE_COACH,
  SPRINGFIELD_VIEWER,
  stubTrainerDirectory,
} from "./helpers/misc-trainer-directory";

/**
 * E2E: opening a bookmarked /trainers URL that already carries `venue=` and
 * `radius=` search params should hydrate into the filter UI (chip highlighted,
 * slider value applied) AND persist across:
 *   - the trainers view/density toggles
 *   - navigation into a trainer profile (which carries the venue; the radius
 *     is a feed-only filter the profile has no use for)
 *   - opening and closing the booking sheet (the sheet has no venue of its
 *     own, so this checks only that the profile's URL keeps the venue)
 *   - the back control to the feed, which restores both
 *
 * The directory is fixed (two coaches at two venues, see
 * helpers/misc-trainer-directory.ts), so the bookmark always names a venue
 * that exists, whatever trainers the backend holds. Skips only when no
 * signed-in Supabase session is available.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

test.beforeEach(async ({ page, context }) => {
  await stubTrainerDirectory(page);
  await restoreSession(page);
  // The radius filter only applies once the viewer has a location; without one
  // it keeps every coach, and the bookmark's radius=25 would prove nothing.
  // Pin the viewer a few km from both venues instead of depending on whatever
  // the browser happens to know. The app reads its remembered fix on load
  // (lib/geo.ts); a fresh request from the browser answers with the same spot.
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    latitude: SPRINGFIELD_VIEWER.lat,
    longitude: SPRINGFIELD_VIEWER.lng,
  });
  await page.evaluate(
    (coords) =>
      window.localStorage.setItem("openrun.userLoc.v1", JSON.stringify({ at: Date.now(), coords })),
    SPRINGFIELD_VIEWER,
  );
});

const filterSheet = (page: Page) => page.getByRole("dialog", { name: "Filter trainers" });

/** Both bookmarked params, exactly as bookmarked. */
async function expectBookmarkedParams(page: Page) {
  const params = new URL(page.url()).searchParams;
  expect(params.get("venue"), "venue param").toBe(HARBOR_COACH.venue);
  expect(params.get("radius"), "radius param").toBe("25");
}

test("bookmarked venue+radius URL persists across tabs, profile, and booking sheet", async ({
  page,
}) => {
  // Bookmarked deep link with both venue and radius pre-set.
  const bookmarked = `/trainers?venue=${encodeURIComponent(HARBOR_COACH.venue)}&radius=25`;
  await page.goto(bookmarked, { waitUntil: "domcontentloaded" });

  // The bookmark is applied: only the coach at that venue is listed.
  const harborCard = page.getByRole("link", { name: new RegExp(HARBOR_COACH.name) });
  await expect(harborCard).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("link", { name: new RegExp(NORTHSIDE_COACH.name) })).toHaveCount(0);
  // Harbor stays because its venue was measured inside the radius, not
  // because the viewer has no location: its list entry shows the distance
  // (the badge sits beside the card's link, in the entry's wrapper).
  const harborEntry = harborCard.locator(
    "xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' relative ')][1]",
  );
  await expect(harborEntry).toContainText(/\d+\.\d (mi|km)/);

  // URL params survive hydration.
  await expectBookmarkedParams(page);

  // Open filters and confirm both the slider value and the venue chip
  // reflect the bookmarked selection.
  await page.getByRole("button", { name: "Filters" }).click();
  const slider = filterSheet(page).getByRole("slider", { name: "Distance radius" });
  await expect(slider).toHaveAttribute("aria-valuenow", "25");
  const activeChip = filterSheet(page).getByRole("button", {
    name: HARBOR_COACH.venue.split(",")[0],
  });
  await expect(activeChip).toHaveAttribute("title", HARBOR_COACH.venue);
  await expect(activeChip).toHaveClass(/border-lime/);
  await filterSheet(page).getByRole("button", { name: "Show results" }).click();
  await expect(filterSheet(page)).toBeHidden();

  // Toggle the trainers view (density, then list ↔ map): URL params must survive.
  await page.getByRole("tab", { name: "Grid view" }).click();
  await expect(page).toHaveURL(/[?&]density=grid/);
  await expectBookmarkedParams(page);
  await page.getByRole("tab", { name: "Map" }).click();
  await expect(page).toHaveURL(/[?&]view=map/);
  await expectBookmarkedParams(page);
  await page.getByRole("tab", { name: "List" }).click();
  await expect(page).toHaveURL(/[?&]view=list/);
  await expectBookmarkedParams(page);

  // Navigate into the trainer profile: the bookmarked venue rides along.
  await harborCard.click();
  await page.waitForURL(new RegExp(`/trainers/${HARBOR_COACH.id}(?:[?#]|$)`), {
    timeout: 10_000,
  });
  expect(new URL(page.url()).searchParams.get("venue")).toBe(HARBOR_COACH.venue);

  // Booking sheet: opens from the profile.
  await page.getByRole("button", { name: /Book session/i }).click();
  const dialog = page.getByRole("dialog", { name: "Book a session" });
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  // Dismiss the dialog (Escape is universally supported by Radix).
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden({ timeout: 3_000 });
  // Opening and closing the sheet does not drop the venue either.
  expect(new URL(page.url()).searchParams.get("venue")).toBe(HARBOR_COACH.venue);

  // The back control returns to the feed with both bookmarked params intact.
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await page.waitForURL(/\/trainers(?:[?#]|$)/, { timeout: 10_000 });
  await expectBookmarkedParams(page);
  await expect(harborCard).toBeVisible();
});
