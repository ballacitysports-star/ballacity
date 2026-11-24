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
 * Host control, against the real database: a player the host removes from the roster stays
 * removed when they open the game page again.
 *
 * The game page's auto-join for an approved player (refreshStatus in
 * src/routes/games.$gameId.index.tsx) puts a player whose request is still 'approved' back on the
 * roster on their next visit. So a removal has to decline the request.
 *
 *   1. The fixture host creates a free game that needs approval. The player requests a place and
 *      the host approves it, both through PostgREST as themselves.
 *   2. The player opens the game page and the page's auto-join puts them on the roster (waited on
 *      in the database). This shows the auto-join works here, so step 4 can fail.
 *   3. The host opens the game page and taps Remove on the player's roster row (it asks with the
 *      browser's confirm). The database then has no roster row and the request is 'rejected'
 *      ("Removed by host").
 *   4. The player opens the game page again in a fresh browser (no locally remembered join, so
 *      nothing but the request decides). Once the page has read the request back as 'rejected',
 *      it has not written the roster and the database still has no row for the player.
 *
 * A player with an approved request is listed by RosterPlayerRow, whose Remove declines the request
 * and deletes the roster row through PostgREST; that path predates 20261129130000. The roster's
 * other Remove (the bin on a player with no approved request, which on a game that needs approval
 * cannot happen, so the second test uses an open game) calls host_remove_player, the function
 * 20261129130000 added: the second test checks that it answers and the row goes. On an open game
 * the join gate does not read requests, so a removed player can join again there (an open item in
 * docs/product/phase-5-validation-plan.md); that is not asserted. Each test records the removal
 * calls it saw as an annotation.
 *
 * Hygiene: the games (and with them the roster, the requests and any invitation) and the
 * notifications that link to them are deleted in afterAll, which runs when a test fails too.
 */

test.skip(!HAS_DB, "Requires SUPABASE_URL and the publishable key.");
test.describe.configure({ mode: "serial" });

const PREFIX = "e2e-p5-rm-";
const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const RUN = `${PREFIX}${suffix}`;
const GAME_ID = RUN;
const TITLE = `Removal ${suffix}`;
const OPEN_ID = `${RUN}-open`;
const OPEN_TITLE = `Removal open ${suffix}`;

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

async function playerRosterRows(): Promise<number> {
  const { data, error } = await host.db
    .from("game_participants")
    .select("id")
    .eq("game_id", GAME_ID)
    .eq("user_id", player.id);
  if (error) throw new Error(error.message);
  return (data ?? []).length;
}

async function playerRequest(): Promise<{ status: string; reviewer_notes: string | null } | null> {
  const { data, error } = await player.db
    .from("join_requests")
    .select("status, reviewer_notes")
    .eq("game_id", GAME_ID)
    .eq("player_id", player.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as { status: string; reviewer_notes: string | null } | null;
}

/** The player's game page, and every roster write it sends. */
async function openGameAsPlayer(browser: import("@playwright/test").Browser) {
  const { context, page } = await openAs(browser, player);
  contexts.push(context);
  const rosterWrites: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/rest/v1/game_participants")) {
      rosterWrites.push(`${r.method()} ${r.url()}`);
    }
  });
  return { context, page, rosterWrites };
}

/** The host page's removal writes, in order. */
function recordRemovalCalls(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/rest/v1/rpc/host_remove_player")) calls.push("rpc host_remove_player");
    else if (r.method() === "PATCH" && u.includes("/rest/v1/join_requests")) {
      calls.push("PATCH join_requests");
    } else if (r.method() === "DELETE" && u.includes("/rest/v1/game_participants")) {
      calls.push("DELETE game_participants");
    }
  });
  return calls;
}

/** Resolves once the page has read the viewer's own request for this game with `status`. */
function ownRequestRead(page: Page, status: string) {
  return page.waitForResponse(
    async (r) => {
      if (r.request().method() !== "GET") return false;
      const url = r.url();
      if (!url.includes("/rest/v1/join_requests") || !url.includes(GAME_ID)) return false;
      try {
        const body = (await r.json()) as unknown;
        const rows = Array.isArray(body) ? body : [body];
        return rows.some(
          (x) =>
            (x as { player_id?: string; status?: string })?.player_id === player.id &&
            (x as { status?: string }).status === status,
        );
      } catch {
        return false;
      }
    },
    { timeout: 30_000 },
  );
}

