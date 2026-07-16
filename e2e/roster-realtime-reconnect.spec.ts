import { test, expect, type BrowserContext, type Page } from "@playwright/test";

/**
 * E2E: roster + participant count stay in sync across two clients through
 * INSERT, DELETE, and reconnect scenarios.
 *
 * Reconnect coverage is what makes this spec distinct from the existing
 * `join-cross-device-roster` spec: we drop Device A's network while Device B
 * mutates the roster, then bring A back online and assert it resyncs via the
 * `SUBSCRIBED`-triggered reload wired into `useLiveParticipants` and
 * `useLiveParticipantCount`. Without the reload-on-resubscribe fix, A would
 * silently drift and keep the pre-outage count forever.
 *
 * Two independent BrowserContexts model two devices with independent
 * websockets. Auto-skips without a restored Supabase session. Both devices
 * sign in as the same fixture user; realtime still exercises the fanout
 * across sockets, and the count/roster hooks don't special-case the viewer.
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
  // Start un-joined so join → leave transitions are meaningful.
  await page.evaluate(() =>
    window.localStorage.removeItem("openrun.joinedGameIds.v1"),
  );
}

/** "Roster (X/Y)" header text on the game detail page. */
async function readRosterHeader(page: Page): Promise<string | null> {
  const header = page.getByText(/Roster \(\d+\/\d+\)/).first();
  if ((await header.count()) === 0) return null;
  return (await header.textContent())?.trim() ?? null;
}

/** Parse the "X" out of "Roster (X/Y)". */
function joinedFromHeader(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/Roster \((\d+)\/\d+\)/);
  return m ? Number(m[1]) : null;
}

async function ensureLeft(bDetail: Page) {
  const leaveCta = bDetail
    .getByRole("button", { name: /you're in · tap to leave/i })
    .first();
  if ((await leaveCta.count()) > 0 && (await leaveCta.isVisible().catch(() => false))) {
    await leaveCta.click();
    // Leave shows a "Leave this game?" confirmation dialog with a Leave button.
    const confirmLeave = bDetail.getByRole("button", { name: /^leave( game)?$/i }).first();
    if (await confirmLeave.isVisible().catch(() => false)) {
      await confirmLeave.click();
    }
    await expect(
      bDetail.getByRole("button", { name: /join free/i }).first(),
    ).toBeVisible({ timeout: 10_000 });
  }
}

async function performJoin(page: Page) {
  const joinCta = page.getByRole("button", { name: /join free/i }).first();
  await expect(joinCta).toBeVisible({ timeout: 15_000 });
  await joinCta.click();
  // Confirmation dialog: "Join this game?" → "Join game"
  const confirm = page.getByRole("button", { name: /^join game$/i }).first();
  await expect(confirm).toBeVisible({ timeout: 5_000 });
  await confirm.click();
  await expect(
    page.getByRole("button", { name: /you're in · tap to leave/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
}

async function performLeave(page: Page) {
  await page
    .getByRole("button", { name: /you're in · tap to leave/i })
    .first()
    .click();
  const confirmLeave = page.getByRole("button", { name: /^leave( game)?$/i }).first();
  if (await confirmLeave.isVisible().catch(() => false)) {
    await confirmLeave.click();
  }
  await expect(
    page.getByRole("button", { name: /join free/i }).first(),
  ).toBeVisible({ timeout: 10_000 });
}


test("roster stays consistent across INSERT, DELETE, and reconnect", async ({ browser }) => {
  // --- Device A: passive observer ---
  const deviceA = await browser.newContext();
  const bootA = await deviceA.newPage();
  await restoreSession(deviceA, bootA);
  await bootA.close();
  const aDetail = await deviceA.newPage();

  // --- Device B: actor ---
  const deviceB = await browser.newContext();
  const bootB = await deviceB.newPage();
  await restoreSession(deviceB, bootB);
  await bootB.close();
  const bDetail = await deviceB.newPage();

  try {
    await Promise.all([
      aDetail.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" }),
      bDetail.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" }),
    ]);

    // Wait for A's roster to hydrate.
    await expect(aDetail.getByText(/Roster \(\d+\/\d+\)/).first()).toBeVisible({
      timeout: 15_000,
    });
    const baselineHeader = await readRosterHeader(aDetail);
    const baseline = joinedFromHeader(baselineHeader);
    expect(baseline).not.toBeNull();

    // Make sure B starts un-joined.
    await ensureLeft(bDetail);

    // ============ Step 1: INSERT propagates A ←— B ============
    await performJoin(bDetail);

    await expect
      .poll(async () => joinedFromHeader(await readRosterHeader(aDetail)), {
        timeout: 20_000,
        message: "INSERT: roster count on Device A did not increase after Device B joined",
      })
      .toBe((baseline ?? 0) + 1);

    // ============ Step 2: DELETE propagates A ←— B (both online) ============
    await performLeave(bDetail);


    await expect
      .poll(async () => joinedFromHeader(await readRosterHeader(aDetail)), {
        timeout: 20_000,
        message: "DELETE: roster count on Device A did not decrease after Device B left",
      })
      .toBe(baseline!);

    // ============ Step 3: reconnect resync (A offline during a change) ============
    // Take Device A offline → its Realtime websocket drops. Any events fired
    // while offline are unreachable. When A comes back online, the channel
    // reconnects and our SUBSCRIBED-callback triggers a full snapshot
    // reload, so the roster must reflect the change that happened during
    // the outage.
    await deviceA.setOffline(true);

    // Verify A truly lost its websocket by making B change state; A must NOT
    // see the update while offline.
    const afterOfflineJoin = bDetail.getByRole("button", { name: /join free/i }).first();
    await afterOfflineJoin.click();
    await expect(
      bDetail.getByRole("button", { name: /you're in · tap to leave/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    // Give the realtime event time to arrive (or not) on A.
    await aDetail.waitForTimeout(2_500);
    expect(
      joinedFromHeader(await readRosterHeader(aDetail)),
      "Device A should still show baseline while offline",
    ).toBe(baseline!);

    // Bring A back online → channel reconnects → SUBSCRIBED reload runs.
    await deviceA.setOffline(false);

    await expect
      .poll(async () => joinedFromHeader(await readRosterHeader(aDetail)), {
        timeout: 25_000,
        message:
          "RECONNECT: Device A did not resync roster after coming back online " +
          "(SUBSCRIBED-triggered reload missing?)",
      })
      .toBe((baseline ?? 0) + 1);

    // Cleanup: leave from B while both online, and confirm A tracks it too.
    await bDetail
      .getByRole("button", { name: /you're in · tap to leave/i })
      .first()
      .click();
    await expect
      .poll(async () => joinedFromHeader(await readRosterHeader(aDetail)), {
        timeout: 20_000,
      })
      .toBe(baseline!);
  } finally {
    await deviceA.close();
    await deviceB.close();
  }
});
