import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: the public reel page (/reels/$reelId) must never reveal a reel that
 * getPublicReel refuses, and every refusal must look the same.
 *
 * The real boundary is server-side: getPublicReel serves a reel only when
 * public.reel_audience() returns 'public' (adult, posted, completed, not hidden,
 * not a family clip, account not locked). These specs cover the refusals that
 * need no seeded data, so they run with or without backend credentials: an
 * unknown id and a malformed id both land on the same "not available" page,
 * with no video, no signed storage URL and a noindex robots tag.
 *
 * Not covered here: draft, hidden, 13-17 and family-clip reels. Those need
 * seeded highlight_reels rows with stored media, birthdays and guardian links
 * in the shared fixture project; reel_audience() itself is what refuses them.
 */

const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const NOT_AVAILABLE = /This highlight isn.t available/;

async function openReel(page: Page, id: string) {
  await page.goto(`/reels/${id}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: NOT_AVAILABLE })).toBeVisible({
    timeout: 20_000,
  });
}

async function expectNothingLeaked(page: Page) {
  await expect(page.locator("video")).toHaveCount(0);
  const html = await page.content();
  expect(html, "no signed storage URL in the page").not.toMatch(/\/storage\/v1\/object\/sign\//);
  expect(html, "no highlight-videos path in the page").not.toContain("highlight-videos");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(0);
}

test("an unknown reel id shows the not-available page and leaks nothing", async ({ page }) => {
  await openReel(page, UNKNOWN_ID);
  await expectNothingLeaked(page);
});

test("a malformed reel id shows the same not-available page", async ({ page }) => {
  await openReel(page, "not-a-uuid");
  await expectNothingLeaked(page);
});

test("unknown and malformed ids are indistinguishable", async ({ page }) => {
  await openReel(page, UNKNOWN_ID);
  const unknownText = await page.locator("main").innerText();
  const unknownTitle = await page.title();

  await openReel(page, "not-a-uuid");
  expect(await page.locator("main").innerText()).toBe(unknownText);
  expect(await page.title()).toBe(unknownTitle);
});
