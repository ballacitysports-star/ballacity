import { expect, test } from "@playwright/test";

/**
 * The E2E suite runs on the Vite dev server, where the boot watchdog is off by
 * default (1509aec8: on-demand compilation must not be interrupted). These
 * specs test the watchdog itself, so they switch it on before the page's
 * inline scripts run (see BOOT_WATCHDOG_DEV_SCRIPT in src/routes/__root.tsx).
 */
async function enableBootWatchdog(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    (
      window as unknown as { __openrun_force_boot_watchdog?: boolean }
    ).__openrun_force_boot_watchdog = true;
  });
}

test("the app boots with the dependency-free OG image endpoint", async ({ page, request }) => {
  const rootResponse = await page.goto("/", { waitUntil: "domcontentloaded" });
  expect(rootResponse?.status()).toBe(200);
  // Tolerate a document reload while polling: on a cold dev server Vite can
  // reload the page once after optimizing dependencies, which destroys the
  // evaluate's context (run 42407610703). The app booting is what counts.
  await expect
    .poll(() => page.evaluate(() => window.__openrun_booted === true).catch(() => false), {
      timeout: 30_000,
    })
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

  // Two full watchdog cycles (BOOT_TIMEOUT_MS 12 s + BOOT_PROGRESS_GRACE_MS 4 s
  // each, around one reload): 1509aec8 dropped the shortened second cycle, so
  // the panel appears after ~33 s, as in the stalled-module case below.
  await expect(page.getByText("We could not finish loading")).toBeVisible({ timeout: 42_000 });
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

  await expect(page.getByText("We could not finish loading")).toBeVisible({ timeout: 42_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(documentRequests, "a silent startup stall must reload at most once").toBe(2);
});

test("slow client boot is not interrupted by an automatic reload", async ({ page }) => {
  await enableBootWatchdog(page);
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documentRequests += 1;
  });

  await page.route("**/virtual:tanstack-start-dev-client-entry", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /ballaCity/i }).first()).toBeVisible({
    timeout: 18_000,
  });
  expect(documentRequests, "a slow but healthy startup must not be reloaded").toBe(1);
});
