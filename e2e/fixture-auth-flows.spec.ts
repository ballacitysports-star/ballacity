import { test, expect } from "@playwright/test";
import { TEST_ACCOUNTS } from "../src/lib/test-fixtures";
import { HAS_BACKEND, account, signInAs } from "./helpers/fixture-auth";

/**
 * E2E: authentication with the three seeded fixture accounts
 * (`e2e-host`, `e2e-player`, `e2e-player2` — see `src/lib/test-fixtures.ts`).
 *
 * These specs sign in through the real `/auth` email + password form rather
 * than injecting a session, so they cover the whole path a member walks:
 * credentials → session → protected surface → refresh → sign out.
 */

test.describe.configure({ mode: "serial" });

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

for (const a of TEST_ACCOUNTS) {
  test(`${a.key}: signs in and reaches a protected surface`, async ({ page }) => {
    await signInAs(page, a.key);

    await page.goto("/feed", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/feed/, { timeout: 20_000 });
    // The signed-in shell (primary tab bar) must be present, not the sign-in page.
    await expect(page.getByRole("group", { name: "Primary tabs" })).toBeVisible({
      timeout: 20_000,
    });
  });

  test(`${a.key}: session survives a hard refresh of a protected route`, async ({ page }) => {
    await signInAs(page, a.key);
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/settings/, { timeout: 20_000 });

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page, "refresh must not bounce to /auth").toHaveURL(/\/settings/, {
      timeout: 20_000,
    });
    await expect(page.getByRole("button", { name: /^Sign out$/ })).toBeVisible({
      timeout: 20_000,
    });
  });
}

test("wrong password is rejected and keeps the visitor on /auth", async ({ page }) => {
  const a = account("player");
  await page.goto("/auth", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder("Email").fill(a.email);
  await page.getByPlaceholder("Password").fill("definitely-not-the-password-2026");
  await page.getByRole("button", { name: /^Sign in$/ }).click();

  await expect(page.getByText(/invalid|incorrect|could not sign/i).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(page).toHaveURL(/\/auth/);
});

test("signing out clears the session and protected routes redirect back to /auth", async ({
  page,
}) => {
  await signInAs(page, "player");
  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: /^Sign out$/ }).click();

  await page.waitForURL(/\/(auth)?(\?|#|$)/, { timeout: 20_000 }).catch(() => {});

  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await page.waitForURL(/\/auth(\?|$)/, { timeout: 20_000 });
  const url = new URL(page.url());
  expect(url.pathname).toBe("/auth");
  expect(url.searchParams.get("next")).toMatch(/^\/feed(?:\?|$)/);
});

test("two fixture accounts hold independent sessions side by side", async ({ browser }) => {
  const one = await browser.newContext();
  const two = await browser.newContext();
  try {
    const p1 = await one.newPage();
    const p2 = await two.newPage();
    await signInAs(p1, "host");
    await signInAs(p2, "player2");

    await p1.goto("/settings", { waitUntil: "domcontentloaded" });
    await p2.goto("/settings", { waitUntil: "domcontentloaded" });

    // Each context keeps its own account: neither leaks into the other.
    await expect(p1.getByText(account("host").email, { exact: false })).toBeVisible({
      timeout: 20_000,
    });
    await expect(p2.getByText(account("player2").email, { exact: false })).toBeVisible({
      timeout: 20_000,
    });
  } finally {
    await one.close();
    await two.close();
  }
});
