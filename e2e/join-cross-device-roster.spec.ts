import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { stubRiskAcknowledged } from "./helpers/risk-ack";
import { ensureNotJoined, joinFreeRun, leaveFreeRun } from "./helpers/realtime-join";
import {
  mapSpotsPill,
  mapViewUrlFor,
  profileGamesHeading,
  readCardJoinedCount,
  readMapSpotsLeft,
} from "./helpers/realtime-counters";

/**
 * E2E: when a participant joins from another device, the roster list and
 * "Joined X/Max" counter badges must update in real time on every open
 * surface of a second device without a refresh — game detail (roster list
 * + spots counter), feed card, discover map card, and profile upcoming.
 * (Discover is now the feed's Map view; `/discover` redirects to `/feed`.)
 *
 * Two independent BrowserContexts model two devices, each with its own
 * websocket. Auto-skips without a restored Supabase session. Since we only
 * have one authenticated identity available, both "devices" sign in as the
 * same user; realtime propagation is still exercised end-to-end because the
 * `game_participants` INSERT fans out over a distinct socket for context A.
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
  // Start un-joined for this game so the join action is meaningful.
  await page.evaluate(() => window.localStorage.removeItem("openrun.joinedGameIds.v1"));
}

async function readSpotsFromDetail(page: Page): Promise<string | null> {
  // Roster header on the detail page renders as "Roster (X/Y)".
  const header = page.getByText(/Roster \(\d+\/\d+\)/).first();
  if ((await header.count()) === 0) return null;
  return (await header.textContent())?.trim() ?? null;
}

test("another device joining updates roster + counters on feed, map, detail, profile", async ({
  browser,
}) => {
  // --- Device A: passive observer with four surfaces open ---
  const deviceA = await browser.newContext();
  const bootA = await deviceA.newPage();
  await restoreSession(deviceA, bootA);
  await bootA.close();

  const aDetail = await deviceA.newPage();
  const aFeed = await deviceA.newPage();
  const aMap = await deviceA.newPage();
  const aProfile = await deviceA.newPage();

  // --- Device B: joiner ---
  const deviceB = await browser.newContext();
  const bootB = await deviceB.newPage();
  await restoreSession(deviceB, bootB);
  await bootB.close();
  const bDetail = await deviceB.newPage();
  await stubRiskAcknowledged(bDetail);

  try {
    // Device B starts un-joined: if a prior run left this account on the
    // roster, leave first (before Device A reads its baselines) so the join
    // under test produces a real INSERT.
    await bDetail.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });
    await ensureNotJoined(bDetail);

    // The feed and the map are filtered to this game by its title, so its card
    // is on screen (and is the map's active bottom card) whatever else exists.
    const title = (await bDetail.getByRole("heading", { level: 1 }).first().textContent())?.trim();
    expect(title, "game page should name the game").toBeTruthy();

    // Open Device A's surfaces one at a time, each until it shows the game.
    //
    // They used to be opened together and then given 15 s each. Every surface is
    // a cold boot of the app on the dev server (about 550 module requests and ten
    // server-function calls, then the sign-in, age and account-type checks), and
    // four booting at once in one browser share its six connections to the dev
    // server and the server's single thread: each takes two to three times as
    // long as it does alone, the game page longest. On CI (main, run 1332) the
    // game page had not drawn its roster after 15 s; the sandbox's request log
    // for that window shows every request answered in milliseconds, but Device
    // A's tabs sending their first auth checks 2 to 7 s after loading and the
    // game page never asking for its roster at all. In turn, each surface has its
    // budget to itself, and all four are still open before the join, so what
    // changes on them afterwards still arrives over realtime.
    await aDetail.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });
    await expect(aDetail.getByText(/Roster \(\d+\/\d+\)/).first()).toBeVisible({
      timeout: 15_000,
    });
    await aFeed.goto(`/feed?q=${encodeURIComponent(title!)}`, { waitUntil: "domcontentloaded" });
    await expect
      .poll(async () => readCardJoinedCount(aFeed, GAME_ID), {
        timeout: 15_000,
        message: "feed card counter for the game never rendered on Device A",
      })
      .not.toBeNull();
    await aMap.goto(mapViewUrlFor(title!), { waitUntil: "domcontentloaded" });
    await expect(mapSpotsPill(aMap, GAME_ID)).toBeVisible({ timeout: 20_000 });
    // The profile has drawn its lists before the join, so the game appearing
    // there afterwards is the realtime update, not its first load.
    await aProfile.goto("/profile", { waitUntil: "domcontentloaded" });
    await expect(profileGamesHeading(aProfile)).toBeVisible({ timeout: 15_000 });
    const beforeRoster = await readSpotsFromDetail(aDetail);
    const beforeFeed = (await readCardJoinedCount(aFeed, GAME_ID))!;
    const beforeMap = await readMapSpotsLeft(aMap, GAME_ID);
    expect(beforeMap, "map card should show a spots count").not.toBeNull();

    // Device B joins (through the "Join this run?" confirmation) and flips locally.
    await joinFreeRun(bDetail);

    // --- Realtime propagation to Device A ---

    // 1. Detail: roster header count must change (increase by 1).
    await expect
      .poll(async () => await readSpotsFromDetail(aDetail), {
        timeout: 20_000,
        message: "detail roster header did not update on Device A",
      })
      .not.toBe(beforeRoster);

    // 2. Feed card: one more player joined.
    await expect
      .poll(async () => await readCardJoinedCount(aFeed, GAME_ID), {
        timeout: 20_000,
        message: "feed card counter did not update on Device A",
      })
      .toBe(beforeFeed + 1);

    // 3. Map surface: the bottom card's spots pill has one spot fewer.
    await expect
      .poll(async () => await readMapSpotsLeft(aMap, GAME_ID), {
        timeout: 20_000,
        message: "map card counter did not update on Device A",
      })
      .toBe(beforeMap! - 1);

    // 4. Profile: because both devices are the same user, joining from B
    // also puts the game in this user's upcoming list on A via realtime.
    await expect(aProfile.locator(`a[href*="/games/${GAME_ID}"]`).first()).toBeVisible({
      timeout: 20_000,
    });

    // --- Reverse: leave from B and confirm Device A tears back down ---
    await leaveFreeRun(bDetail);

    await expect
      .poll(async () => await readSpotsFromDetail(aDetail), {
        timeout: 20_000,
        message: "detail roster header did not revert after leave on Device A",
      })
      .toBe(beforeRoster);
  } finally {
    await deviceA.close();
    await deviceB.close();
  }
});
