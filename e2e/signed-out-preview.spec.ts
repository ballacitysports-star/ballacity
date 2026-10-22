import { test, expect } from "@playwright/test";

/**
 * E2E: a signed-out visitor can open each tab and sees a blurred sample
 * preview of it, not a redirect to sign-in and not the signed-in page.
 *
 * The preview is static sample content, so these run signed out with or without
 * backend credentials. The security property is that no request carries a
 * member's data: the real tab page is never mounted without a user, so it makes
 * no Supabase request at all.
 */

const TABS = ["feed", "players", "teams", "trainers", "reels", "create", "profile"] as const;

for (const tab of TABS) {
  test(`/${tab} shows a signed-out visitor the sample preview`, async ({ page }) => {
    const supabaseRequests: string[] = [];
    page.on("request", (r) => {
      if (/\.supabase\.co\//.test(r.url())) supabaseRequests.push(r.url());
    });

    await page.goto(`/${tab}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByTestId("signed-out-preview")).toBeVisible({ timeout: 30_000 });
    await expect(page).toHaveURL(new RegExp(`/${tab}(\\?|$)`));
    await expect(page.getByRole("note")).toContainText("Sample preview");

    // A way in that returns them here afterwards.
    const create = page.getByRole("link", { name: "Create account" }).first();
    await expect(create).toBeVisible();
    const href = new URL((await create.getAttribute("href"))!, page.url());
    expect(href.pathname).toBe("/auth");
    expect(href.searchParams.get("mode")).toBe("signup");
    expect(href.searchParams.get("next")).toContain(`/${tab}`);

    // Blurred areas can't be clicked, focused or read by assistive tech.
    const blurred = page.locator('[aria-hidden="true"][inert]');
    expect(await blurred.count()).toBeGreaterThan(0);
    await expect(blurred.first()).toHaveCSS("pointer-events", "none");

    // Nothing was fetched on a member's behalf.
    expect(supabaseRequests, "a signed-out preview must not call the database").toEqual([]);
  });
}

test("notifications stays behind sign-in", async ({ page }) => {
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/auth(\?|$)/, { timeout: 30_000 });
  expect(new URL(page.url()).searchParams.get("next")).toBe("/notifications");
});

test("the landing page's main buttons open the app preview, not the city pages", async ({
  page,
}) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /Find a game near me/ }).click();
  await expect(page.getByTestId("signed-out-preview")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/feed(\?|$)/);

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.getByRole("link", { name: /^Browse teams/ }).click();
  await expect(page.getByTestId("signed-out-preview")).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/\/teams(\?|$)/);
});
