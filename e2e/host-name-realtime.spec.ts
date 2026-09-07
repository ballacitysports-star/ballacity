import { test, expect, type Page } from "@playwright/test";
import {
  emailLocalPart,
  expectHostName,
  restoreSession,
  seedHostedGame,
  sessionDisplayName,
  throttleProfileReads,
  watchForForbidden,
} from "./helpers/seeded-host-game";

/**
 * E2E: while the detail page and feed card are mounted, force the refetches a
 * `postgres_changes` event would trigger, with `profiles` reads slowed. The
 * host name must hold `display_name` continuously — it must not flicker to the
 * email local-part or to the "Host" placeholder while a refetch is in flight.
 *
 * A single assertion after the fact would miss a brief flicker, so this one
 * samples the page repeatedly across the refetch window.
 *
 * Companion to:
 *   - host-name-throttled.spec.ts (slow profile reads)
 *   - host-name-deeplink.spec.ts  (cold deep-link / hard reload)
 */

const THROTTLE_MS = 2500;
const SAMPLE_DURATION_MS = 4000;

test.skip(
  !process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ||
    !process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

/** Force a refetch the same way a realtime postgres_changes handler would. */
async function fireRealtimeStyleInvalidations(page: Page) {
  await page.evaluate(() => {
    // The app exposes the React Query client on window for debug; if it
    // isn't, fall back to dispatching a focus event which also triggers
    // refetchOnWindowFocus.
    const qc = (
      window as unknown as { queryClient?: { invalidateQueries: (opts?: unknown) => void } }
    ).queryClient;
    if (qc?.invalidateQueries) {
      qc.invalidateQueries();
    } else {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    }
  });
}

async function pumpRefetches(page: Page) {
  for (let i = 0; i < 3; i++) {
    await fireRealtimeStyleInvalidations(page);
    await page.waitForTimeout(300);
  }
}

test("realtime refetches never flicker the host name off display_name", async ({ page }) => {
  const displayName = sessionDisplayName();
  const emailPrefix = emailLocalPart();
  const forbidden = emailPrefix && emailPrefix !== displayName ? emailPrefix : null;

  await restoreSession(page);
  const game = await seedHostedGame(page, { idSuffix: "realtime", hostName: displayName });

  // Detail page settles first, so the refetches below act on a warm page.
  await page.goto(game.url, { waitUntil: "domcontentloaded" });
  await expectHostName(page, displayName, emailPrefix);

  // Now slow the profile reads and drive repeated refetches.
  await throttleProfileReads(page, THROTTLE_MS);
  await pumpRefetches(page);

  const detail = await watchForForbidden(page, forbidden, SAMPLE_DURATION_MS);
  expect(detail.seen, `"${detail.seen}" appeared as the host on the detail page`).toBeNull();
  await expectHostName(page, displayName, emailPrefix);

  // Same again on the feed card.
  await page.goto("/feed");
  const card = page
    .locator('article, [data-testid="game-card"]')
    .filter({ hasText: game.title })
    .first();
  await card.waitFor({ state: "visible", timeout: 15_000 });
  await expect(card).toContainText(displayName);

  await pumpRefetches(page);
  const feed = await watchForForbidden(page, forbidden, SAMPLE_DURATION_MS);
  expect(feed.seen, `"${feed.seen}" appeared as the host on the feed card`).toBeNull();
  await expect(card).toContainText(displayName);
});
