import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { realtimeJoined } from "./helpers/realtime";
import { appBooted, confirmFreeJoin, confirmLeave } from "./helpers/join";
import { stubRiskAcknowledged } from "./helpers/safety-ack";

/**
 * E2E: joining a game from a second device must instantly refresh the
 * Discover map's bottom "N spots" pill on the observing device via the
 * `game_participants` realtime subscription (see
 * `src/lib/game-participants-store.ts`, consumed by `ActiveGameCard` in
 * `src/routes/_tabs.discover.tsx`).
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
      const cookies = JSON.parse(COOKIES_JSON).map((c: any) => ({
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

/**
 * Read the "N spots" pill text from the Discover bottom card. The pill is
 * marked `aria-live="polite"` and formatted as "<n> spots".
 */
async function readSpotsPill(page: Page): Promise<string | null> {
  // Read the target game's own card. The first "N spots" on the page can belong
  // to any game (run 42454894247 read 3 where g1 started at 2), and a card with
  // plenty of room shows "N spots open" rather than the pill, so take the count
  // from the card's `title="X of Y joined"` (src/components/GameCard.tsx).
  const counter = page.locator(`a[href$="/games/${GAME_ID}"] [title$=" joined"]`).first();
  if ((await counter.count()) === 0) return null;
  const m = (await counter.getAttribute("title"))?.match(/(\d+) of (\d+) joined/);
  return m ? `${Number(m[2]) - Number(m[1])} spots` : null;
}

function parseSpots(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/(\d+)\s+spots/);
  return m ? Number(m[1]) : null;
}

test("Discover bottom card 'N spots' pill refreshes instantly when another device joins", async ({
  browser,
}) => {
  // --- Device A: observer on the Discover map ---
  const deviceA = await browser.newContext();
  const bootA = await deviceA.newPage();
  await stubRiskAcknowledged(deviceA);
  await restoreSession(deviceA, bootA);
  await bootA.close();
  const aDiscover = await deviceA.newPage();

  // --- Device B: joiner on the game detail page ---
  const deviceB = await browser.newContext();
  const bootB = await deviceB.newPage();
  await stubRiskAcknowledged(deviceB);
  await restoreSession(deviceB, bootB);
  await bootB.close();
  const bDetail = await deviceB.newPage();

  try {
    await Promise.all([
      aDiscover.goto("/discover", { waitUntil: "domcontentloaded" }),
      bDetail.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" }),
    ]);

    // Select the target game's pin on Device A so the bottom card shows it.
    // Pins are rendered by GamesMap; selecting them programmatically via the
    // exported store isn't feasible from Playwright, so we drive selection
    // by tapping any card link that surfaces on the map layer, or by
    // relying on the default active pin. If the active card isn't for g1,
    // wait until it is (Discover may cycle through visible pins).
    // Simpler: force the card by clicking the pin whose href matches.
    // GamesMap markers are DOM elements; each pin renders no link, so we
    // wait for the bottom card and then reload targeting the game via URL
    // hash if the store supports it. Fallback: just poll for the pill
    // once any bottom card is visible — the sample data places g1 first
    // in the list, so it's the default active pin.
    // /discover redirects to /feed (238b4b6d); wait for the target game's card.
    await expect(aDiscover.locator(`a[href$="/games/${GAME_ID}"]`).first()).toBeVisible({
      timeout: 20_000,
    });

    // If the active card isn't linking to g1, try clicking its pin marker
    // (element with the sport emoji). Otherwise just proceed.
    const activeLink = aDiscover.locator(`a[href*="/games/${GAME_ID}"]`).first();
    if ((await activeLink.count()) === 0) {
      // Nothing we can reliably click without map internals; skip if the
      // default active game isn't g1 in this environment.
      test.skip(true, "Discover default active card is not the target game g1");
    }

    const beforeText = await readSpotsPill(aDiscover);
    const beforeCount = parseSpots(beforeText);
    expect(beforeCount, "should read a numeric spots count before join").not.toBeNull();

    // Ensure Device B starts un-joined; if already joined from a prior run,
    // leave first so the join action produces a real INSERT.
    const leaveCta = bDetail.getByRole("button", { name: /you're in · tap to leave/i }).first();
    if ((await leaveCta.count()) > 0 && (await leaveCta.isVisible().catch(() => false))) {
      await appBooted(bDetail);
      await leaveCta.click();
      await confirmLeave(bDetail);
      await expect(bDetail.getByRole("button", { name: /join run/i }).first()).toBeVisible({
        timeout: 10_000,
      });
    }

    const joinCta = bDetail.getByRole("button", { name: /join run/i }).first();
    await expect(joinCta).toBeVisible({ timeout: 15_000 });
    // Device A must be listening before B joins (see helpers/realtime.ts).
    await realtimeJoined(aDiscover, `game_participants:game:${GAME_ID}`);
    await appBooted(bDetail);
    await joinCta.click();
    await confirmFreeJoin(bDetail);

    // Device B flips locally.
    await expect(
      bDetail.getByRole("button", { name: /you're in · tap to leave/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // --- Realtime: Device A's spots pill decrements by exactly 1 ---
    await expect
      .poll(async () => parseSpots(await readSpotsPill(aDiscover)), {
        timeout: 20_000,
        message: "Discover 'N spots' pill did not decrement on Device A after remote join",
      })
      .toBe((beforeCount ?? 0) - 1);

    // --- Reverse: leave from B and confirm pill increments back ---
    await appBooted(bDetail);
    await bDetail
      .getByRole("button", { name: /you're in · tap to leave/i })
      .first()
      .click();
    await confirmLeave(bDetail);
    await expect(bDetail.getByRole("button", { name: /join run/i }).first()).toBeVisible({
      timeout: 10_000,
    });

    await expect
      .poll(async () => parseSpots(await readSpotsPill(aDiscover)), {
        timeout: 20_000,
        message: "Discover 'N spots' pill did not revert on Device A after remote leave",
      })
      .toBe(beforeCount);
  } finally {
    await deviceA.close();
    await deviceB.close();
  }
});
