import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { account } from "./helpers/fixture-auth";
import { restoreSession } from "./helpers/signed-in";
import { stubRiskAcknowledged } from "./helpers/risk-ack";

/**
 * E2E against the real database rules (docs/paid-path-gates.md section 6 (c) and the full-game block, owner decision
 * 2026-11-20): nothing on the payment path is mocked.
 *
 * The host's settings row (game_payment_settings) is readable only by the payee, an approved requester, a payer or a
 * participant (private_sec.can_read_game_payment_settings). A fresh signed-in player on a paid OPEN game read it as
 * absent and got "Host hasn't set up payment yet", although get_game_host_payment_methods returns the handles to them
 * and the database accepts their claim. The pay page now asks the public join policy (get_game_join_policy) and the
 * methods RPC for that viewer, with the settings row still hidden from them (checked below, as the browser reads it).
 *
 * The fixture host creates four real games for the run (each with its own id, so the fixture player is a fresh viewer
 * of each: no request, no payment, no place):
 *   - open: paid, requires_approval false. The player sees the host's Venmo handle.
 *   - approval: paid, requires_approval true. The player gets "Waiting on host approval", no handle, and the page
 *     does not even ask for the host's methods (payMethodsHeldForApproval).
 *   - approvalLater: as approval, with a pending request from the player that the host approves while the page is
 *     open: the page then reads the settings row (now the player's to read) and the methods, and shows the handle.
 *   - full: paid, open, one place, taken by the host. The player gets the full-roster block card, no handle
 *     (payment_claim_block would refuse their claim with GAME_FULL). Also with the store's list of games failing:
 *     the count then comes from the page's by-id read of the game.
 * Everything is deleted afterwards. Only "Before you join" is answered (as acknowledged): it is not what this spec is
 * about, and recording it would write a row per game.
 *
 * Writes real rows, so it runs only against the local stack (e2e/local-stack), never a hosted project.
 */

const SESSION_JSON = process.env.LOVABLE_BROWSER_SUPABASE_SESSION_JSON;
const STORAGE_KEY = process.env.LOVABLE_BROWSER_SUPABASE_STORAGE_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY ?? process.env.VITE_SUPABASE_PUBLISHABLE_KEY;

function isLocalStack(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const host = new URL(url).hostname;
    return host === "127.0.0.1" || host === "localhost";
  } catch {
    return false;
  }
}

test.skip(
  !SESSION_JSON || !STORAGE_KEY || !SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY,
  "Requires a signed-in fixture session and Supabase env vars.",
);
test.skip(
  !isLocalStack(SUPABASE_URL),
  "Creates real games, settings and payment methods: runs against the local stack only.",
);

const ENTRY_FEE = 12;
const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const VENMO_HANDLE = `e2e-fresh-${suffix}`;
const GAMES = {
  open: `host-${suffix}-open`,
  approval: `host-${suffix}-appr`,
  approvalLater: `host-${suffix}-aprl`,
  full: `host-${suffix}-full`,
};

let host: SupabaseClient;
let player: SupabaseClient;
let hostId = "";
let playerId = "";
let methodId = "";

function gameRow(id: string, maxPlayers: number) {
  return {
    id,
    host_id: hostId,
    sport: "Soccer",
    title: `Fresh viewer ${id.slice(-4)}`,
    date: new Date(Date.now() + 48 * 3600_000).toISOString(),
    duration: "90 min",
    location: "Pier 40 Turf",
    neighborhood: "West Side",
    max_players: maxPlayers,
    joined: 0,
    skill: "All Levels",
    price: ENTRY_FEE,
    indoor: false,
    is_private: false,
    host_snapshot: { name: "E2E Host", username: "@e2ehost", avatar: "EH", rating: 5 },
  };
}

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

