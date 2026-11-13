import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { stubRiskAcknowledged } from "./helpers/risk-ack";
import { ensureNotJoined, joinFreeRun, leaveFreeRun } from "./helpers/realtime-join";
import { mapSpotsPill, mapViewUrlFor, readMapSpotsLeft } from "./helpers/realtime-counters";

/**
 * E2E: joining a game from a second device must instantly refresh the
 * Discover map's bottom "N spots" pill on the observing device via realtime
 * (see `src/lib/game-participants-store.ts`, consumed by the map's bottom card
 * in `src/components/PlayMapView.tsx`). Discover is now the feed's Map view:
 * `/discover` redirects to `/feed`, so the observer opens `/feed?view=map`.
 *
 * Two BrowserContexts model two devices, each with its own websocket.
 * Auto-skips without a restored Supabase session. Both "devices" sign in
 * as the same identity — realtime is still exercised because context A's
 * socket receives the INSERT fanned out from context B's write.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const COOKIES_JSON = process.env.LOVABLE_BROWSER_SUPABASE_COOKIES_JSON;

test.skip(
  !SESSION_JSON || !STORAGE_KEY,
  "Requires a signed-in Supabase session (LOVABLE_BROWSER_SUPABASE_* env vars).",
);

// Free, no-approval sample game (src/lib/sample-data.ts → g1).
const GAME_ID = "g1";

async function restoreSession(ctx: BrowserContext, page: Page) {
  if (COOKIES_JSON) {
    try {
      const saved = JSON.parse(COOKIES_JSON) as Parameters<BrowserContext["addCookies"]>[0];
      const cookies = saved.map((c) => ({
        ...c,
        url: "http://localhost:8080",
      }));
      await ctx.addCookies(cookies);
    } catch {
      /* ignore malformed */
    }
  }
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([key, value]) => window.localStorage.setItem(key!, value!),
    [STORAGE_KEY!, SESSION_JSON!],
  );
  await page.evaluate(() => window.localStorage.removeItem("openrun.joinedGameIds.v1"));
}

test("Discover bottom card 'N spots' pill refreshes instantly when another device joins", async ({
  browser,
}) => {
  // --- Device A: observer on the Discover map ---
  const deviceA = await browser.newContext();
  const bootA = await deviceA.newPage();
  await restoreSession(deviceA, bootA);
  await bootA.close();
  const aDiscover = await deviceA.newPage();

  // --- Device B: joiner on the game detail page ---
  const deviceB = await browser.newContext();
  const bootB = await deviceB.newPage();
  await restoreSession(deviceB, bootB);
  await bootB.close();
  const bDetail = await deviceB.newPage();
  await stubRiskAcknowledged(bDetail);

  try {
    // Device B starts un-joined: if a prior run left this account on the
    // roster, leave first (before Device A reads its baseline) so the join
    // under test produces a real INSERT.
    await bDetail.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });
    await ensureNotJoined(bDetail);

    // Device A: the map view, filtered to the target game so its pin is the
    // active one and the bottom card shows it.
    const title = (await bDetail.getByRole("heading", { level: 1 }).first().textContent())?.trim();
    expect(title, "game page should name the game").toBeTruthy();
    await aDiscover.goto(mapViewUrlFor(title!), { waitUntil: "domcontentloaded" });
    await expect(mapSpotsPill(aDiscover, GAME_ID)).toBeVisible({ timeout: 20_000 });

    const beforeCount = await readMapSpotsLeft(aDiscover, GAME_ID);
    expect(beforeCount, "should read a numeric spots count before join").not.toBeNull();

    // Device B joins (through the "Join this run?" confirmation) and flips locally.
    await joinFreeRun(bDetail);

    // --- Realtime: Device A's spots pill decrements by exactly 1 ---
    await expect
      .poll(async () => readMapSpotsLeft(aDiscover, GAME_ID), {
        timeout: 20_000,
        message: "Discover 'N spots' pill did not decrement on Device A after remote join",
      })
      .toBe((beforeCount ?? 0) - 1);

    // --- Reverse: leave from B and confirm pill increments back ---
    await leaveFreeRun(bDetail);

    await expect
      .poll(async () => readMapSpotsLeft(aDiscover, GAME_ID), {
        timeout: 20_000,
        message: "Discover 'N spots' pill did not revert on Device A after remote leave",
      })
      .toBe(beforeCount);
  } finally {
    await deviceA.close();
    await deviceB.close();
  }
});
