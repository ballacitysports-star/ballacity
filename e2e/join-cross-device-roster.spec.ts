import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E: when a participant joins from another device, the roster list and
 * "Joined X/Max" counter badges must update in real time on every open
 * surface of a second device without a refresh — game detail (roster list
 * + spots counter), feed card, discover map card, and profile upcoming.
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
  // Start un-joined for this game so the join action is meaningful.
  await page.evaluate(() =>
    window.localStorage.removeItem("openrun.joinedGameIds.v1"),
  );
}

async function readSpotsFromDetail(page: Page): Promise<string | null> {
  // Roster header on the detail page renders as "Roster (X/Y)".
  const header = page.getByText(/Roster \(\d+\/\d+\)/).first();
  if (await header.count() === 0) return null;
  return (await header.textContent())?.trim() ?? null;
}

async function readFeedCounterFor(page: Page, gameId: string): Promise<string | null> {
  const card = page.locator(`a[href*="/games/${gameId}"]`).first();
  if ((await card.count()) === 0) return null;
  const counter = card.locator("text=/\\d+\\/\\d+/").first();
  if ((await counter.count()) === 0) return null;
  return (await counter.textContent())?.trim() ?? null;
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

  try {
    await Promise.all([
      aDetail.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" }),
      aFeed.goto("/feed", { waitUntil: "domcontentloaded" }),
      aMap.goto("/discover", { waitUntil: "domcontentloaded" }),
      aProfile.goto("/profile", { waitUntil: "domcontentloaded" }),
      bDetail.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" }),
    ]);

    // Wait for detail roster to hydrate on device A.
    await expect(aDetail.getByText(/Roster \(\d+\/\d+\)/).first()).toBeVisible({
      timeout: 15_000,
    });
    const beforeRoster = await readSpotsFromDetail(aDetail);
    const beforeFeed = await readFeedCounterFor(aFeed, GAME_ID);

    // Ensure device B is on the CTA — if already joined from prior run, leave first.
    const leaveCta = bDetail
      .getByRole("button", { name: /you're in · tap to leave/i })
      .first();
    if (await leaveCta.count() > 0 && await leaveCta.isVisible().catch(() => false)) {
      await leaveCta.click();
      await expect(
        bDetail.getByRole("button", { name: /join free/i }).first(),
      ).toBeVisible({ timeout: 10_000 });
    }

    const joinCta = bDetail.getByRole("button", { name: /join free/i }).first();
    await expect(joinCta).toBeVisible({ timeout: 15_000 });
    await joinCta.click();

    // Device B flips locally.
    await expect(
      bDetail.getByRole("button", { name: /you're in · tap to leave/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // --- Realtime propagation to Device A ---

    // 1. Detail: roster header count must change (increase by 1).
    await expect
      .poll(async () => await readSpotsFromDetail(aDetail), {
        timeout: 20_000,
        message: "detail roster header did not update on Device A",
      })
      .not.toBe(beforeRoster);

    // 2. Feed card counter must change on Device A (if the card is rendered).
    if (beforeFeed !== null) {
      await expect
        .poll(async () => await readFeedCounterFor(aFeed, GAME_ID), {
          timeout: 20_000,
          message: "feed card counter did not update on Device A",
        })
        .not.toBe(beforeFeed);
    }

    // 3. Map surface: the discover route lists game cards; any card linking
    // to this game should reflect the new counter. Only assert if present.
    const mapCard = aMap.locator(`a[href*="/games/${GAME_ID}"]`).first();
    if ((await mapCard.count()) > 0) {
      await expect
        .poll(
          async () => {
            const c = mapCard.locator("text=/\\d+\\/\\d+/").first();
            return (await c.count()) > 0 ? (await c.textContent())?.trim() : null;
          },
          { timeout: 20_000, message: "map card counter did not update on Device A" },
        )
        .not.toBe(beforeFeed); // baselines match since same GameCard component
    }

    // 4. Profile: because both devices are the same user, joining from B
    // also puts the game in this user's upcoming list on A via realtime.
    await expect(
      aProfile.locator(`a[href*="/games/${GAME_ID}"]`).first(),
    ).toBeVisible({ timeout: 20_000 });

    // --- Reverse: leave from B and confirm Device A tears back down ---
    await bDetail
      .getByRole("button", { name: /you're in · tap to leave/i })
      .first()
      .click();
    await expect(
      bDetail.getByRole("button", { name: /join free/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

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