test.beforeAll(async () => {
  host = createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const h = account("host");
  const signIn = await host.auth.signInWithPassword({ email: h.email, password: h.password });
  if (signIn.error || !signIn.data.user) throw new Error(`host sign-in: ${signIn.error?.message}`);
  hostId = signIn.data.user.id;
  player = createClient(SUPABASE_URL!, SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });
  const p = account("player");
  const playerIn = await player.auth.signInWithPassword({ email: p.email, password: p.password });
  if (playerIn.error || !playerIn.data.user) {
    throw new Error(`player sign-in: ${playerIn.error?.message}`);
  }
  playerId = playerIn.data.user.id;

  const method = must(
    await host
      .from("host_payment_methods")
      .insert({
        host_id: hostId,
        payment_type: "venmo",
        label: "Venmo",
        username: VENMO_HANDLE,
        is_enabled: true,
      })
      .select("id")
      .single(),
    "insert Venmo method",
  );
  methodId = method.id as string;

  must(
    await host
      .from("hosted_games")
      .insert([
        gameRow(GAMES.open, 10),
        gameRow(GAMES.approval, 10),
        gameRow(GAMES.approvalLater, 10),
        gameRow(GAMES.full, 1),
      ]),
    "insert games",
  );
  must(
    await host.from("game_payment_settings").insert(
      [GAMES.open, GAMES.approval, GAMES.approvalLater, GAMES.full].map((game_id) => ({
        game_id,
        host_id: hostId,
        entry_fee: ENTRY_FEE,
        accepted_method_ids: [methodId],
        requires_approval: game_id === GAMES.approval || game_id === GAMES.approvalLater,
      })),
    ),
    "insert settings",
  );
  // The one place of the full game, taken by the host (game_participants_sync_count makes hosted_games.joined 1).
  must(
    await host.from("game_participants").insert({ game_id: GAMES.full, user_id: hostId }),
    "fill the full game",
  );
});

test.afterAll(async () => {
  if (!host || !hostId) return;
  const ids = Object.values(GAMES);
  await host.from("join_requests").delete().in("game_id", ids);
  await host.from("game_participants").delete().in("game_id", ids);
  await host.from("game_payment_settings").delete().in("game_id", ids);
  await host.from("hosted_games").delete().in("id", ids);
  if (methodId) await host.from("host_payment_methods").delete().eq("id", methodId);
});

/** Every call the page makes to the host's methods RPC (get_game_host_payment_methods). */
function watchMethodsRpc(page: Page): string[] {
  const calls: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/rest/v1/rpc/get_game_host_payment_methods")) calls.push(r.url());
  });
  return calls;
}

/** Open /games/<id>/pay as the fixture player and return what the browser's settings read answered. */
async function openPay(page: Page, gameId: string): Promise<unknown> {
  await stubRiskAcknowledged(page);
  await restoreSession(page);
  const settingsRead = page.waitForResponse(
    (r) => r.url().includes("/rest/v1/game_payment_settings") && r.url().includes(gameId),
  );
  await page.goto(`/games/${gameId}/pay`, { waitUntil: "domcontentloaded" });
  const res = await settingsRead;
  expect(res.ok()).toBe(true);
  return res.json();
}

