import { expect, test, type Page } from "@playwright/test";
import { HAS_BACKEND, account, signInAs } from "./helpers/fixture-auth";

/**
 * A parent adds a child who has no email or password (a "managed child"),
 * switches into the child's profile, comes back, and deletes it.
 *
 * The form checks need only a signed-in adult. The full flow needs the
 * 20260930120000_managed_children.sql migration on the E2E project and the
 * service role key on the app server (creating a credential-less account is an
 * Admin API call), so it probes the backend first and skips with the reason
 * when either is missing — it never fails a run because the backend is behind.
 *
 * Runs against the shared project, so the child it creates is always deleted
 * again, through the same Parent Center action a parent would use.
 */

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

const SUPABASE_URL = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";
const PUBLISHABLE_KEY =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY ?? "";

/** Every child this spec creates starts with this, so leftovers can be found. */
const CHILD_PREFIX = "Eetwoemanaged";
/** The form checks below never save, so they can share the bare prefix. */
const CHILD_FIRST = CHILD_PREFIX;

/**
 * A first name no other run uses. Names are letters only (childDisplayName),
 * so the per-run part is letters too. Two children with the same name made
 * every locator in the end-to-end test ambiguous (runs 42697337005 and
 * 42700110383: "resolved to 3 elements").
 */
function uniqueChildFirst(): string {
  const letters = "abcdefghijklmnopqrstuvwxyz";
  let tail = "";
  for (let i = 0; i < 8; i++) tail += letters[Math.floor(Math.random() * letters.length)];
  return `${CHILD_PREFIX}${tail}`;
}

test.describe("Add your child form", () => {
  test("needs a name, a birthday and the guardian's confirmation — not a sport", async ({
    page,
  }) => {
    await signInAs(page, "host");
    await page.goto("/players/add?from=parent", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /add your child/i })).toBeVisible({
      timeout: 15_000,
    });

    const add = page.getByRole("button", { name: /^add child$/i });
    await expect(add).toBeDisabled();

    await page.locator("#first-name").fill(CHILD_FIRST);
    await expect(add).toBeDisabled();

    await page.locator("#dob").fill("2015-04-02");
    // No attestation yet.
    await expect(add).toBeDisabled();

    await page.locator("#attest").click();
    // No sport chosen, and it must not block.
    await expect(add).toBeEnabled();
  });

  test("refuses an adult birthday", async ({ page }) => {
    await signInAs(page, "host");
    await page.goto("/players/add?from=parent", { waitUntil: "domcontentloaded" });
    await page.locator("#first-name").fill(CHILD_FIRST);
    await page.locator("#dob").fill("2000-01-01");
    await page.locator("#attest").click();
    await expect(page.getByText(/makes them an adult/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /^add child$/i })).toBeDisabled();
  });

  // Choosing Parent / Guardian lands here (see onboarding-null-account-type.spec.ts).
  // A parent who is not ready to add a child yet can go on to the Parent Center.
  test("Add your child, reached from onboarding, can be skipped for the Parent Center", async ({
    page,
  }) => {
    await signInAs(page, "host");
    await page.goto("/players/add?from=parent", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /add your child/i })).toBeVisible({
      timeout: 15_000,
    });
    // From the Parent Center there is nothing to skip.
    await expect(page.getByRole("link", { name: /skip for now/i })).toHaveCount(0);

    await page.goto("/players/add?from=onboarding", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /add your child/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole("link", { name: /skip for now/i }).click();
    await expect(page).toHaveURL(/\/parent(?:[?#].*)?$/, { timeout: 15_000 });
  });
});

