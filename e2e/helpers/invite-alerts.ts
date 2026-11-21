/**
 * Open Alerts and tap a seeded notification, for the invite specs that exercise
 * the tap-through path (Alerts → game page).
 *
 * /notifications redirects to /messages?tab=alerts (src/routes/_tabs.notifications.tsx).
 * Against the Vite dev server the first visit in a run compiles the Inbox route
 * on demand: the page shows only "Loading…" for more than 10 seconds, and a spec
 * that waited 10 seconds for the alert itself failed whenever it was the first in
 * the run to open Alerts (the alert was on screen right after). So wait for the
 * Inbox page to render first, with room for that compile, and only then give the
 * alert the usual 10 seconds.
 */
import { expect, type Page } from "@playwright/test";

export async function openAlertsAndTap(page: Page, title: string): Promise<void> {
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: /^inbox$/i })).toBeVisible({
    timeout: 30_000,
  });
  const item = page.getByText(title, { exact: false }).first();
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
}