test("a fresh player on a paid open game sees the host's handle, with the settings row still hidden by RLS", async ({
  page,
}) => {
  const settingsBody = await openPay(page, GAMES.open);
  // Real RLS: the viewer is not the payee, approved, a payer or on the roster, so the row is not theirs to read.
  expect(settingsBody, "the settings row stays hidden from a fresh viewer").toEqual([]);

  // The host has one method, so the page opens its pay step straight away (the handle and the Venmo link).
  await expect(page.getByText(VENMO_HANDLE)).toBeVisible({ timeout: 20_000 });
  await expect(
    page.getByRole("button", { name: /open venmo in a new tab to pay the host/i }),
  ).toBeVisible();
  await expect(page.getByText(`Pay $${ENTRY_FEE} in Venmo`)).toBeVisible();
  await expect(page.getByText(/host hasn't set up payment yet/i)).toHaveCount(0);
  await expect(page.getByTestId("approval-required-gate")).toHaveCount(0);
  await expect(page.getByTestId("pay-entry-blocked")).toHaveCount(0);
});

test("a fresh player on a paid approval game still gets 'Waiting on host approval', not the handle", async ({
  page,
}) => {
  const methodsCalls = watchMethodsRpc(page);
  const settingsBody = await openPay(page, GAMES.approval);
  expect(settingsBody).toEqual([]);

  const gate = page.getByTestId("approval-required-gate");
  await expect(gate).toBeVisible({ timeout: 20_000 });
  await expect(gate).toContainText(/request a spot first/i);
  await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /venmo/i })).toHaveCount(0);
  await expect(page.getByText(/host hasn't set up payment yet/i)).toHaveCount(0);
  // The handles never reach this viewer's browser: the page does not ask for them until the host approves.
  expect(methodsCalls, "no methods RPC before the host approves").toEqual([]);
});

test("a pending player on a paid approval game gets the handle once the host approves, not before", async ({
  page,
}) => {
  const request = must(
    await player
      .from("join_requests")
      .insert({
        game_id: GAMES.approvalLater,
        host_id: hostId,
        player_id: playerId,
        idempotency_key: `join:${GAMES.approvalLater}`,
      })
      .select("id")
      .single(),
    "player's join request",
  );

  const methodsCalls = watchMethodsRpc(page);
  const settingsBody = await openPay(page, GAMES.approvalLater);
  expect(settingsBody, "a pending requester cannot read the settings row").toEqual([]);
  const gate = page.getByTestId("approval-required-gate");
  await expect(gate).toBeVisible({ timeout: 20_000 });
  await expect(gate).toContainText(/your request for a spot is pending/i);
  await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
  expect(methodsCalls, "no methods RPC while the request is pending").toEqual([]);

  // The host approves. The page hears it (realtime, or its 15 s poll), reads the settings row, now the approved
  // player's to read, and the methods.
  const settingsAfter = page.waitForResponse(
    async (r) =>
      r.url().includes("/rest/v1/game_payment_settings") &&
      r.url().includes(GAMES.approvalLater) &&
      r.ok() &&
      ((await r.json()) as unknown[]).length === 1,
    { timeout: 40_000 },
  );
  must(
    await host
      .from("join_requests")
      .update({ status: "approved", reviewed_at: new Date().toISOString() })
      .eq("id", request.id as string),
    "host approves",
  );
  // The approved player now reads the settings row (RLS: an approved requester).
  await settingsAfter;
  await expect(page.getByText(VENMO_HANDLE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByTestId("approval-required-gate")).toHaveCount(0);
  await expect(page.getByText(/host hasn't set up payment yet/i)).toHaveCount(0);
});

test("a fresh player on a full paid game gets the full-roster block, not the handle", async ({
  page,
}) => {
  const settingsBody = await openPay(page, GAMES.full);
  expect(settingsBody).toEqual([]);

  const card = page.getByTestId("pay-entry-blocked");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute("data-block", "full");
  await expect(card).toContainText(/you can't pay for this game/i);
  await expect(card).toContainText("The roster is full — no spots left.");
  await expect(card).toContainText(/don't send the host any money/i);
  await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /venmo/i })).toHaveCount(0);
  await expect(page.getByText(/just filled up/i)).toHaveCount(0);
});

test("the full-roster block rests on the page's by-id read of the game when the list of games fails to load", async ({
  page,
}) => {
  // Only the store's list of every game fails; the page's own read of this game by id goes through.
  let listRefused = 0;
  await page.route(
    (url) =>
      url.pathname.endsWith("/rest/v1/hosted_games") && url.search.includes("hidden_at=is.null"),
    async (route) => {
      listRefused += 1;
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    },
  );
  await openPay(page, GAMES.full);

  const card = page.getByTestId("pay-entry-blocked");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute("data-block", "full");
  await expect(page.getByTestId("pay-entry-check-failed")).toHaveCount(0);
  await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
  expect(listRefused, "the list of games was asked for, and refused").toBeGreaterThan(0);
});
