import { test, expect, type BrowserContext } from "@playwright/test";
import {
  HAS_DB,
  NO_RESIDUE,
  STALE_AFTER_MS,
  cleanUpSpecGames,
  must,
  openAs,
  residueFor,
  signInFixture,
  specGameRow,
  type FixtureUser,
} from "./helpers/fixture-session";

/**
 * WP 5.5 + WP 5.4, against the real database: a player accepts a host's invitation to a FREE game
 * from My availability (GameInvitationsSection) and is on the roster at once, without ever opening
 * the game page, with the default reminders saved.
 *
 *   - The fixture host creates a free, no-approval game two days out (so no reminder is due during
 *     the run) and invites the fixture player through game_invite_player. The database lets a host
 *     invite only a player with an open availability post (or a regular), so the player posts one
 *     first, through PostgREST as themselves.
 *   - The player opens /availability and taps Accept. The toast is exactly "You're in." (the paid
 *     or guardian variant, "You're in. Open the game to finish joining.", shares the prefix).
 *   - The roster row is the accept's own (game_respond_invite, 20261127120000): the player's page
 *     never leaves /availability and never writes game_participants itself.
 *   - A game_reminders row with the default offsets (1440, 120) exists for the game, read as the
 *     player (the host cannot read it).
 *   - The host opens the game and the roster lists the player.
 *
 * Hygiene: the post, the notifications and the game (which takes the roster row, request,
 * invitation and reminder with it) are deleted in afterAll, which runs when the test fails too.
 */

test.skip(!HAS_DB, "Requires SUPABASE_URL and the publishable key.");
test.describe.configure({ mode: "serial" });

const PREFIX = "e2e-p5-inv-";
const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const RUN = `${PREFIX}${suffix}`;
const GAME_ID = RUN;
const TITLE = `Invite accept ${suffix}`;
const POST_NOTE = `e2e invite-accept-roster ${suffix}`;

let host: FixtureUser;
let player: FixtureUser;
const contexts: BrowserContext[] = [];

test.beforeAll(async () => {
  host = await signInFixture("host");
  player = await signInFixture("player");
  const stale = await cleanUpSpecGames(host, [player], PREFIX, { staleOnly: true });
  if (stale.length > 0) console.warn(`[${PREFIX}] stale cleanup: ${stale.join("; ")}`);
  // A post an earlier, killed run left behind (old enough not to be another run's).
  await player.db
    .from("player_availabilities")
    .delete()
    .eq("user_id", player.id)
    .like("note", "e2e invite-accept-roster %")
    .lt("created_at", new Date(Date.now() - STALE_AFTER_MS).toISOString());
});

test.afterAll(async () => {
  for (const c of contexts.splice(0)) await c.close().catch(() => undefined);
  if (!host || !player) return;
  const posts = () =>
    player.db
      .from("player_availabilities")
      .select("id")
      .eq("user_id", player.id)
      .eq("note", POST_NOTE);
  const postDelete = await player.db
    .from("player_availabilities")
    .delete()
    .eq("user_id", player.id)
    .eq("note", POST_NOTE);
  const problems = await cleanUpSpecGames(host, [player], RUN);
  if (postDelete.error) problems.push(`delete the post: ${postDelete.error.message}`);
  expect(
    await residueFor(host, player, RUN),
    "nothing of this spec's games may be left on the sandbox",
  ).toEqual(NO_RESIDUE);
  expect(must(await posts(), "re-read the post"), "the player's post must be gone").toEqual([]);
  expect(problems, "every cleanup step should go through").toEqual([]);
});

test("accepting a free game's invitation from My availability puts the player on the roster with reminders", async ({
  browser,
}) => {
  test.setTimeout(90_000);

  // --- Seed, as each account, through the database's own rules ---
  must(
    await player.db.from("player_availabilities").insert({
      user_id: player.id,
      sports: ["Basketball"],
      skill_level: "All Levels",
      skill_levels: {},
      looking_for: [],
      time_slots: [],
      recurring_days: [],
      timezone: "UTC",
      travel_radius_km: 25,
      note: POST_NOTE,
      status: "open",
    }),
    "post availability",
  );
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
      requires_approval: false,
    }),
    "insert free settings",
  );
  const inviteId = must(
    await host.db.rpc("game_invite_player", {
      _game: GAME_ID,
      _invitee: player.id,
      _availability: null,
      _message: null,
    }),
    "invite the player",
  ) as string;
  expect(inviteId).toBeTruthy();

  // --- The player accepts from My availability ---
  const p = await openAs(browser, player);
  contexts.push(p.context);
  const rosterWrites: string[] = [];
  p.page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/rest/v1/game_participants")) {
      rosterWrites.push(`${r.method()} ${r.url()}`);
    }
  });
  await p.page.goto("/availability", { waitUntil: "domcontentloaded" });
  const card = p.page.getByTestId("game-invitation").filter({ hasText: TITLE });
  await expect(card).toBeVisible({ timeout: 30_000 });
  const respond = p.page.waitForResponse(
    (r) => r.url().includes("/rest/v1/rpc/game_respond_invite") && r.request().method() === "POST",
  );
  await card.getByRole("button", { name: /^accept$/i }).click();
  const answer = (await (await respond).json()) as { status?: string; on_roster?: boolean };
  expect(answer, "game_respond_invite's answer").toMatchObject({
    status: "accepted",
    on_roster: true,
  });
  await expect(p.page.getByText("You're in.", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(card.getByRole("link", { name: /open the game/i })).toBeVisible({ timeout: 10_000 });

  // --- The database: on the roster, reminders saved ---
  await expect
    .poll(
      async () => {
        const { data } = await host.db
          .from("game_participants")
          .select("user_id")
          .eq("game_id", GAME_ID);
        return ((data ?? []) as { user_id: string }[]).map((r) => r.user_id);
      },
      { timeout: 10_000, message: "the accept should put the player on the roster" },
    )
    .toEqual([player.id]);
  await expect
    .poll(
      async () => {
        const { data } = await player.db
          .from("game_reminders")
          .select("offsets")
          .eq("game_id", GAME_ID)
          .eq("user_id", player.id);
        return ((data ?? []) as { offsets: number[] }[]).map((r) => r.offsets);
      },
      { timeout: 10_000, message: "the accept should save the default reminders (WP 5.4)" },
    )
    .toEqual([[1440, 120]]);

  // The roster row is the accept's own: the player never left My availability and never wrote it.
  expect(new URL(p.page.url()).pathname).toBe("/availability");
  expect(rosterWrites, "the player's page must not write the roster itself").toEqual([]);

  // --- The host's game page lists the player ---
  const h = await openAs(browser, host);
  contexts.push(h.context);
  await h.page.goto(`/games/${GAME_ID}`, { waitUntil: "domcontentloaded" });
  const rosterHeading = h.page.getByRole("heading", { name: /^Roster · 1 \/ 10$/ });
  await expect(rosterHeading).toBeVisible({ timeout: 30_000 });
  await expect(
    rosterHeading.locator("xpath=..").locator(`a[href="/players/${player.id}"]`),
    "the host's roster should list the player",
  ).toBeVisible({ timeout: 10_000 });
});
