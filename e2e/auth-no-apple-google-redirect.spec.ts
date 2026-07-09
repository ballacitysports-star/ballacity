import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: Auth screen has no Apple button, and Google sign-in routes an
 * authenticated user to /onboarding (new users) or /profile (returning).
 *
 * Real Google consent cannot run in headless Chromium, so we assert the
 * two halves that live in OUR code:
 *   1. `/auth` shows Google (and Apple is gone).
 *   2. When a Supabase session already exists, `/oauth/callback` — the
 *      route the provider redirects back to — forwards into /onboarding
 *      or /profile.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

test.describe("auth screen: no Apple button", () => {
  test("/auth does not render an Apple sign-in button", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    await expect(
      page.getByRole("button", { name: /continue with google/i }),
    ).toBeVisible();

    await expect(
      page.getByRole("button", { name: /apple/i }),
    ).toHaveCount(0);
    await expect(page.getByText(/continue with apple/i)).toHaveCount(0);
  });
});

test.describe("google sign-in redirect", () => {
  test.skip(
    !SESSION_JSON || !STORAGE_KEY,
    "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
  );

  async function seedSession(page: Page) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(
      ([key, value]) => {
        window.localStorage.setItem(key!, value!);
      },
      [STORAGE_KEY!, SESSION_JSON!],
    );
  }

  test("/oauth/callback routes signed-in user to /onboarding or /profile", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    page.on("pageerror", (err) => {
      throw new Error(`Unexpected page error: ${err.message}`);
    });

    await seedSession(page);
    await page.goto("/oauth/callback", { waitUntil: "domcontentloaded" });

    await page.waitForURL(
      (url) =>
        url.pathname === "/onboarding" || url.pathname.startsWith("/profile"),
      { timeout: 15_000 },
    );

    const landed = new URL(page.url()).pathname;
    expect(
      landed === "/onboarding" || landed.startsWith("/profile"),
      `expected /onboarding or /profile, got ${landed}`,
    ).toBe(true);

    await expect(
      page.getByText(/(sign[- ]?in failed|auth failed|login failed)/i),
    ).toHaveCount(0);

    await ctx.close();
  });

  test("/auth routes already-authenticated user to /onboarding or /profile", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    await seedSession(page);
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    await page.waitForURL(
      (url) =>
        url.pathname === "/onboarding" || url.pathname.startsWith("/profile"),
      { timeout: 15_000 },
    );

    const landed = new URL(page.url()).pathname;
    expect(
      landed === "/onboarding" || landed.startsWith("/profile"),
      `expected /onboarding or /profile, got ${landed}`,
    ).toBe(true);

    await ctx.close();
  });
});
