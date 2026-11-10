import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * P3-5 accessibility gate: axe finds no serious or critical WCAG 2.1 A/AA violation on the main
 * public pages, signed out, at desktop and phone width.
 *
 * Baseline (2026-11-09, dev server on the E2E sandbox): 18 public pages scanned. The only
 * serious finding was `aria-prohibited-attr` on the skip-link target (an `aria-label` on a plain
 * div), on every page; it is fixed in the same change, which leaves zero. These tests keep it
 * there. Moderate and minor findings are reported in the test output but do not fail it yet.
 */

const PAGES = [
  "/",
  "/auth",
  "/privacy",
  "/terms",
  "/safety",
  "/youth-policy",
  "/guide",
  "/cities",
  "/highlights",
  "/tryouts",
] as const;

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING = new Set(["serious", "critical"]);

async function blockingViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const blocking = result.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
  const other = result.violations.filter((v) => !BLOCKING.has(v.impact ?? ""));
  if (other.length) {
    console.log(
      `a11y (not blocking) ${page.url()}: ${other.map((v) => `${v.impact} ${v.id} x${v.nodes.length}`).join(", ")}`,
    );
  }
  return blocking.map(
    (v) =>
      `${v.impact} ${v.id} (${v.help}) at ${v.nodes
        .slice(0, 3)
        .map((n) => n.target.join(" "))
        .join(" | ")}`,
  );
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: "domcontentloaded" });
  // Wait for the routed page, not the shell: the skip-link target sits right before it. Generous,
  // because this spec sorts first and can meet a dev server still compiling its first page.
  await expect(page.locator("#main-content")).toBeAttached({ timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
}

test.describe("accessibility: public pages (P3-5)", () => {
  // Signed out: these are the pages a visitor sees first.
  test.use({ storageState: { cookies: [], origins: [] } });

  for (const path of PAGES) {
    test(`no serious or critical axe violations on ${path}`, async ({ page }) => {
      await open(page, path);
      expect(await blockingViolations(page)).toEqual([]);
    });
  }

  test("no serious or critical axe violations on / at phone width", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page, "/");
    expect(await blockingViolations(page)).toEqual([]);
  });
});
