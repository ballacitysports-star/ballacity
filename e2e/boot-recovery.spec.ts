import { expect, test } from "@playwright/test";

test("failed client boot reloads once, then shows recovery actions", async ({ page }) => {
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

  await expect(page.getByText("We could not finish loading")).toBeVisible({ timeout: 22_000 });
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Sign in again" })).toHaveAttribute("href", "/auth");
  await expect(page.getByRole("link", { name: "Go home" })).toHaveAttribute("href", "/");
  expect(documentRequests, "the watchdog must perform only one automatic reload").toBe(2);
});

test("a silently stalled startup module reloads once, then becomes actionable", async ({ page }) => {
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
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.isNavigationRequest()) documentRequests += 1;
  });

  await page.route("**/virtual:tanstack-start-dev-client-entry", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 10_000));
    await route.continue();
  });

  await page.goto("/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /OpenRun/i }).first()).toBeVisible({
    timeout: 18_000,
  });
  expect(documentRequests, "a slow but healthy startup must not be reloaded").toBe(1);
});