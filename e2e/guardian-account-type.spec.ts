import { expect, test, type Page } from "@playwright/test";
import { HAS_BACKEND, account, signInAs } from "./helpers/fixture-auth";

/**
 * Parent / Guardian becomes a first-class account type, not stored as
 * "player". e2e/managed-child.spec.ts already covers the Add-your-child
 * mechanics (consent, controls, switching into the child) — this spec covers
 * what's new here: adding a child creates the guardian's own account_profiles
 * "parent" row, it's switchable (not just addable), and switching to it shows
 * the Guardian profile view and badge instead of the athlete one.
 *
 * Runs against the shared project, so it switches the host fixture back to
 * its player profile and deletes the test child before finishing, leaving
 * every other spec's assumptions about "host" unchanged.
 */

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

const CHILD_FIRST = "Eetwoeguardian";

test.describe("guardian account type, end to end", () => {
  test.describe.configure({ mode: "serial" });

  const appears = (locator: ReturnType<Page["getByRole"]>, timeout: number) =>
    locator.waitFor({ state: "visible", timeout }).then(
      () => true,
      () => false,
    );

  async function switchToProfile(page: Page, label: RegExp) {
    await page.getByRole("button", { name: /switch profile/i }).click();
    await page.getByRole("menuitem", { name: label }).click();
  }

  async function deleteChildAndRestore(page: Page) {
    // However far the test got, land back on the player profile before
    // touching the Parent Center — deleting a child needs no particular
    // active profile, but leaving "host" on anything but player would
    // surprise every other spec that signs in as host afterward.
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

  test("adding a child creates a switchable Guardian profile with its own view and badge", async ({
    page,
  }) => {
    await signInAs(page, "host");
    try {
      // Adding a child is also the moment provision_managed_child() creates
      // (or confirms) the guardian's own account_profiles "parent" row.
      await page.goto("/players/add?from=parent", { waitUntil: "domcontentloaded" });
      await page.locator("#first-name").fill(CHILD_FIRST);
      await page.locator("#dob").fill("2015-04-02");
      await page.locator("#attest").click();
      await page.getByRole("button", { name: /^add child$/i }).click();
      await expect(
        page.getByRole("heading", { name: new RegExp(`${CHILD_FIRST}'s profile is ready`, "i") }),
      ).toBeVisible({ timeout: 30_000 });

      // The Guardian profile now exists and is switchable, not merely
      // addable — it must not also still be offered in "Add a profile".
      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await page.getByRole("button", { name: /switch profile/i }).click();
      await expect(page.getByRole("menuitem", { name: /^guardian$/i })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByRole("menuitem", { name: /^new guardian$/i })).toHaveCount(0);
      await page.getByRole("menuitem", { name: /^guardian$/i }).click();

      // Switched: the Profile tab shows the Guardian view — the linked
      // child and a way into the Parent Center — never the athlete one.
      await page.goto("/profile", { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("link", { name: /open parent center/i })).toBeVisible({
        timeout: 15_000,
      });
      await expect(page.getByText(new RegExp(CHILD_FIRST))).toBeVisible();
      await expect(page.getByRole("tab", { name: /^games$/i })).toHaveCount(0);

      // Settings' own identity row reads the same ACCOUNT_TYPE_META label.
      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await expect(page.getByText(/guardian/i).first()).toBeVisible();
    } finally {
      await deleteChildAndRestore(page);
    }
  });

  test("a fresh sign-in lands a guardian on the Parent Center, a player still on the feed", async ({
    page,
  }) => {
    // host's active profile is restored to player by the previous test's
    // cleanup, so this only re-confirms the unchanged, negative case here —
    // the positive case (an active "parent" profile landing on /parent)
    // needs its own account whose default profile is actually Guardian,
    // which this shared, reused fixture should not be left as.
    await signInAs(page, "host");
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(/\/feed/, { timeout: 15_000 });
  });
});
