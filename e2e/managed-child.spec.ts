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

const CHILD_FIRST = "Eetwoemanaged";

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

  const appears = (locator: ReturnType<Page["getByRole"]>, timeout: number) =>
    locator.waitFor({ state: "visible", timeout }).then(
      () => true,
      () => false,
    );

  async function deleteChild(page: Page) {
    await page.goto("/parent", { waitUntil: "domcontentloaded" });
    // Still inside the child's profile (a step failed mid-way)? The banner is
    // on every page there; go back to the guardian first.
    const back = page.getByRole("button", { name: /^back to /i });
    if (await appears(back, 5_000)) {
      await back.click();
      await expect(page).toHaveURL(/\/parent/, { timeout: 30_000 });
    }
    // The roster loads after the page; wait for it rather than sampling once.
    const tab = page.getByRole("tab", { name: new RegExp(CHILD_FIRST) });
    if (!(await appears(tab, 15_000))) return;
    await tab.click();
    page.once("dialog", (d) => void d.accept(CHILD_FIRST));
    await page
      .getByRole("button", { name: new RegExp(`delete ${CHILD_FIRST}'s profile`, "i") })
      .click();
    await expect(tab).toBeHidden({ timeout: 20_000 });
  }

  test("add, switch in, switch back, delete", async ({ page }) => {
    await signInAs(page, "host");
    try {
      await page.goto("/players/add?from=parent", { waitUntil: "domcontentloaded" });
      await page.locator("#first-name").fill(CHILD_FIRST);
      await page.locator("#last-name").fill("Tester");
      await page.locator("#dob").fill("2015-04-02");
      await page.locator("#attest").click();
      await page.getByRole("button", { name: /^add child$/i }).click();

      // The confirmation, not a raw error (§23).
      await expect(
        page.getByRole("heading", { name: new RegExp(`${CHILD_FIRST}'s profile is ready`, "i") }),
      ).toBeVisible({ timeout: 30_000 });

      // Parent Center lists the child as managed, with every control in place.
      await page.getByRole("button", { name: /go to parent center/i }).click();
      await expect(page).toHaveURL(/\/parent/, { timeout: 15_000 });
      const tab = page.getByRole("tab", { name: new RegExp(CHILD_FIRST) });
      await expect(tab).toBeVisible({ timeout: 20_000 });
      await tab.click();
      await expect(page.getByText(/managed by you — no email or password/i)).toBeVisible();

      // Switch in: the whole app is now the child, with the child's rules.
      await page
        .getByRole("button", { name: new RegExp(`switch to ${CHILD_FIRST}'s profile`, "i") })
        .click();
      await expect(page).toHaveURL(/\/profile/, { timeout: 30_000 });
      await expect(
        page.getByText(new RegExp(`managing ${CHILD_FIRST} T\\.'s profile`, "i")),
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
      await deleteChild(page);
    }
  });
});
