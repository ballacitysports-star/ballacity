import { test, expect } from "@playwright/test";
import { HAS_BACKEND, childStatus, signInAs, stubChildStatus } from "./helpers/fixture-auth";

/**
 * E2E: family / guardian surfaces walked with the seeded fixture accounts.
 *
 * Covers the adult (guardian) side — Parent Center reachable from Settings,
 * approvals panel, the invite-a-minor form — and the child side of the same
 * flow, where the guardian-only surface must not be usable and the consent
 * flow stays reachable instead.
 *
 * Read-only by design: no invites are created, so re-runs leave no rows behind.
 */

test.describe.configure({ mode: "serial" });

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

test("adult host reaches the Parent Center from Settings", async ({ page }) => {
  await stubChildStatus(page, childStatus("adult", null));
  await signInAs(page, "host");

  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  const link = page.getByRole("link", { name: /Parent Center/i }).first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();

  await expect(page).toHaveURL(/\/parent/, { timeout: 20_000 });
  // The Parent Center's own page (it opens on "Your family" since the Guardian
  // Dashboard moved into it), not the signed-out "Parent Center" prompt.
  await expect(page.getByRole("heading", { level: 1, name: "Your family" })).toBeVisible({
    timeout: 20_000,
  });
});

test("Parent Center offers the invite-a-minor form to a guardian", async ({ page }) => {
  await stubChildStatus(page, childStatus("adult", null));
  await signInAs(page, "host");

  await page.goto("/parent", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Add a minor to your family/i)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByPlaceholder("e.g. Jordan")).toBeVisible();
  // The relationship picker is part of the same form.
  await expect(page.locator("select").first()).toBeVisible();
});

test("Parent Center shows no linked children for a fresh fixture guardian", async ({ page }) => {
  await stubChildStatus(page, childStatus("adult", null));
  await signInAs(page, "player2");

  await page.goto("/parent", { waitUntil: "domcontentloaded" });
  // Settled, not just mounted: the roster finished loading and is empty.
  await expect(page.getByText("No children yet", { exact: true })).toBeVisible({
    timeout: 20_000,
  });
});

test("a child account is steered to the consent flow, not the guardian surface", async ({
  page,
}) => {
  await stubChildStatus(page, childStatus("child_under_13", "required"));
  await signInAs(page, "player");

  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  // Settings must not advertise the guardian-only Parent Center to a child
  // with no linked children of their own.
  await expect(page.getByRole("link", { name: /Parent Center/i })).toHaveCount(0);

  // The consent flow itself is always reachable.
  await page.goto("/onboarding/child", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: /A parent or guardian approves this account/i }),
  ).toBeVisible({ timeout: 20_000 });
});

test("a pending child sees the waiting state and can re-check status", async ({ page }) => {
  await stubChildStatus(page, childStatus("child_under_13", "pending"));
  await signInAs(page, "player");

  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  // The consent banner (ChildConsentGate) explains the locked features; while
  // a request is pending its action re-checks status rather than starting over.
  await expect(page.getByText(/Parent approval needed/i).first()).toBeVisible({
    timeout: 20_000,
  });
  const recheck = page.getByRole("link", { name: "Check status", exact: true });
  await expect(recheck).toBeVisible();
  await expect(recheck).toHaveAttribute("href", "/onboarding/child");
  await expect(page.getByRole("link", { name: "Start approval" })).toHaveCount(0);
});

test("guardian safety pages stay public and reachable while signed in", async ({ page }) => {
  await signInAs(page, "host");
  for (const path of ["/safety", "/safety/children"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
  }
});
