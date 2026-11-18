/**
 * Where an expired or malformed invite sends the viewer: the game-discovery page.
 *
 * The "Invite expired" banner links to /discover and the blocked join CTA
 * navigates there. /discover is now only a redirect (src/routes/_tabs.discover.tsx):
 * discovery was merged into /feed, the "Pickup runs" list, and /discover is kept
 * so older links still resolve. The URL therefore never settles on /discover; the
 * viewer lands on /feed.
 */
import { expect, type Page } from "@playwright/test";

export const DISCOVERY_PATH = "/feed";

/** Wait until the viewer is on the discovery page (after the /discover redirect). */
export async function expectOnDiscovery(page: Page): Promise<void> {
  await page.waitForURL((u) => u.pathname === DISCOVERY_PATH, { timeout: 10_000 });
  await expect(page.getByRole("heading", { level: 1, name: /pickup runs/i })).toBeAttached({
    timeout: 10_000,
  });
}
