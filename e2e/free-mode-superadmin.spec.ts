import { test, expect } from "@playwright/test";
import { HAS_BACKEND, signInAs } from "./helpers/fixture-auth";

/**
 * E2E: §17 SuperAdmin journey.
 *
 * Needs a fixture account holding the `superadmin` role, which the standard
 * seed does not create — set E2E_SUPERADMIN_ACCOUNT to the fixture key once one
 * exists. Skipped otherwise rather than failing, so the suite stays green.
 */

const KEY = process.env.E2E_SUPERADMIN_ACCOUNT;

test.skip(
  !KEY || !HAS_BACKEND,
  "Requires a fixture account with the superadmin role (E2E_SUPERADMIN_ACCOUNT).",
);

test.describe("superadmin monetization controls", () => {
  test("shows the status readout and the per-feature table", async ({ page }) => {
    await signInAs(page, KEY as never);
    await page.goto("/superadmin", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /monetization/i }).click();

    await expect(page.getByText(/monetization status/i)).toBeVisible();
    await expect(page.getByText(/platform free mode/i).first()).toBeVisible();
    await expect(page.getByText(/feature access/i)).toBeVisible();

    // Safety rows are present but locked.
    await expect(page.getByText(/text moderation/i)).toBeVisible();
    await expect(page.getByLabel(/text moderation access/i)).toHaveCount(0);
  });

  test("asks for confirmation before turning monetization on", async ({ page }) => {
    await signInAs(page, KEY as never);
    await page.goto("/superadmin", { waitUntil: "domcontentloaded" });
    await page.getByRole("tab", { name: /monetization/i }).click();

    await page.getByLabel("Platform Free Mode").click();

    await expect(page.getByText(/may introduce subscription requirements/i)).toBeVisible();
    // The confirm button stays disabled until the word is typed.
    const confirm = page.getByRole("button", { name: /turn off free mode/i });
    await expect(confirm).toBeDisabled();
  });
});
