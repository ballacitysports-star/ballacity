import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { account } from "./helpers/fixture-auth";
import { restoreSession } from "./helpers/signed-in";
import { stubRiskAcknowledged } from "./helpers/risk-ack";

/**
 * E2E against the real database rules (docs/paid-path-gates.md section 6 (c), owner instruction 2026-11-21): the payment
 * terms a new player may read BEFORE approval or payment, and no handles for a caller the claim rules refuse. Nothing
 * on the payment path is mocked, except the one test that makes the terms read fail.
 *
 * game_payment_settings is hidden by RLS from a viewer who is not yet the payee, an approved requester, a payer or a
 * participant. get_game_payment_terms (20261128120000) tells such a viewer the entry fee, the deadline, the accepted
 * payment apps by name and whether the host approves first; never a handle and never the host's own text. The fixture
 * host creates four real games for the run (each with its own id, so the fixture player is a fresh viewer of each).
 * The game price (30) is not the entry fee (12): the entry fee is what PayPal charges, so it is what the player is told.
 *   - open: paid, no approval. The pay page shows $12.00 and "Pay by", the Venmo handle (the host's methods RPC, as
 *     before), never the host's instructions text; the game page's "Before you join" says $12 and that the host takes
 *     Venmo.
 *   - approval: paid, host approves first. The pay page shows "Waiting on host approval" with the accepted app and that
 *     the details come after approval; no handle, no free text, and the page never asks for the host's methods.
 *   - full: paid, open, one place, taken by the host. The page blocks the viewer; the terms function and the methods
 *     function both tell the player nothing (payment_claim_block would refuse their claim).
 *   - none: free settings row. The terms function tells nothing.
 * Everything is deleted afterwards. Only "Before you join" is answered (as acknowledged): it is not what this spec is
 * about, and recording it would write a row per game.
 *
 * Writes real rows, so it runs only against the local stack (e2e/local-stack), never a hosted project. Written for the
 * serial E2E phase; not run by the session that wrote it.
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

const GAME_PRICE = 30;
const ENTRY_FEE = 12;
const suffix = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const VENMO_HANDLE = `e2e-terms-${suffix}`;
const VENMO_LABEL = `LabelTerms${suffix}`;
const FREE_TEXT = `FreeTextTerms${suffix}`;
const GAMES = {
  open: `host-${suffix}-open`,
  approval: `host-${suffix}-appr`,
  full: `host-${suffix}-full`,
  none: `host-${suffix}-none`,
};

let host: SupabaseClient;
let player: SupabaseClient;
let hostId = "";
let methodId = "";

function gameRow(id: string, maxPlayers: number) {
  return {
    id,
    host_id: hostId,
    sport: "Soccer",
    title: `Terms ${id.slice(-4)}`,
    date: new Date(Date.now() + 48 * 3600_000).toISOString(),
    duration: "90 min",
    location: "Pier 40 Turf",
    neighborhood: "West Side",
    max_players: maxPlayers,
    joined: 0,
    skill: "All Levels",
    price: GAME_PRICE,
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

  const method = must(
    await host
      .from("host_payment_methods")
      .insert({
        host_id: hostId,
        payment_type: "venmo",
        label: VENMO_LABEL,
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
        gameRow(GAMES.full, 1),
        { ...gameRow(GAMES.none, 10), price: 0 },
      ]),
    "insert games",
  );
  const deadline = new Date(Date.now() + 36 * 3600_000).toISOString();
  must(
    await host.from("game_payment_settings").insert(
      [GAMES.open, GAMES.approval, GAMES.full].map((game_id) => ({
        game_id,
        host_id: hostId,
        entry_fee: ENTRY_FEE,
        accepted_method_ids: [methodId],
        payment_deadline: deadline,
        payment_instructions: FREE_TEXT,
        requires_approval: game_id === GAMES.approval,
      })),
    ),
    "insert settings",
  );
  must(
    await host
      .from("game_payment_settings")
      .insert({ game_id: GAMES.none, host_id: hostId, entry_fee: 0, requires_approval: false }),
    "insert free settings",
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

/** The bodies of every answer of the terms RPC the page receives, as text. */
function watchTermsAnswers(page: Page): Promise<string>[] {
  const answers: Promise<string>[] = [];
  page.on("response", (r) => {
    if (r.url().includes("/rest/v1/rpc/get_game_payment_terms")) answers.push(r.text());
  });
  return answers;
}

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

