import { test, expect } from "@playwright/test";
import { HAS_BACKEND, signInAs } from "./helpers/fixture-auth";

/**
 * E2E: WP 5.2 Funnel card (docs/product/phase-5-validation-plan.md).
 *
 * The superadmin test needs a fixture account holding the `superadmin` role (E2E_SUPERADMIN_ACCOUNT, as
 * free-mode-superadmin.spec.ts); it is skipped otherwise. The card shows the weekly table, or "Not available yet" on
 * a database without migration 20261127100000. The member test needs only the seeded player.
 */

const KEY = process.env.E2E_SUPERADMIN_ACCOUNT;

test.describe("superadmin funnel card", () => {
  test("a superadmin sees the Funnel card on the Overview tab", async ({ page }) => {
    test.skip(
      !KEY || !HAS_BACKEND,
      "Requires a fixture account with the superadmin role (E2E_SUPERADMIN_ACCOUNT).",
    );
    await signInAs(page, KEY as never);
    await page.goto("/superadmin", { waitUntil: "domcontentloaded" });

    await expect(page.getByText("Pilot funnel")).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Weekly funnel" }).or(page.getByText("Not available yet")),
    ).toBeVisible();
  });

  test("a member gets no access", async ({ page }) => {
    test.skip(!HAS_BACKEND, "Requires the seeded fixture accounts.");
    await signInAs(page, "player");
    await page.goto("/superadmin", { waitUntil: "domcontentloaded" });

    await expect(page).not.toHaveURL(/\/superadmin/);
    await expect(page.getByText("Pilot funnel")).toHaveCount(0);
  });
});
