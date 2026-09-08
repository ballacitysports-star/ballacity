import { test } from "@playwright/test";
import {
  emailLocalPart,
  expectHostName,
  restoreSession,
  seedHostedGame,
  sessionDisplayName,
  throttleProfileReads,
} from "./helpers/seeded-host-game";

/**
 * E2E: with the `profiles` read deliberately slowed, the host name on both the
 * game detail page and the matching feed card must still be the account's
 * `display_name` — never the email local-part, never the "Host" placeholder.
 *
 * The stored `host_snapshot` is the only source for that name on the read
 * path, so a slow or failed profile lookup must not be able to disturb it.
 * (The create-time resolution that fills the snapshot is unit-tested in
 * src/lib/host-snapshot.test.ts.)
 */

const THROTTLE_MS = 2500;

test.skip(
  !process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ||
    !process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

test("host name stays on display_name under throttled profile reads", async ({ page }) => {
  const displayName = sessionDisplayName();
  const emailPrefix = emailLocalPart();

  await restoreSession(page);
  const game = await seedHostedGame(page, { idSuffix: "throttled", hostName: displayName });
  await throttleProfileReads(page, THROTTLE_MS);

  // Detail page.
  await page.goto(game.url, { waitUntil: "domcontentloaded" });
  await expectHostName(page, displayName, emailPrefix);

  // Feed card for the same game.
  await page.goto("/feed");
  const card = page
    .locator('article, [data-testid="game-card"]')
    .filter({ hasText: game.title })
    .first();
  await card.waitFor({ state: "visible", timeout: 15_000 });
  await expectHostName(page, displayName, emailPrefix);
});
