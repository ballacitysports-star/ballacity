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
 * E2E: the "cold open" companion to host-name-throttled.spec.ts.
 *
 * Open a game's detail page directly in a brand-new browser context — no warm
 * React Query cache, no prior navigation — with both the game and profile
 * reads slowed, the way a shared link opened on a bad connection behaves. The
 * host name must render `display_name` and hold it across a hard reload,
 * never showing the email local-part or the "Host" placeholder.
 */

const PROFILE_THROTTLE_MS = 2500;
const GAME_THROTTLE_MS = 1250;

test.skip(
  !process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON ||
    !process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

test("cold deep-link and hard reload keep display_name as the host", async ({ browser }) => {
  const displayName = sessionDisplayName();
  const emailPrefix = emailLocalPart();

  // A fresh context guarantees nothing is warm.
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  await restoreSession(page);
  const game = await seedHostedGame(page, {
    idSuffix: "deeplink",
    hostName: displayName,
    delayMs: GAME_THROTTLE_MS,
  });
  await throttleProfileReads(page, PROFILE_THROTTLE_MS);

  // Straight to the deep link, as a shared URL would.
  await page.goto(game.url, { waitUntil: "domcontentloaded" });
  await expectHostName(page, displayName, emailPrefix, 20_000);

  // Hard reload — no in-memory React state survives this.
  await page.reload({ waitUntil: "domcontentloaded" });
  await expectHostName(page, displayName, emailPrefix, 20_000);

  await ctx.close();
});
