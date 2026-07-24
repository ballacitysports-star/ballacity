import { test, expect, type Page } from "@playwright/test";

/**
 * Reproduces the "failed to sign in with vendor" OAuth error by stubbing
 * `lovable.auth.signInWithOAuth`, and asserts that:
 *  - The actionable "rejected by the provider" toast appears.
 *  - The user stays on /auth in the correct mode.
 *  - The intended `next` and any pending account-type are preserved so a
 *    retry lands in the correct onboarding step.
 */

type OAuthResult = { error?: { message: string }; redirected?: boolean };

async function stubOAuth(page: Page, result: OAuthResult) {
  await page.evaluate(async (r) => {
    const mod = await import("/src/integrations/lovable/index.ts");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mod as any).lovable.auth.signInWithOAuth = async () => r;
  }, result);
}

const PENDING_KEY = "openrun.pending_account_type";
const NEXT_KEY = "openrun:oauth-next";
const PROVIDERS = ["google", "apple"] as const;

const providerButton = (page: Page, provider: "google" | "apple") =>
  page.getByRole("button", { name: new RegExp(provider, "i") }).first();

test.describe("OAuth vendor rejection", () => {
  for (const provider of PROVIDERS) {
    test(`${provider}: signin vendor error surfaces actionable toast and preserves next`, async ({
      page,
    }) => {
      await page.goto("/auth?next=%2Ffeed", { waitUntil: "domcontentloaded" });
      const button = providerButton(page, provider);
      await expect(button).toBeVisible();

      await stubOAuth(page, {
        error: { message: "failed to sign in with vendor" },
        redirected: false,
      });

      await button.click();

      await expect(page.getByText(/rejected by the provider/i)).toBeVisible({ timeout: 5_000 });
      await expect(page.getByText(/account setup choice is still saved/i)).toBeVisible();

      await expect(page).toHaveURL(/\/auth\?next=%2Ffeed$/);

      const stashed = await page.evaluate(
        ([nextKey, providerKey]) => ({
          next: window.sessionStorage.getItem(nextKey!),
          provider: window.sessionStorage.getItem(providerKey!),
        }),
        [NEXT_KEY, "openrun:oauth-provider"] as const,
      );
      expect(stashed.next).toBe("/feed");
      expect(stashed.provider).toBe(provider);

      // Button re-enabled once the promise settled.
      await expect(button).toBeEnabled();
    });

    test(`${provider}: signup vendor error preserves pending account type for onboarding`, async ({
      page,
    }) => {
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

      const button = providerButton(page, provider);
      await expect(button).toBeVisible();

      await stubOAuth(page, {
        error: { message: "failed to sign in with vendor" },
        redirected: false,
      });

      await button.click();

      await expect(page.getByText(/rejected by the provider/i)).toBeVisible({ timeout: 5_000 });

      // Still on /auth, still in signup form (email field is present).
      await expect(page).toHaveURL(/\/auth(?:\?.*)?$/);
      await expect(page.getByLabel(/email/i).or(page.locator('input[type="email"]')).first()).toBeVisible();

      const state = await page.evaluate(
        ([pendingKey, providerKey]) => ({
          pending: window.sessionStorage.getItem(pendingKey!),
          provider: window.sessionStorage.getItem(providerKey!),
        }),
        [PENDING_KEY, "openrun:oauth-provider"] as const,
      );
      expect(state.pending).toBe("player");
      expect(state.provider).toBe(provider);
    });
  }

  test("negative control: non-vendor error uses plain toast", async ({ page }) => {
    await page.goto("/auth", { waitUntil: "domcontentloaded" });
    const button = providerButton(page, "google");
    await expect(button).toBeVisible();

    await stubOAuth(page, {
      error: { message: "network unreachable" },
      redirected: false,
    });

    await button.click();

    await expect(page.getByText(/network unreachable/i)).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/rejected by the provider/i)).toHaveCount(0);
  });
});
