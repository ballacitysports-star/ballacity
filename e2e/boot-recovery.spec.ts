import { expect, test, type Page } from "@playwright/test";
import {
  BOOT_PROGRESS_GRACE_MS,
  BOOT_TIMEOUT_MS,
  BOOT_WATCHDOG_DEV_OPT_IN,
} from "../src/lib/boot-watchdog";

/**
 * The boot watchdog (src/lib/boot-watchdog.ts) is an inline script that
 * recovers a page whose client never boots: one automatic reload, then a panel
 * with recovery actions.
 *
 * E2E runs against the development server, where the watchdog is off so the
 * Lovable preview is never reloaded while Vite compiles. The recovery tests opt
 * in before the document's own scripts run, on every navigation including the
 * watchdog's reload, so they exercise the same script production ships.
 */
async function enableBootWatchdog(page: Page) {
  await page.addInitScript((flag) => {
    (window as unknown as Record<string, unknown>)[flag] = true;
  }, BOOT_WATCHDOG_DEV_OPT_IN);
}

/**
 * A dead page is given the full budget on both loads (the budget is not
 * shortened after a retry, see the watchdog), plus the one-second polling
 * tick each time, before the panel appears.
 */
const RECOVERY_PANEL_TIMEOUT = 2 * (BOOT_TIMEOUT_MS + BOOT_PROGRESS_GRACE_MS + 1_000) + 10_000;

test("the app boots with the dependency-free OG image endpoint", async ({ page, request }) => {
  const rootResponse = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(rootResponse?.status()).toBe(200);
  await expect
    .poll(() => page.evaluate(() => window.__openrun_booted === true), { timeout: 30_000 })
    .toBe(true);

  const ogResponse = await request.get(
    "/api/public/og?kind=game&title=Startup%20check&subtitle=Renderer%20isolated&size=og",
  );
  expect(ogResponse.status()).toBe(200);
  expect(ogResponse.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
  expect(await ogResponse.text()).toContain("<svg");
});

test("failed client boot reloads once, then shows recovery actions", async ({ page }) => {
  await enableBootWatchdog(page);
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documentRequests += 1;
  });

  await page.route("**/*", async (route) => {
    if (route.request().resourceType() === "script") {
      await route.abort("failed");
      return;
    }
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("We could not finish loading")).toBeVisible({
    timeout: RECOVERY_PANEL_TIMEOUT,
  });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/auth");
  await expect(page.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  expect(documentRequests, "the watchdog must perform only one automatic reload").toBe(2);
});

test("a silently stalled startup module reloads once, then becomes actionable", async ({
  page,
}) => {
  await enableBootWatchdog(page);
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documentRequests += 1;
  });

  await page.route("**/virtual:tanstack-start-dev-client-entry", async (route) => {
    await route.abort("failed");
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("We could not finish loading")).toBeVisible({
    timeout: RECOVERY_PANEL_TIMEOUT,
  });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(documentRequests, "a silent startup stall must reload at most once").toBe(2);
});

/**
 * How long the slow-boot test holds back the client entry module: most of the
 * watchdog's budget, but short of it, so the stall alone can never trip it.
 * The rest of the boot (the dev server's module graph, then hydration) then
 * finishes near or past the budget; on a cold dev server it runs well past it,
 * where only the watchdog's progress checks keep the page from being reloaded.
 */
const SLOW_ENTRY_STALL_MS = BOOT_TIMEOUT_MS - 2_000;

/**
 * What a healthy boot may take once the entry module arrives, on a slow CI
 * runner against the development server. The plain boot test above allows the
 * same 30s.
 */
const COLD_BOOT_ALLOWANCE_MS = 30_000;

test("slow client boot is not interrupted by an automatic reload", async ({ page }) => {
  const bootDeadline = SLOW_ENTRY_STALL_MS + COLD_BOOT_ALLOWANCE_MS;
  test.setTimeout(bootDeadline + 30_000);
  await enableBootWatchdog(page);
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documentRequests += 1;
  });

  let entryStalled = false;
  await page.route("**/virtual:tanstack-start-dev-client-entry", async (route) => {
    entryStalled = true;
    await new Promise((resolve) => setTimeout(resolve, SLOW_ENTRY_STALL_MS));
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect
    .poll(() => page.evaluate(() => window.__openrun_booted === true), { timeout: bootDeadline })
    .toBe(true);
  expect(entryStalled, "the client entry module must have been held back").toBe(true);
  // Booted, so the watchdog has stopped: any reload it made has already happened.
  expect(documentRequests, "a slow but healthy startup must not be reloaded").toBe(1);
  await expect(page.getByRole("heading", { name: /ballaCity/i }).first()).toBeVisible();
});
