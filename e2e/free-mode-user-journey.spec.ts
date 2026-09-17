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

/** Copy that must never appear to a normal member while the platform is free. */
const PAYWALL_COPY = [
  /upgrade to/i,
  /unlock premium/i,
  /subscribe to (keep|create)/i,
  /\$\d+\s*\/\s*mo/i,
];

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
    }
  });

  test("sees /plans as an inclusive page with no prices or checkout", async ({ page }) => {
    await signInAs(page, "player");
    await page.goto("/plans", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: /your plan/i })).toBeVisible();
    await expect(
      page.getByRole("button", { name: /get ballacity\+|become a host pro/i }),
    ).toHaveCount(0);
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
