import { test, expect, type Page } from "@playwright/test";

/**
 * Reproduces the "failed to sign in with vendor" Google OAuth error by stubbing
 * `lovable.auth.signInWithOAuth`, and asserts that:
 *  - The actionable "rejected by the provider" toast appears.
 *  - The user stays on /auth in the correct mode.
 *  - The intended `next` and any pending account-type are preserved so a
 *    retry lands in the correct onboarding step.
 */

type OAuthResult = { error?: { message: string }; redirected?: boolean };

async function stubGoogleOAuth(page: Page, result: OAuthResult) {
  await page.evaluate(async (r) => {
    const mod = await import("/src/integrations/lovable/index.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mod as any).lovable.auth.signInWithOAuth = async () => r;
  }, result);
}

const googleButton = (page: Page) => page.getByRole("button", { name: /google/i }).first();

test.describe("Google vendor rejection", () => {
  test("signin: vendor error surfaces actionable toast and preserves next", async ({ page }) => {
    await page.goto("/auth?next=%2Ffeed", { waitUntil: "domcontentloaded" });
    await expect(googleButton(page)).toBeVisible();

    await stubGoogleOAuth(page, {
      error: { message: "failed to sign in with vendor" },
      redirected: false,
    });

    await googleButton(page).click();

    await expect(page.getByText(/rejected by the provider/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/sign in with your email and password/i)).toBeVisible();

    await expect(page).toHaveURL(/\/auth\?next=%2Ffeed$/);

    const stashed = await page.evaluate(() =>
      window.sessionStorage.getItem("openrun:oauth-next"),
    );
    expect(stashed).toBe("/feed");

    // Button re-enabled once the promise settled.
    await expect(googleButton(page)).toBeEnabled();
  });

  test("signup: vendor error preserves pending account type for onboarding", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });

    // Switch to signup mode.
    await page.getByRole("button", { name: /create( an)? account|sign ?up/i }).first().click();

    // Pick the "player" account type on the picker.
    const playerCard = page
      .getByRole("button", { name: /player/i })
      .or(page.getByText(/^player$/i))
      .first();
    await playerCard.click();

    // Advance to the form step (Continue button on the picker).
    await page.getByRole("button", { name: /^continue$/i }).first().click();

    // The signup form should now render a Google button.
    await expect(googleButton(page)).toBeVisible();

    await stubGoogleOAuth(page, {
      error: { message: "failed to sign in with vendor" },
      redirected: false,
    });

    await googleButton(page).click();

    await expect(page.getByText(/rejected by the provider/i)).toBeVisible({ timeout: 5_000 });

    // Still on /auth, still in signup form (email field is present).
    await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
    await expect(page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first()).toBeVisible();

    const pendingType = await page.evaluate(() =>
      window.localStorage.getItem("openrun:pending-account-type"),
    );
    expect(pendingType).toBe("player");
  });

  test("negative control: non-vendor error uses plain toast", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    await expect(googleButton(page)).toBeVisible();

    await stubGoogleOAuth(page, {
      error: { message: "network unreachable" },
      redirected: false,
    });

    await googleButton(page).click();

    await expect(page.getByText(/network unreachable/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/rejected by the provider/i)).toHaveCount(0);
  });
});
