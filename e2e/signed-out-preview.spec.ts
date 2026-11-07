import { test, expect } from "@playwright/test";

/**
 * E2E: a signed-out visitor can open each tab and sees a sample
 * preview of it, not a redirect to sign-in and not the signed-in page.
 *
 * The preview is static sample content, so these run signed out with or without
 * backend credentials. The security property is that no request carries a
 * member's data: the real tab page is never mounted without a user, so it makes
 * no Supabase request on a member's behalf.
 *
 * The one request every app page makes regardless of who is looking is the
 * maintenance flag (`app_settings.maintenance`, superadmin-written, public read,
 * see src/lib/maintenance.ts). It is anonymous and carries nothing about a
 * member, so it is the only Supabase request a preview may make.
 */

const TABS = ["feed", "players", "teams", "trainers", "reels", "create", "profile"] as const;

const MAINTENANCE_FLAG_READ = /\/rest\/v1\/app_settings\?(?:.*&)?key=eq\.maintenance(?:&|$)/;

for (const tab of TABS) {
  test(`/${tab} shows a signed-out visitor the sample preview`, async ({ page }) => {
    const supabaseRequests: string[] = [];
    page.on("request", (r) => {
      const url = r.url();
      if (!/\.supabase\.co\//.test(url)) return;
      if (MAINTENANCE_FLAG_READ.test(url) && r.method() === "GET") return;
      supabaseRequests.push(url);
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

    // The sample content is shown in full, with nothing blurred.
    await expect(page.getByTestId("signed-out-preview").locator('[class*="blur"]')).toHaveCount(0);

    // Nothing was fetched on a member's behalf.
    expect(supabaseRequests, "a signed-out preview must not call the database").toEqual([]);
  });
}

test("notifications stays behind sign-in", async ({ page }) => {
  // Alerts live in the Inbox now: /notifications lands on /messages?tab=alerts,
  // and a signed-out visitor gets the inbox's sample preview, never a member's
  // alerts. The only way in is sign-in.
  const supabaseRequests: string[] = [];
  page.on("request", (r) => {
    const url = r.url();
    if (!/\.supabase\.co\//.test(url)) return;
    if (MAINTENANCE_FLAG_READ.test(url) && r.method() === "GET") return;
    supabaseRequests.push(url);
  });
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/messages\?tab=alerts(?:&|$)/, { timeout: 30_000 });
  await expect(page.getByTestId("signed-out-preview")).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("note")).toContainText("Sample preview");
  const signIn = page.getByRole("link", { name: /sign in/i }).first();
  await expect(signIn).toBeVisible();
  expect(new URL((await signIn.getAttribute("href"))!, page.url()).pathname).toBe("/auth");
  expect(supabaseRequests, "a signed-out inbox preview must not call the database").toEqual([]);
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
