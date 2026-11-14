/**
 * Shared setup for the mocked pay-screen specs (pay-*.spec.ts).
 *
 * Two things those specs used to get wrong, each of which failed them on every
 * run:
 *
 * 1. The game itself. They open /games/g2/pay and used to say "g2 is a paid
 *    sample game in src/lib/sample-data.ts". It no longer is: that file ships
 *    no games (`GAMES = []`), so the pay page looks g2 up in `hosted_games`.
 *    Specs that answered `hosted_games` with `[]` ("no hosted game overrides")
 *    therefore rendered "Game not found." and never reached the pay screen;
 *    the ones that left it unanswered depended on the row global-setup seeds
 *    being present and fast. `serveFixtureGame` answers the game's REST reads
 *    with a row the spec owns, hosted by the same mocked host as the spec's
 *    payment settings, so what the pay screen shows for the game does not
 *    depend on the g2 row where it runs.
 *
 *    That is all it isolates. Some reads still reach the real backend for "g2":
 *    the PayPal checkout config (a server function, which runs on the server
 *    where page.route cannot see it), the `get_game_refund_terms` RPC unless a
 *    spec answers it, and, in specs that do not block realtime, the live
 *    `hosted_games` channel, which would patch the store if g2 really changed.
 *    None of them decides what these specs assert today.
 *
 * 2. Blocking realtime. `page.route` only sees HTTP requests; Playwright never
 *    passes a WebSocket through it (WebSockets have their own
 *    `page.routeWebSocket`). So `page.route("/realtime/", abort)` blocked
 *    nothing, the pay page's channels joined, and the specs' own sanity check
 *    ("no realtime channel should be joined when WS is blocked") failed.
 *    `blockRealtime` closes every realtime socket the page opens, so no
 *    channel can join and any update has to come from the polling fallback.
 */
import type { Page } from "@playwright/test";

/** The mocked host used by the pay specs: an id that belongs to no account. */
export const PAY_FIXTURE_HOST_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** A paid, public, upcoming pickup game row, as `hosted_games` returns it. */
export function payFixtureGameRow(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id,
    host_id: PAY_FIXTURE_HOST_ID,
    sport: "Soccer",
    title: "Sunday Sunset 7v7",
    date: new Date(Date.now() + 22 * 3600_000).toISOString(),
    duration: "90 min",
    location: "Pier 40 Turf",
    neighborhood: "West Side",
    distance_mi: null,
    lat: null,
    lng: null,
    max_players: 14,
    joined: 11,
    skill: "All Levels",
    price: 8,
    indoor: false,
    is_private: false,
    description: "Mixed-gender, all levels.",
    host_snapshot: { name: "Ana García", username: "@anagk", avatar: "AG", rating: 4.8 },
    hidden_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

/** Query parameters that shape a PostgREST read rather than filter it. */
const NON_FILTER_PARAMS = new Set(["select", "order", "limit", "offset"]);

/**
 * Which `hosted_games` GETs get `row` back: the by-id lookup the game and pay
 * pages make (`id=eq.<id>`), and the hosted-games store's list of every game
 * (`hidden_at=is.null` and no other filter; src/lib/hosted-games-store.ts).
 * Any other read (another game's id, an organization's games, the hidden list)
 * gets none, so the row cannot turn up where the real query would not return it.
 */
export function fixtureGameAnswers(url: string, id: string): boolean {
  const params = new URL(url).searchParams;
  const filters = [...params.keys()].filter((k) => !NON_FILTER_PARAMS.has(k));
  if (filters.length !== 1) return false;
  if (filters[0] === "id") return params.getAll("id").every((v) => v === `eq.${id}`);
  return filters[0] === "hidden_at" && params.getAll("hidden_at").join() === "is.null";
}

/**
 * Answer `hosted_games` reads with `row` where the real query would return
 * it (see fixtureGameAnswers) and with no rows otherwise. Install before the
 * page loads.
 */
export async function serveFixtureGame(page: Page, row: Record<string, unknown>): Promise<void> {
  const id = String(row.id);
  await page.route(/\/rest\/v1\/hosted_games(\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const rows = fixtureGameAnswers(route.request().url(), id) ? [row] : [];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": rows.length ? `0-${rows.length - 1}/${rows.length}` : "*/0" },
      body: JSON.stringify(rows),
    });
  });
}

/**
 * Make realtime unavailable: every realtime WebSocket the page opens is closed
 * straight away, so the client keeps retrying and no channel ever joins. The
 * channel objects (and their bindings) still exist, as they would for a client
 * whose socket keeps dropping. Install before the page loads.
 */
export async function blockRealtime(page: Page): Promise<void> {
  await page.routeWebSocket(
    (url) => url.pathname.includes("/realtime/"),
    (ws) => {
      void ws.close({ code: 1011, reason: "realtime blocked by test" });
    },
  );
}

/** Whether any of the page's Supabase realtime channels has joined. */
export async function anyRealtimeChannelJoined(page: Page): Promise<boolean> {
  return page.evaluate(async () => {
    const mod = await import("/src/integrations/supabase/client.ts");
    return mod.supabase
      .getChannels()
      .some((c: { state: string }) => c.state === "joined" || c.state === "SUBSCRIBED");
  });
}
