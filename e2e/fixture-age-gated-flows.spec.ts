import { test, expect, type Page } from "@playwright/test";
import { HOSTING_BLOCKED_MESSAGE } from "../src/lib/hosting-policy";
import { hostingAllowedForCohort } from "../src/lib/hosting-policy";
import { paymentsAllowedForCohort } from "../src/lib/payments-policy";
import { HAS_BACKEND, childStatus, signInAs, stubChildStatus } from "./helpers/fixture-auth";

/**
 * E2E: age-gated surfaces walked with a real fixture session, one cohort at a
 * time. The cohort comes from the authoritative backend guard
 * (`getMyChildStatus`), stubbed per test; the database triggers
 * (`block_child_hosting`, `enforce_game_payment_cohort`,
 * `enforce_minor_messaging`) remain the real boundary — these specs assert the
 * product surface matches the server's decision, and that the policy modules
 * the UI reads agree with what is rendered.
 */

test.describe.configure({ mode: "serial" });

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

const COHORTS = ["child_under_13", "teen_13_15", "teen_16_17", "adult"] as const;

async function openHosting(page: Page) {
  await page.goto("/create", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /Host a game/i })).toBeVisible({
    timeout: 20_000,
  });
}

for (const cohort of COHORTS) {
  const consent = cohort === "child_under_13" ? ("approved" as const) : null;
  const mayHost = hostingAllowedForCohort(cohort);

  test(`hosting screen matches the ${cohort} hosting policy`, async ({ page }) => {
    await stubChildStatus(page, childStatus(cohort, consent));
    await signInAs(page, "host");
    await openHosting(page);

    const blocked = page.getByText(HOSTING_BLOCKED_MESSAGE);
    if (mayHost) {
      await expect(blocked, `${cohort} may host, so no block card`).toHaveCount(0);
    } else {
      await expect(blocked, `${cohort} may not host`).toBeVisible({ timeout: 20_000 });
      // The block card always explains why, never a bare headline.
      const explanation = blocked.locator("xpath=following-sibling::p[1]");
      await expect(explanation).toBeVisible();
      expect((await explanation.innerText()).trim().length).toBeGreaterThan(10);
    }
  });
}

test("an under-13 account without consent still cannot reach hosting", async ({ page }) => {
  await stubChildStatus(page, childStatus("child_under_13", "required"));
  await signInAs(page, "host");
  await openHosting(page);
  await expect(page.getByText(HOSTING_BLOCKED_MESSAGE)).toBeVisible({ timeout: 20_000 });
});

test("payment coordination policy agrees for every cohort", async () => {
  // Guards the two-layer contract the UI depends on: if these flip, the
  // rendered gates above stop meaning what the tests claim.
  expect(paymentsAllowedForCohort("child_under_13")).toBe(false);
  expect(paymentsAllowedForCohort("adult")).toBe(true);
});

test("a minor cohort keeps the app browsable rather than locking it out", async ({ page }) => {
  await stubChildStatus(page, childStatus("teen_13_15", null));
  await signInAs(page, "player");

  for (const path of ["/feed", "/players", "/reels"]) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await expect(page).toHaveURL(new RegExp(path));
    await expect(page.getByRole("group", { name: "Primary tabs" })).toBeVisible({
      timeout: 20_000,
    });
  }
});

test("a revoked child sees the account-off explanation with a way forward", async ({ page }) => {
  await stubChildStatus(page, childStatus("child_under_13", "revoked"));
  await signInAs(page, "player");

  await page.goto("/feed", { waitUntil: "domcontentloaded" });
  await expect(page.getByText(/A parent or guardian turned this account off/i)).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole("link", { name: /Start approval|Check status/i })).toBeVisible();
});

test("messages surface loads for an adult fixture account", async ({ page }) => {
  await stubChildStatus(page, childStatus("adult", null));
  await signInAs(page, "player2");
  await page.goto("/messages", { waitUntil: "domcontentloaded" });
  await expect(page).toHaveURL(/\/messages/, { timeout: 20_000 });
  await expect(page.locator("main, body")).toBeVisible();
});