test("a fresh player on a paid open game is told the entry fee and the deadline, never the host's text", async ({
  page,
}) => {
  const answers = watchTermsAnswers(page);
  const settingsBody = await openPay(page, GAMES.open);
  expect(settingsBody, "the settings row stays hidden from a fresh viewer").toEqual([]);

  // The entry fee PayPal charges (12), not the game's price (30).
  await expect(page.getByText(`$${ENTRY_FEE}.00`).first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(`$${GAME_PRICE}.00`)).toHaveCount(0);
  await expect(page.getByText(/pay by /i).first()).toBeVisible();
  // The handle comes the way it did (the methods RPC for a viewer cleared to pay), the host's free text does not.
  await expect(page.getByText(VENMO_HANDLE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(FREE_TEXT)).toHaveCount(0);

  const bodies = await Promise.all(answers);
  expect(bodies.length, "the page asked for the terms").toBeGreaterThan(0);
  for (const body of bodies) {
    expect(body).toContain('"entry_fee"');
    expect(body).not.toContain(VENMO_HANDLE);
    expect(body).not.toContain(VENMO_LABEL);
    expect(body).not.toContain(FREE_TEXT);
  }
});

test("on a paid approval game the player is told the fee, the app and that details come after approval, not the handle", async ({
  page,
}) => {
  const methodsCalls = watchMethodsRpc(page);
  const answers = watchTermsAnswers(page);
  const settingsBody = await openPay(page, GAMES.approval);
  expect(settingsBody).toEqual([]);

  const gate = page.getByTestId("approval-required-gate");
  await expect(gate).toBeVisible({ timeout: 20_000 });
  const terms = page.getByTestId("pay-terms-before-approval");
  await expect(terms).toBeVisible();
  await expect(terms).toContainText("This host accepts Venmo.");
  await expect(terms).toContainText(/payment details appear once the host approves you/i);
  await expect(page.getByText(`$${ENTRY_FEE}.00`).first()).toBeVisible();
  await expect(page.getByText(/pay by /i).first()).toBeVisible();
  await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
  await expect(page.getByText(FREE_TEXT)).toHaveCount(0);
  expect(methodsCalls, "no methods RPC before the host approves").toEqual([]);
  for (const body of await Promise.all(answers)) {
    expect(body).not.toContain(VENMO_HANDLE);
    expect(body).not.toContain(FREE_TEXT);
  }
});

test("the game page's 'Before you join' tells the entry fee and the accepted app before any request", async ({
  page,
}) => {
  await stubRiskAcknowledged(page);
  await restoreSession(page);
  await page.goto(`/games/${GAMES.approval}`, { waitUntil: "domcontentloaded" });
  const policy = page.getByRole("region", { name: "Game policies" });
  await expect(policy).toBeVisible({ timeout: 20_000 });
  await expect(policy).toContainText(`$${ENTRY_FEE} per player`);
  await expect(policy).toContainText("The host accepts Venmo.");
  await expect(policy).not.toContainText(VENMO_HANDLE);
  await expect(policy).not.toContainText(FREE_TEXT);
  await expect(page.getByTestId("payment-terms-methods")).toContainText("Venmo");
});

test("a full game tells the player nothing: no terms and no handles from the API, and the page blocks them", async ({
  page,
}) => {
  // Directly, as the player: both functions answer empty (payment_claim_block: GAME_FULL).
  const terms = must(await player.rpc("get_game_payment_terms", { _game_id: GAMES.full }), "terms");
  expect(terms).toEqual([]);
  const handles = must(
    await player.rpc("get_game_host_payment_methods", { _host_id: hostId, _game_id: GAMES.full }),
    "methods",
  );
  expect(handles, "no handles for a viewer the claim rules refuse").toEqual([]);
  // A game with no fee tells nothing either.
  expect(
    must(await player.rpc("get_game_payment_terms", { _game_id: GAMES.none }), "free terms"),
  ).toEqual([]);

  await openPay(page, GAMES.full);
  const card = page.getByTestId("pay-entry-blocked");
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card).toHaveAttribute("data-block", "full");
  await expect(page.getByText(VENMO_HANDLE)).toHaveCount(0);
  await expect(page.getByText(/pay by /i)).toHaveCount(0);
  await expect(page.getByText(/this host accepts/i)).toHaveCount(0);
});

test("when the terms cannot be read the page shows what it showed before: the price, no deadline, no error text", async ({
  page,
}) => {
  await page.route("**/rest/v1/rpc/get_game_payment_terms*", (route) =>
    route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({
        code: "PGRST202",
        message:
          "Could not find the function public.get_game_payment_terms(_game_id) in the schema cache",
      }),
    }),
  );
  await openPay(page, GAMES.approval);
  const gate = page.getByTestId("approval-required-gate");
  await expect(gate).toBeVisible({ timeout: 20_000 });
  // What it showed before this change: the game's price, nothing about a deadline or the app, and no Retry or error.
  await expect(page.getByText(`$${GAME_PRICE}.00`).first()).toBeVisible();
  await expect(page.getByText(/pay by /i)).toHaveCount(0);
  await expect(page.getByTestId("pay-terms-before-approval")).toHaveCount(0);
  await expect(page.getByText(/PGRST202|schema cache|could not find the function/i)).toHaveCount(0);
  await expect(page.getByText(/couldn't reach the payment service/i)).toHaveCount(0);
});
