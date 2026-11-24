/**
 * Two fixture accounts at once, against the real database, for the specs that seed their own game
 * (invite-accept-roster, host-removal-stays-removed, attendance-prompt-link).
 *
 * Each account is signed in once per spec file with supabase-js in the test process (the way
 * pay-terms-before-approval does). That client seeds rows as the account, through PostgREST and
 * the database's own rules, and reads the database's answer the spec waits on. The same session is
 * put into a browser context, so the page acts as that account; `/auth/v1/user` and the root
 * gate's three server functions (age, onboarding, child status) are answered from it as for an
 * adult member (helpers/signed-in.ts), since they are not what these specs test and a dev server
 * that cannot reach the backend from its own process would otherwise fail them.
 *
 * Sandbox hygiene: a spec that uses these creates its own game with an `e2e-p5-` id and deletes it
 * in afterAll as the host. The delete cascades to the roster, requests, invitations, reminders and
 * payment settings, and since the host deletes, no player-side trigger (late cancellation) fires.
 * `cleanUpSpecGames` also removes the rows the cascade does not reach (notifications that link to
 * the game) and any game an earlier run of the same spec left behind. Never call `signOut()` on
 * these clients: its default scope is global and would end the session other specs share.
 */
import type { Browser, BrowserContext, Page } from "@playwright/test";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import type { TestAccountKey } from "../../src/lib/test-fixtures";
import { account } from "./fixture-auth";
import { answerSessionChecksFor } from "./signed-in";

export const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
export const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
export const HAS_DB = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

export type FixtureUser = {
  key: TestAccountKey;
  id: string;
  db: SupabaseClient;
  session: Session;
};

/** Sign one fixture account in, in the test process. */
export async function signInFixture(key: TestAccountKey): Promise<FixtureUser> {
  const db = createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const a = account(key);
  const { data, error } = await db.auth.signInWithPassword({
    email: a.email,
    password: a.password,
  });
  if (error || !data.session || !data.user) {
    throw new Error(`${a.email} sign-in: ${error?.message ?? "no session"}`);
  }
  return { key, id: data.user.id, db, session: data.session };
}

/** Where supabase-js keeps the session in the browser: `sb-<first label of the API host>-auth-token`. */
function storageKey(): string {
  return `sb-${new URL(SUPABASE_URL!).hostname.split(".")[0]}-auth-token`;
}

/** A new browser context signed in as `user`; the page has loaded the app once and holds the session. */
export async function openAs(
  browser: Browser,
  user: FixtureUser,
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await answerSessionChecksFor(page, user.session.user);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await page.evaluate(
    ([k, v]) => window.localStorage.setItem(k!, v!),
    [storageKey(), JSON.stringify(user.session)],
  );
  return { context, page };
}

/** Throw with the database's message when a seeding call fails. */
export function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

/** A hosted_games row the fixture host may insert: free, public, ten places. */
export function specGameRow(id: string, hostId: string, date: Date, title: string) {
  return {
    id,
    host_id: hostId,
    sport: "Basketball",
    title,
    date: date.toISOString(),
    duration: "120 min",
    location: "E2E Court",
    neighborhood: "Testville",
    max_players: 10,
    joined: 0,
    skill: "All Levels",
    price: 0,
    indoor: false,
    is_private: false,
    // No signup cutoff, so a player can still join a game that has started (attendance-prompt-link).
    signup_cutoff_min: 0,
    host_snapshot: { name: "E2E Host", username: "@e2ehost", avatar: "EH", rating: 5 },
  };
}

/** A game an earlier run left behind is at least this old; a run in progress elsewhere is younger. */
export const STALE_AFTER_MS = 30 * 60_000;

