import { test, expect } from "@playwright/test";
import { HAS_BACKEND, childStatus, signInAs, stubChildStatus } from "./helpers/fixture-auth";

/**
 * E2E: family / guardian surfaces walked with the seeded fixture accounts.
 *
 * Covers the adult (guardian) side — Guardian Dashboard reachable from Settings,
 * approvals panel, the Add a Player form — and the player side of the same
 * flow, where the guardian-only surface must not be usable and the consent
 * flow stays reachable instead.
 *
 * Read-only by design: no invites are created, so re-runs leave no rows behind.
 */

test.describe.configure({ mode: "serial" });

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

test("adult host reaches the Guardian Dashboard from Settings", async ({ page }) => {
  await stubChildStatus(page, childStatus("adult", null));
  await signInAs(page, "host");

  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  const link = page.getByRole("link", { name: /Guardian Dashboard/i }).first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  await link.click();

  await expect(page).toHaveURL(/\/parent/, { timeout: 20_000 });
  await expect(
    page.getByRole("heading", { name: /Your child’s account|Your child's account/i }),
  ).toBeVisible({ timeout: 20_000 });
});

test("Guardian Dashboard offers the Add a Player form to a guardian", async ({ page }) => {
  await stubChildStatus(page, childStatus("adult", null));
  await signInAs(page, "host");

  await page.goto("/parent", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Add a Player/i).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByPlaceholder("e.g. Jordan")).toBeVisible();
  // The relationship picker is part of the same form.
  await expect(page.locator("select").first()).toBeVisible();
});

test("Guardian Dashboard shows no linked players for a fresh fixture guardian", async ({
  page,
}) => {
  await stubChildStatus(page, childStatus("adult", null));
  await signInAs(page, "player2");

  await page.goto("/parent", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/No linked players|Loading…/i).first()).toBeVisible({
    timeout: 20_000,
  });
});

test("a Guardian-managed player is steered to the consent flow, not the guardian surface", async ({
  page,
}) => {
  await stubChildStatus(page, childStatus("child_under_13", "required"));
  await signInAs(page, "player");

  await page.goto("/settings", { waitUntil: "domcontentloaded" });
  // Settings must not advertise the guardian-only Guardian Dashboard to a
  // player with no linked players of their own.
  await expect(page.getByRole("link", { name: /Guardian Dashboard/i })).toHaveCount(0);

  // The consent flow itself is always reachable.
  await page.goto("/onboarding/child", { waitUntil: "domcontentloaded" });
  await expect(
    page.getByRole("heading", { name: /Your Guardian approves this account/i }),
  ).toBeVisible({ timeout: 20_000 });
});

test("a pending player sees the waiting state and can re-check status", async ({ page }) => {
  await stubChildStatus(page, childStatus("child_under_13", "pending"));
  await signInAs(page, "player");

  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/Waiting for your Guardian/i)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("link", { name: /Start approval|Check status/i })).toBeVisible();
});

test("guardian safety pages stay public and reachable while signed in", async ({ page }) => {
  await signInAs(page, "host");
  for (const path of ["/safety", "/safety/children"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 20_000 });
  }
});
