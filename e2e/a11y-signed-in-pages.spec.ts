import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { HAS_BACKEND, signInAs } from "./helpers/fixture-auth";

/**
 * P3-5 accessibility gate, signed in: axe finds no serious or critical WCAG 2.1 A/AA violation on
 * the main signed-in screens, as the adult `host` fixture account (the public pages are covered by
 * a11y-public-pages.spec.ts). Moderate and minor findings are printed but do not fail the test.
 */

test.skip(!HAS_BACKEND, "Requires backend env (VITE_SUPABASE_URL / SUPABASE_URL).");

const PAGES = [
  "/feed",
  "/discover",
  "/teams",
  "/players",
  "/messages",
  "/notifications",
  "/profile",
  "/settings",
  "/create",
] as const;

const WCAG = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const BLOCKING = new Set(["serious", "critical"]);

async function blockingViolations(page: Page) {
  const result = await new AxeBuilder({ page }).withTags(WCAG).analyze();
  const blocking = result.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
  const other = result.violations.filter((v) => !BLOCKING.has(v.impact ?? ""));
  if (other.length) {
    console.log(
      `a11y (not blocking) ${new URL(page.url()).pathname}: ${other
        .map((v) => `${v.impact} ${v.id} x${v.nodes.length}`)
        .join(", ")}`,
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
  await expect(page.locator("#main-content")).toBeAttached({ timeout: 45_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  // A signed-in page must not have bounced to sign-in, or this would re-check /auth.
  await expect(page).not.toHaveURL(/\/auth(?:[?#].*)?$/);
}

test.describe("accessibility: signed-in pages (P3-5)", () => {
  // One sign-in for the whole file: the pages are only read, and nine back-to-back sign-ins of the
  // same fixture account were seen to bounce a later page to /auth.
  test.describe.configure({ mode: "serial" });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    page = await context.newPage();
    await signInAs(page, "host");
  });

  test.afterAll(async () => {
    await page?.context().close();
  });

  for (const path of PAGES) {
    test(`no serious or critical axe violations on ${path}`, async () => {
      await open(page, path);
      expect(await blockingViolations(page)).toEqual([]);
    });
  }
});
