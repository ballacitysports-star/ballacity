import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import {
  HAS_DB,
  NO_RESIDUE,
  cleanUpSpecGames,
  must,
  openAs,
  residueFor,
  signInFixture,
  specGameRow,
  type FixtureUser,
} from "./helpers/fixture-session";

/**
 * WP 5.6, against the real database: the host's attendance prompt links to
 * `/games/<id>?tab=overview#attendance` (20261129110000), and that link opens the game page with
 * the Attendance block scrolled into view. The block appears only after the roster loads, when the
 * browser's own jump to the hash has passed, so HashScrollTarget scrolls it into view itself.
 *
 * Seeding a past game with a player on it: the database refuses a player joining a game that is
 * over by the clock (GAME_COMPLETED) and refuses the host writing anyone else's roster row (RLS).
 * So the fixture host creates a free game that started 30 minutes ago (no signup cutoff), the
 * fixture player joins it through PostgREST, and the host then moves its start 2.5 hours back, so
 * it ended 30 minutes ago. That stays inside the 2 hours after the end before the sweep would send
 * the real prompt, so no prompt notification is written for this game.
 *
 * The page is phone-sized, so the block starts below the fold: opened without the hash the page
 * stays at the top with the block out of view. The prompt's link is then opened cold, in a new
 * browser, as a notification tap does, and the page scrolls to the block. Nothing is marked. A run
 * with Element.scrollIntoView made a no-op fails at "the page should scroll", so this checks
 * HashScrollTarget's own scroll, not the browser's jump to the hash.
 *
 * Hygiene: the game (with the roster row) and the notifications that link to it are deleted in
 * afterAll as the host, which runs when the test fails too. The host deleting the roster row with
 * the game records no late cancellation against the player.
 */

test.skip(!HAS_DB, "Requires SUPABASE_URL and the publishable key.");
test.describe.configure({ mode: "serial" });
test.use({ viewport: { width: 390, height: 700 } });

const PREFIX = "e2e-p5-att-";
const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const RUN = `${PREFIX}${suffix}`;
const GAME_ID = RUN;
const TITLE = `Attendance ${suffix}`;

let host: FixtureUser;
let player: FixtureUser;
const contexts: BrowserContext[] = [];

test.beforeAll(async () => {
  host = await signInFixture("host");
  player = await signInFixture("player");
  const stale = await cleanUpSpecGames(host, [player], PREFIX, { staleOnly: true });
  if (stale.length > 0) console.warn(`[${PREFIX}] stale cleanup: ${stale.join("; ")}`);
});

test.afterAll(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  if (!host || !player) return;
  const problems = await cleanUpSpecGames(host, [player], RUN);
  expect(
    await residueFor(host, player, RUN),
    "nothing of this spec's games may be left on the sandbox",
  ).toEqual(NO_RESIDUE);
  expect(problems, "every cleanup step should go through").toEqual([]);
});

const attendance = (page: Page) => page.locator("#attendance");
const scrollY = (page: Page) => page.evaluate(() => window.scrollY);

test("the attendance prompt's link opens the game with the Attendance block in view", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  // --- Seed: a game that has ended, with the player on its roster ---
  must(
    await host.db
      .from("hosted_games")
      .insert(specGameRow(GAME_ID, host.id, new Date(Date.now() - 30 * 60_000), TITLE)),
    "insert game",
  );
  must(
    await host.db.from("game_payment_settings").insert({
      game_id: GAME_ID,
      host_id: host.id,
      entry_fee: 0,
      requires_approval: false,
    }),
    "insert free settings",
  );
  must(
    await player.db.from("game_participants").insert({ game_id: GAME_ID, user_id: player.id }),
    "the player joins while the game is on",
  );
  must(
    await host.db
      .from("hosted_games")
      .update({ date: new Date(Date.now() - 150 * 60_000).toISOString() })
      .eq("id", GAME_ID)
      .select("id")
      .single(),
    "move the game into the past",
  );

  const h = await openAs(browser, host);
  contexts.push(h.context);

  // --- Without the hash: the block is there, below the fold, and the page stays at the top ---
  await h.page.goto(`/games/${GAME_ID}?tab=overview`, { waitUntil: "domcontentloaded" });
  await expect(attendance(h.page)).toBeVisible({ timeout: 30_000 });
  await expect(attendance(h.page).getByText("Attendance", { exact: true })).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    attendance(h.page).getByRole("button", { name: /^mark .+ present$/i }),
    "the block lists the player",
  ).toHaveCount(1, { timeout: 10_000 });
  expect(await scrollY(h.page), "without the hash the page stays at the top").toBe(0);
  await expect(attendance(h.page)).not.toBeInViewport();

  // --- The prompt's link, opened cold in a new browser: the page scrolls the block into view ---
  // (A goto on the page above that adds only the hash would be a same-document jump to a block
  // that is already there, not the cold open a notification tap makes.)
  const cold = await openAs(browser, host);
  contexts.push(cold.context);
  await cold.page.goto(`/games/${GAME_ID}?tab=overview#attendance`, {
    waitUntil: "domcontentloaded",
  });
  await expect(attendance(cold.page)).toBeAttached({ timeout: 30_000 });
  await expect
    .poll(() => scrollY(cold.page), { timeout: 10_000, message: "the page should scroll" })
    .toBeGreaterThan(0);
  // Wholly on screen: scrolled to the block's top, or as far as the page goes when the block sits
  // near its end.
  await expect(attendance(cold.page)).toBeInViewport({ ratio: 1, timeout: 10_000 });
});
