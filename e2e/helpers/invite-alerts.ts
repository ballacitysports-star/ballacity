/**
 * Open Alerts and tap a seeded notification, for the invite specs that exercise
 * the tap-through path (Alerts → game page).
 *
 * /notifications redirects to /messages?tab=alerts (src/routes/_tabs.notifications.tsx).
 * Against the Vite dev server the first visit in a run compiles the Inbox route
 * on demand: the page shows only "Loading…" for more than 10 seconds, and a spec
 * that waited 10 seconds for the alert itself failed whenever it was the first in
 * the run to open Alerts (the alert was on screen right after). So wait for the
 * Inbox page to render first, with room for that compile.
 *
 * Then wait for the alerts list itself to be read (NotificationsPanel's
 * listMyNotifications) before looking for the alert. The Inbox sends that read
 * together with about thirty others (profile, account switcher, teams, invites,
 * unread counts, conversations), and the list shows nothing until it answers. On
 * a busy backend it answers well after the heading: with every REST answer held
 * 4 s locally it came 12 s after the heading, and on the shared sandbox it missed
 * the 10 seconds the alert used to be given after the heading (CI runs
 * 45104735988 and 44811190432 attempt 3, invite-request-tampered; 44572875048,
 * invite-pay-and-join-confirmation). Once the list is in, the alert is on screen
 * at once, so it keeps its 10 seconds.
 */
import { expect, type Page, type Response } from "@playwright/test";

/** The Alerts list read: `notifications?select=*&order=created_at.desc&limit=100` (src/lib/notifications.ts). */
function isAlertsListRead(res: Response): boolean {
  if (res.request().method() !== "GET") return false;
  const url = new URL(res.url());
  return (
    url.pathname.endsWith("/rest/v1/notifications") &&
    url.searchParams.get("select") === "*" &&
    url.searchParams.get("order") === "created_at.desc"
  );
}

export async function openAlertsAndTap(page: Page, title: string): Promise<void> {
  // The same 30 seconds the Inbox heading gets: the list read goes out with the page's first reads.
  const listRead = page.waitForResponse(isAlertsListRead, { timeout: 30_000 });
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { level: 1, name: /^inbox$/i })).toBeVisible({
    timeout: 30_000,
  });
  const list = await listRead;
  expect(list.ok(), `the Alerts list read failed: HTTP ${list.status()}`).toBe(true);
  const item = page.getByText(title, { exact: false }).first();
  await expect(item).toBeVisible({ timeout: 10_000 });
  await item.click();
}