/**
 * Remove the games whose id starts with `idPrefix` that the host owns, and the notifications of
 * either account that link to one. Notifications go first: they hold no reference to the game,
 * so the cascade leaves them.
 *
 * After a spec, `idPrefix` is that run's own (prefix plus its random suffix). Before a spec, it is
 * the spec's prefix with `staleOnly`, which removes only games created more than STALE_AFTER_MS
 * ago: what a killed run left, never the games of a run still going on another machine.
 *
 * Every step runs even when an earlier one fails, and the game delete is tried twice; a delete
 * that the database narrows to fewer rows than asked counts as a failure, since PostgREST reports
 * no error for it. Returns what still failed (empty when all went through); `residueFor` then
 * re-reads what is left, which is the check a spec asserts.
 */
export async function cleanUpSpecGames(
  host: FixtureUser,
  others: FixtureUser[],
  idPrefix: string,
  { staleOnly = false }: { staleOnly?: boolean } = {},
): Promise<string[]> {
  const problems: string[] = [];
  let query = host.db
    .from("hosted_games")
    .select("id")
    .eq("host_id", host.id)
    .like("id", `${idPrefix}%`);
  if (staleOnly)
    query = query.lt("created_at", new Date(Date.now() - STALE_AFTER_MS).toISOString());
  const { data: games, error: readErr } = await query;
  if (readErr) problems.push(`read ${idPrefix}* games: ${readErr.message}`);
  const ids = ((games ?? []) as { id: string }[]).map((g) => g.id);
  // A run that failed before its game was written still cleans up the notifications it may have caused.
  const links = staleOnly ? ids : [...new Set([idPrefix, ...ids])];
  for (const u of [host, ...others]) {
    for (const id of links) {
      const { error } = await u.db
        .from("notifications")
        .delete()
        .eq("user_id", u.id)
        .like("link", `%/games/${id}%`);
      if (error) problems.push(`${u.key}'s notifications for ${id}: ${error.message}`);
    }
  }
  let left = ids;
  for (let attempt = 0; attempt < 2 && left.length > 0; attempt += 1) {
    const { data: gone, error } = await host.db
      .from("hosted_games")
      .delete()
      .in("id", left)
      .select("id");
    const goneIds = new Set(((gone ?? []) as { id: string }[]).map((g) => g.id));
    left = left.filter((id) => !goneIds.has(id));
    if (left.length > 0 && attempt === 1) {
      problems.push(`delete games ${left.join(", ")}: ${error?.message ?? "no row deleted"}`);
    }
  }
  return problems;
}

/**
 * What is left of games whose id starts with `idPrefix`, read back as each account: the host's
 * games and notifications that link to them, and the player's notifications, roster rows,
 * requests, invitations and reminders in them. Empty arrays everywhere once a spec has cleaned up.
 */
export async function residueFor(host: FixtureUser, player: FixtureUser, idPrefix: string) {
  const read = async (
    q: PromiseLike<{ data: unknown; error: { message: string } | null }>,
    what: string,
  ) => {
    const { data, error } = await q;
    if (error) throw new Error(`${what}: ${error.message}`);
    return (data ?? []) as unknown[];
  };
  const own = (table: string, col: string) =>
    read(
      player.db.from(table).select("game_id").eq(col, player.id).like("game_id", `${idPrefix}%`),
      table,
    );
  const notes = (u: FixtureUser) =>
    read(
      u.db
        .from("notifications")
        .select("link")
        .eq("user_id", u.id)
        .like("link", `%/games/${idPrefix}%`),
      `${u.key}'s notifications`,
    );
  return {
    games: await read(
      host.db.from("hosted_games").select("id").eq("host_id", host.id).like("id", `${idPrefix}%`),
      "hosted_games",
    ),
    hostNotifications: await notes(host),
    playerNotifications: await notes(player),
    roster: await own("game_participants", "user_id"),
    requests: await own("join_requests", "player_id"),
    invites: await own("game_invites", "invitee_id"),
    reminders: await own("game_reminders", "user_id"),
  };
}

/** What `residueFor` reads once a spec has cleaned up. */
export const NO_RESIDUE = {
  games: [],
  hostNotifications: [],
  playerNotifications: [],
  roster: [],
  requests: [],
  invites: [],
  reminders: [],
};
