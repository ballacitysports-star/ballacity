import { test, expect, type Page } from "@playwright/test";

/**
 * E2E: Full-page Google OAuth redirect lands on /profile or /onboarding.
 *
 * Simulates the tail end of a full-page OAuth flow: the provider redirects
 * the browser back to `${origin}/oauth/callback` with the Supabase session
 * already persisted in localStorage. The callback route must poll the
 * session and forward the user to /profile (or /onboarding if the profile
 * has no username yet) — never strand them on `/`.
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

test.describe("Full-page Google OAuth redirect", () => {
  test.skip(
    !SESSION_JSON || !STORAGE_KEY,
    "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
  );

  test("callback route forwards signed-in user off / and into the app", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();

    page.on("pageerror", (err) => {
      throw new Error(`Unexpected page error: ${err.message}`);
    });

    await seedSession(page);

    // Optional saved post-auth destination (matches what auth.tsx stores
    // before calling signInWithOAuth).
    await page.evaluate(() =>
      window.sessionStorage.setItem("openrun:postAuthRedirect", "/profile"),
    );

    // Full-page redirect endpoint the OAuth broker sends the browser to.
    await page.goto("/oauth/callback", { waitUntil: "domcontentloaded" });

    // Transient "Signing you in" copy is fine; the failure copy is not.
    await expect(page.getByText(/couldn't finish the sign-in/i)).toHaveCount(0);

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

    // Regression guard: user must not be left stranded on the landing page,
    // the auth screen, or bounced back to the callback.
    expect(landed).not.toBe("/");
    expect(landed).not.toBe("/auth");
    expect(landed).not.toBe("/oauth/callback");

    await ctx.close();
  });
});