test.describe("managed child, end to end", () => {
  test.describe.configure({ mode: "serial" });

  // One test in this group, so beforeEach runs once. Is the migration on this
  // backend? Ask with the host's own token: an unapplied migration answers 404
  // for the function.
  test.beforeEach(async ({ request }) => {
    const host = account("host");
    const tokenRes = await request.post(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: PUBLISHABLE_KEY, "Content-Type": "application/json" },
      data: { email: host.email, password: host.password },
    });
    const token = tokenRes.ok()
      ? ((await tokenRes.json()) as { access_token?: string }).access_token
      : null;
    const probe = token
      ? await request.post(`${SUPABASE_URL}/rest/v1/rpc/is_managed_account`, {
          headers: {
            apikey: PUBLISHABLE_KEY,
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          data: { _user: "00000000-0000-0000-0000-000000000000" },
        })
      : null;
    test.skip(
      probe?.ok() !== true,
      "E2E backend has not applied 20260930120000_managed_children.sql.",
    );
  });

  /** The Parent Center, as the guardian, with the roster loaded. */
  async function openParentCenter(page: Page) {
    await page.goto("/parent", { waitUntil: "domcontentloaded" });
    // Loaded means the roster or the empty state. Never sample "is the tab
    // there?" against a page that is still loading: that is how the old
    // cleanup skipped the delete and still passed.
    const loaded = page
      .getByRole("tablist", { name: /your linked children/i })
      .or(page.getByText(/^no children yet$/i));
    // Still inside a child's profile (a step failed mid-way)? The banner is on
    // every page there; go back to the guardian first.
    const back = page.getByRole("button", { name: /^back to /i });
    await expect(loaded.or(back).first()).toBeVisible({ timeout: 30_000 });
    if (await back.isVisible()) {
      await back.click();
      await expect(page).toHaveURL(/\/parent/, { timeout: 30_000 });
    }
    await expect(loaded.first()).toBeVisible({ timeout: 30_000 });
  }

  /**
   * Delete, through the Parent Center, every managed child this spec has ever
   * created for the host (any name starting with CHILD_PREFIX), and check each
   * one leaves the roster. Fails loudly, with the app's error toast when there
   * is one: a cleanup that cannot clean up must not let the test pass.
   */
  async function deleteChildren(page: Page) {
    await openParentCenter(page);
    const ours = page.getByRole("tab", { name: new RegExp(CHILD_PREFIX) });
    const errorToast = page.locator('[data-sonner-toast][data-type="error"]');
    for (let round = 0; round < 20; round++) {
      const before = await ours.count();
      if (before === 0) return;
      await ours.first().click();
      // Only the selected child's panel is open, so there is one such button.
      const del = page.getByRole("button", { name: /^delete .+'s profile$/i });
      await expect(del).toBeVisible({ timeout: 15_000 });
      const first = /^delete (.+)'s profile$/i.exec(((await del.textContent()) ?? "").trim())?.[1];
      expect(first ?? "", "the delete button names one of this spec's children").toMatch(
        new RegExp(`^${CHILD_PREFIX}`),
      );
      // The confirmation is a prompt that asks for the first name.
      page.once("dialog", (d) => void d.accept(first));
      await del.click();
      const deadline = Date.now() + 30_000;
      while ((await ours.count()) >= before) {
        if ((await errorToast.count()) > 0) {
          throw new Error(`Deleting ${first} failed: ${await errorToast.first().innerText()}`);
        }
        if (Date.now() > deadline) throw new Error(`${first} was still listed 30 s after Delete.`);
        await page.waitForTimeout(500);
      }
    }
    throw new Error(`Over 20 leftover ${CHILD_PREFIX} children for the host; stopped deleting.`);
  }

  test("add, switch in, switch back, delete", async ({ page }) => {
    // Room for clearing leftovers from earlier runs before the flow itself.
    test.setTimeout(180_000);
    const childFirst = uniqueChildFirst();
    await signInAs(page, "host");
    // Leftovers from a run that could not clean up (a cancelled job, a crash)
    // would otherwise sit in the roster beside this run's child.
    await deleteChildren(page);
    try {
      await page.goto("/players/add?from=parent", { waitUntil: "domcontentloaded" });
      await page.locator("#first-name").fill(childFirst);
      await page.locator("#last-name").fill("Tester");
      await page.locator("#dob").fill("2015-04-02");
      await page.locator("#attest").click();
      await page.getByRole("button", { name: /^add child$/i }).click();

      // The confirmation, not a raw error (§23).
      await expect(
        page.getByRole("heading", { name: new RegExp(`${childFirst}'s profile is ready`, "i") }),
      ).toBeVisible({ timeout: 30_000 });

      // Parent Center lists the child as managed, with every control in place.
      await page.getByRole("button", { name: /go to parent center/i }).click();
      await expect(page).toHaveURL(/\/parent/, { timeout: 15_000 });
      const tab = page.getByRole("tab", { name: new RegExp(`${childFirst} T\\.`) });
      await expect(tab).toBeVisible({ timeout: 20_000 });
      await tab.click();
      await expect(page.getByText(/managed by you — no email or password/i)).toBeVisible();

      // Switch in: the whole app is now the child, with the child's rules.
      await page
        .getByRole("button", { name: new RegExp(`switch to ${childFirst}'s profile`, "i") })
        .click();
      await expect(page).toHaveURL(/\/profile/, { timeout: 30_000 });
      await expect(
        page.getByText(new RegExp(`managing ${childFirst} T\\.'s profile`, "i")),
      ).toBeVisible({
        timeout: 20_000,
      });

      // No credential surfaces inside a child's profile.
      await page.goto("/settings", { waitUntil: "domcontentloaded" });
      await expect(page.getByText(/password & sign-in/i)).toHaveCount(0);
      await expect(page.getByText(/^delete account$/i)).toHaveCount(0);

      // One tap back to the guardian.
      await page.getByRole("button", { name: /^back to /i }).click();
      await expect(page).toHaveURL(/\/parent/, { timeout: 30_000 });
      await expect(page.getByText(/managing .*'s profile/i)).toHaveCount(0);
    } finally {
      await deleteChildren(page);
    }
  });
});
