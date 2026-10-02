import { expect, test, type Page } from "@playwright/test";
import { HAS_BACKEND, account, signInAs } from "./helpers/fixture-auth";

/**
 * Emergency contact info on the Guardian's own profile — private to the
 * guardian, edited in /profile/edit, shown in the Profile tab's About sheet.
 * e2e/guardian-account-type.spec.ts already covers becoming a switchable
 * Guardian profile; this spec only covers what's new here: the field itself,
 * round-tripping, phone validation, and that it never appears on a player
 * profile's edit screen.
 *
 * Runs against the shared project, so — like guardian-account-type.spec.ts —
 * it adds its own child (a distinct name, so it can't collide with that
 * spec's), switches "host" back to player, and deletes the child before
 * finishing.
 */

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

const CHILD_FIRST = "Eetwoemergency";

test.describe("guardian emergency contact, end to end", () => {
  test.describe.configure({ mode: "serial" });

  const appears = (locator: ReturnType<Page["getByRole"]>, timeout: number) =>
    locator.waitFor({ state: "visible", timeout }).then(
      () => true,
      () => false,
    );

  async function switchToGuardianProfile(page: Page) {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /switch profile/i }).click();
    await page.getByRole("menuitem", { name: /^guardian$/i }).click();
  }

  async function deleteChildAndRestore(page: Page) {
    await page.goto("/settings", { waitUntil: "domcontentloaded" });
    const switchBtn = page.getByRole("button", { name: /switch profile/i });
    if (await appears(switchBtn, 5_000)) {
      await switchBtn.click();
      const playerItem = page.getByRole("menuitem", { name: /^player/i });
      if (await appears(playerItem, 2_000)) await playerItem.click();
      else await page.keyboard.press("Escape");
    }

    await page.goto("/parent", { waitUntil: "domcontentloaded" });
    const tab = page.getByRole("tab", { name: new RegExp(CHILD_FIRST) });
    if (!(await appears(tab, 15_000))) return;
    await tab.click();
    page.once("dialog", (d) => void d.accept(CHILD_FIRST));
    await page
      .getByRole("button", { name: new RegExp(`delete ${CHILD_FIRST}'s profile`, "i") })
      .click();
    await expect(tab).toBeHidden({ timeout: 20_000 });
  }

  test("a guardian can add, round-trip, and privately view an emergency contact", async ({
    page,
  }) => {
    await signInAs(page, "host");
    try {
      // Create the switchable Guardian profile (see guardian-account-type.spec.ts).
      await page.goto("/players/add?from=parent", { waitUntil: "domcontentloaded" });
      await page.locator("#first-name").fill(CHILD_FIRST);
      await page.locator("#dob").fill("2015-04-02");
      await page.locator("#attest").click();
      await page.getByRole("button", { name: /^add child$/i }).click();
      await expect(
        page.getByRole("heading", { name: new RegExp(`${CHILD_FIRST}'s profile is ready`, "i") }),
      ).toBeVisible({ timeout: 30_000 });

      await switchToGuardianProfile(page);

      // Not set yet: the About sheet says so, and offers a way to add one.
      await page.goto("/profile", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /tap for more/i }).click();
      await expect(page.getByText(/not added yet/i)).toBeVisible({ timeout: 10_000 });
      await page.getByRole("link", { name: /add one/i }).click();

      // An invalid phone blocks saving, with an inline error.
      await expect(page).toHaveURL(/\/profile\/edit/);
      await page.getByPlaceholder(/who should we contact/i).fill("Jordan Rivera");
      await page.getByPlaceholder(/555.*555.*0100/).fill("not a phone number");
      await expect(page.getByText(/phone number looks invalid/i)).toBeVisible();
      const saveBtn = page.getByRole("button", { name: /^save$/i });
      await expect(saveBtn).toBeDisabled();

      // A valid phone saves successfully.
      await page.getByPlaceholder(/555.*555.*0100/).fill("555-0142");
      await page.getByPlaceholder(/spouse, co-parent/i).fill("Spouse");
      await expect(saveBtn).toBeEnabled();
      await saveBtn.click();
      await expect(page.getByText(/emergency contact saved/i)).toBeVisible({ timeout: 10_000 });

      // Round-trips back on the Profile tab's About sheet.
      await page.goto("/profile", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /tap for more/i }).click();
      await expect(page.getByText("Jordan Rivera")).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText("555-0142")).toBeVisible();
      await expect(page.getByText("Spouse")).toBeVisible();
      await page.keyboard.press("Escape");

      // Never shown on the player profile's own edit screen.
      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /switch profile/i }).click();
      await page.getByRole("menuitem", { name: /^player/i }).click();
      await page.goto("/profile/edit", { waitUntil: "domcontentloaded" });
      await expect(page.getByText(/emergency contact/i)).toHaveCount(0);
    } finally {
      await deleteChildAndRestore(page);
    }
  });
});