test("a player the host removed is not put back on the roster when they open the game again", async ({
  browser,
}) => {
  test.setTimeout(120_000);

  // --- 1. Seed: approval-gated free game, the player's request, the host's approval ---
  must(
    await host.db
      .from("hosted_games")
      .insert(specGameRow(GAME_ID, host.id, new Date(Date.now() + 48 * 3600_000), TITLE)),
    "insert game",
  );
  must(
    await host.db.from("game_payment_settings").insert({
      game_id: GAME_ID,
      host_id: host.id,
      entry_fee: 0,
      requires_approval: true,
    }),
    "insert approval settings",
  );
  const request = must(
    await player.db
      .from("join_requests")
      .insert({
        game_id: GAME_ID,
        host_id: host.id,
        player_id: player.id,
        message: null,
        idempotency_key: `join:${GAME_ID}`,
      })
      .select("id")
      .single(),
    "request a place",
  ) as { id: string };
  must(
    await host.db
      .from("join_requests")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", request.id)
      .select("id")
      .single(),
    "approve the request",
  );

  // --- 2. The player's game page joins them (the auto-join for an approved player) ---
  const first = await openGameAsPlayer(browser);
  await first.page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });
  await expect
    .poll(playerRosterRows, {
      timeout: 30_000,
      message: "the game page's auto-join should put the approved player on the roster",
    })
    .toBe(1);
  await first.context.close();

  // --- 3. The host removes the player from the roster ---
  const h = await openAs(browser, host);
  contexts.push(h.context);
  const removalCalls = recordRemovalCalls(h.page);
  h.page.on("dialog", (d) => void d.accept());
  await h.page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });
  const rosterHeading = h.page.getByRole("heading", { name: /^Roster · 1 \/ 10$/ });
  await expect(rosterHeading).toBeVisible({ timeout: 30_000 });
  const roster = rosterHeading.locator("xpath=..");
  await expect(roster.locator(`a[href="/players/${player.id}"]`)).toBeVisible({ timeout: 10_000 });
  await roster.getByRole("button", { name: /^remove$/i }).click();

  await expect
    .poll(playerRosterRows, { timeout: 15_000, message: "the removal should take the roster row" })
    .toBe(0);
  await expect
    .poll(playerRequest, { timeout: 15_000, message: "the removal should decline the request" })
    .toMatchObject({ status: "rejected", reviewer_notes: "Removed by host" });
  await expect(h.page.getByRole("heading", { name: /^Roster · 0 \/ 10$/ })).toBeVisible({
    timeout: 10_000,
  });
  // Which removal ran is reported, not asserted: the outcome above is the guarantee, whichever
  // path gives it (today RosterPlayerRow's PATCH + DELETE).
  test.info().annotations.push({ type: "removal path", description: removalCalls.join(", ") });

  // --- 4. The player opens the game again, in a fresh browser ---
  const again = await openGameAsPlayer(browser);
  const sawRejected = ownRequestRead(again.page, "rejected");
  await again.page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });
  await sawRejected;
  // The auto-join runs in the same pass as that read; give its write, if any, time to go out.
  await again.page.waitForTimeout(3_000);
  expect(again.rosterWrites, "the game page must not put a removed player back").toEqual([]);
  expect(await playerRosterRows(), "the player must still be off the roster").toBe(0);
  await expect(again.page.getByText(/you're in/i)).toHaveCount(0);
  expect(await playerRequest()).toMatchObject({ status: "rejected" });
});

test("the roster's other Remove takes the player off through host_remove_player", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  // An open free game the player joins directly: no request, so the roster lists them with the bin.
  must(
    await host.db
      .from("hosted_games")
      .insert(specGameRow(OPEN_ID, host.id, new Date(Date.now() + 48 * 3600_000), OPEN_TITLE)),
    "insert open game",
  );
  must(
    await host.db.from("game_payment_settings").insert({
      game_id: OPEN_ID,
      host_id: host.id,
      entry_fee: 0,
      requires_approval: false,
    }),
    "insert free settings",
  );
  must(
    await player.db.from("game_participants").insert({ game_id: OPEN_ID, user_id: player.id }),
    "the player joins",
  );

  const h = await openAs(browser, host);
  contexts.push(h.context);
  const removalCalls = recordRemovalCalls(h.page);
  await h.page.goto(`/games/${OPEN_ID}`, { waitUntil: "domcontentloaded" });
  const rosterHeading = h.page.getByRole("heading", { name: /^Roster · 1 \/ 10$/ });
  await expect(rosterHeading).toBeVisible({ timeout: 30_000 });
  await rosterHeading
    .locator("xpath=..")
    .getByRole("button", { name: /^remove .+ from roster$/i })
    .click();
  const dialog = h.page.getByRole("alertdialog", { name: /^remove .+ from this game\?$/i });
  await expect(dialog).toBeVisible({ timeout: 5_000 });
  const answered = h.page.waitForResponse(
    (r) => r.url().includes("/rest/v1/rpc/host_remove_player") && r.request().method() === "POST",
  );
  await dialog.getByRole("button", { name: /^remove player$/i }).click();
  const res = await answered;
  expect(res.status(), "host_remove_player should answer").toBe(200);
  expect(await res.json()).toMatchObject({ removed: true });

  await expect
    .poll(
      async () => {
        const { data } = await host.db
          .from("game_participants")
          .select("id")
          .eq("game_id", OPEN_ID)
          .eq("user_id", player.id);
        return (data ?? []).length;
      },
      { timeout: 15_000, message: "the removal should take the roster row" },
    )
    .toBe(0);
  await expect(h.page.getByRole("heading", { name: /^Roster · 0 \/ 10$/ })).toBeVisible({
    timeout: 10_000,
  });
  expect(removalCalls[0], "the bin's Remove calls host_remove_player").toBe(
    "rpc host_remove_player",
  );
  test.info().annotations.push({ type: "removal path", description: removalCalls.join(", ") });
});
