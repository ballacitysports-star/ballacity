import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: /oauth/callback
 *   1. Never renders an Apple sign-in affordance (unauthenticated OR mid-flow).
 *   2. With a valid Supabase session already present (the state Google's
 *      redirect leaves us in), completes into /profile or /onboarding.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;

async function seedSession(page: Page) {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
}

test.describe("/oauth/callback has no Apple affordance", () => {
  test("unauthenticated visit renders no Apple button or text", async ({ page }) => {
    await page.goto("/oauth/callback", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: /apple/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /apple/i })).toHaveCount(0);
    await expect(page.getByText(/continue with apple/i)).toHaveCount(0);
    await expect(page.getByText(/sign in with apple/i)).toHaveCount(0);
  });
});

test.describe("/oauth/callback completes Google sign-in", () => {
  test.skip(
    !SESSION_JSON || !STORAGE_KEY,
    "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
  );

  test("routes signed-in user to /profile or /onboarding", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    page.on("pageerror", (err) => {
      throw new Error(`Unexpected page error: ${err.message}`);
    });

    await seedSession(page);
    await page.goto("/oauth/callback", { waitUntil: "domcontentloaded" });

    // No Apple anything even during the transient "Signing you in" state.
    await expect(page.getByText(/apple/i)).toHaveCount(0);

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

    // The failure state must not have rendered.
    await expect(
      page.getByText(/couldn't finish the sign-in/i),
    ).toHaveCount(0);

    await ctx.close();
  });
});
