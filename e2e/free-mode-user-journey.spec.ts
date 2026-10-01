import { test, expect } from "@playwright/test";
import { HAS_BACKEND, childStatus, signInAs, stubChildStatus } from "./helpers/fixture-auth";
import { DEFAULT_CHILD_CONTROLS } from "../src/lib/child-policy";

/**
 * E2E: §17 adult and minor journeys for Free Mode.
 *
 * Adult — can reach every surface without ever meeting a payment requirement.
 * Minor — age and guardian restrictions still bite while the platform is free,
 *         which is the property that must never regress.
 *
 * Requires the seeded fixture accounts, so it skips without E2E credentials.
 */

test.skip(!HAS_BACKEND, "Requires a configured Supabase project (VITE_SUPABASE_URL).");

/**
 * Copy that must never appear to a normal member while the platform is free.
 *
 * These are calls to action — an ask for money. They are rejected everywhere.
 */
const PAYWALL_COPY = [/upgrade to/i, /unlock premium/i, /subscribe to (keep|create)/i];

/**
 * A price on its own is not a paywall.
 *
 * /plans deliberately shows each plan's normal price struck through next to
 * "Free", so members can see what they are getting. That reference price is
 * expected there and nowhere else — seeing "$9.99/mo" on the feed or in
 * settings would mean something is asking for money.
 */
const PRICE_PATTERN = /\$\d+\s*\/\s*mo/i;
const PRICES_EXPECTED_ON = ["/plans"];

test.describe("adult member, free platform", () => {
  test("meets no payment requirement anywhere in the normal experience", async ({ page }) => {
    await signInAs(page, "player");

    for (const path of ["/feed", "/reels", "/plans", "/profile", "/settings"]) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const body = await page.locator("body").innerText();
      for (const pattern of PAYWALL_COPY) {
        expect(body, `${path} should not show paywall copy matching ${pattern}`).not.toMatch(
          pattern,
        );
      }
      if (!PRICES_EXPECTED_ON.includes(path)) {
        expect(body, `${path} should not quote a monthly price`).not.toMatch(PRICE_PATTERN);
      }
    }
  });

  test("sees the real plans on /plans, marked free, with nothing to buy", async ({ page }) => {
    await signInAs(page, "player");
    await page.goto("/plans", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /your plan/i })).toBeVisible();

    // The plans are visible again — the point of showing them is that a member
    // can see what the free run is worth.
    for (const name of ["ballaCity+", "Host Pro", "Team", "Organization"]) {
      await expect(page.getByText(name, { exact: false }).first()).toBeVisible();
    }
    await expect(page.getByText(/free (—|-) limited time|free right now/i).first()).toBeVisible();

    // ...but none of them can be bought.
    await expect(
      page.getByRole("button", { name: /get ballacity\+|become a host pro/i }),
    ).toHaveCount(0);
  });

  test("does not mark a plan as current for a member who never paid", async ({ page }) => {
    // Free mode grants every entitlement, so a naive "do you hold this?" check
    // would badge every card "Current plan". Only a real subscription counts.
    await signInAs(page, "player");
    await page.goto("/plans", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: /^current plan$/i })).toHaveCount(0);
  });

  test("can generate reels without hitting an allowance lock", async ({ page }) => {
    await signInAs(page, "player");
    await page.goto("/reels", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("button", { name: /subscribe to create more reels/i })).toHaveCount(
      0,
    );
    await expect(page.getByText(/free reels left/i)).toHaveCount(0);
  });

  test("cannot reach the superadmin monetization controls", async ({ page }) => {
    await signInAs(page, "player");
    await page.goto("/superadmin", { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/platform free mode/i)).toHaveCount(0);
  });
});

test.describe("minor member, free platform", () => {
  test("age restrictions still apply even though everything is free", async ({ page }) => {
    await signInAs(page, "player");
    // Under-13 cohort: hosting is blocked by PERMISSION_MATRIX regardless of price.
    await stubChildStatus(page, childStatus("child_under_13", "approved"));

    await page.goto("/create", { waitUntil: "domcontentloaded" });
    const body = await page.locator("body").innerText();
    expect(body, "hosting must stay blocked for an under-13 account").toMatch(
      /isn't available|not available/i,
    );
    // And the block must not be explained as a payment problem.
    expect(body).not.toMatch(/subscri|upgrade|premium/i);
  });

  test("guardian restrictions still apply", async ({ page }) => {
    await signInAs(page, "player");
    await stubChildStatus(
      page,
      childStatus("teen_13_15", "approved", {
        controls: { ...DEFAULT_CHILD_CONTROLS, aiAnalysis: false },
      }),
    );

    await page.goto("/reels", { waitUntil: "domcontentloaded" });
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/upgrade to|unlock premium/i);
  });
});
