import { test, expect, devices } from "@playwright/test";

/**
 * E2E: /auth provider list shows ONLY Google across common viewports.
 * - Apple (and any other social provider) must be absent.
 * - No leftover placeholder text ("TODO", "coming soon", "…", "Placeholder").
 * - No layout artifacts: no orphan divider without providers on both sides,
 *   no empty provider buttons, no stacked empty gaps between Google and the
 *   email form.
 */

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },        // iPhone 14
  { name: "tablet", width: 820, height: 1180 },       // iPad Air
  { name: "desktop", width: 1440, height: 900 },
] as const;

const FORBIDDEN_PROVIDERS = [
  /apple/i,
  /facebook/i,
  /github/i,
  /twitter|^x$/i,
  /microsoft/i,
  /discord/i,
];

const PLACEHOLDER_PATTERNS = [
  /todo/i,
  /coming soon/i,
  /placeholder/i,
  /lorem ipsum/i,
  /\bTBD\b/,
];

for (const vp of VIEWPORTS) {
  test.describe(`auth providers at ${vp.name} (${vp.width}x${vp.height})`, () => {
    test.use({ viewport: { width: vp.width, height: vp.height } });

    test("shows only Google, no placeholders, no spacing artifacts", async ({ page }) => {
      await page.goto("/auth", { waitUntil: "domcontentloaded" });

      // Google is present exactly once.
      const google = page.getByRole("button", { name: /continue with google/i });
      await expect(google).toBeVisible();
      await expect(google).toHaveCount(1);

      // No other social providers.
      for (const pattern of FORBIDDEN_PROVIDERS) {
        await expect(
          page.getByRole("button", { name: pattern }),
          `unexpected provider button matching ${pattern}`,
        ).toHaveCount(0);
        await expect(
          page.getByRole("link", { name: pattern }),
          `unexpected provider link matching ${pattern}`,
        ).toHaveCount(0);
      }

      // No placeholder copy anywhere on the page.
      for (const pattern of PLACEHOLDER_PATTERNS) {
        await expect(
          page.getByText(pattern),
          `placeholder copy matching ${pattern} still present`,
        ).toHaveCount(0);
      }

      // The "or" divider must sit between Google (above) and the email
      // input (below). If either side is missing, the divider is an
      // orphan spacing artifact.
      const divider = page.getByText(/^or$/i).first();
      await expect(divider).toBeVisible();

      const emailInput = page.getByPlaceholder(/email/i);
      await expect(emailInput).toBeVisible();

      const googleBox = await google.boundingBox();
      const dividerBox = await divider.boundingBox();
      const emailBox = await emailInput.boundingBox();
      expect(googleBox && dividerBox && emailBox).toBeTruthy();
      expect(dividerBox!.y).toBeGreaterThan(googleBox!.y);
      expect(emailBox!.y).toBeGreaterThan(dividerBox!.y);

      // Guard against a runaway gap where a removed provider used to live:
      // the divider should be within ~140px of the Google button on every
      // viewport. This catches accidental empty margin/padding blocks.
      const gap = dividerBox!.y - (googleBox!.y + googleBox!.height);
      expect(gap, `too much vertical space between Google and divider (${gap}px)`).toBeLessThan(140);

      // No empty <button> nodes (an emptied Apple button would leave one).
      const emptyButtons = await page.evaluate(() =>
        Array.from(document.querySelectorAll("button")).filter((el) => {
          if (el.hasAttribute("aria-hidden")) return false;
          const text = (el.textContent ?? "").trim();
          const hasIcon = !!el.querySelector("svg, img");
          const hasLabel = !!el.getAttribute("aria-label");
          return text.length === 0 && !hasIcon && !hasLabel;
        }).length,
      );
      expect(emptyButtons, "found empty button element(s) on /auth").toBe(0);
    });
  });
}
