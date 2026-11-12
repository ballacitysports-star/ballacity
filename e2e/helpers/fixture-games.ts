/**
 * The fixed "g1"/"g2" fixture games, in one place.
 *
 * global-setup.ts seeds these rows into the sandbox's hosted_games for the
 * specs that use the real rows. The specs that only need the game to exist
 * (pay screen, game page) answer the reads from the same rows instead, with
 * `answerFixtureGameReads`, so they no longer wait on the sandbox to find them.
 *
 * Why that matters: src/lib/sample-data.ts ships no games, so a page for g1/g2
 * looks the game up in hosted_games, and gives up after 8s
 * (GAME_LOOKUP_TIMEOUT_MS) with "Game not found". Under the suite's own load
 * the sandbox answered slower than that, or not at all, and whichever pay or
 * game-page spec was running at the time failed. Reproduced on 2026-11-12 by
 * holding every unanswered sandbox request: both smoke pay specs ended on
 * "Game not found.", with `hosted_games?id=eq.g2` the only held read the
 * screen waits for.
 */
import type { Page, Route } from "@playwright/test";

/** The g1/g2 rows as global-setup writes them; `hostId` is the fixture games host. */
export function fixtureGameRows(hostId: string, now: number = Date.now()) {
  return [
    {
      id: "g1",
      host_id: hostId,
      sport: "Basketball",
      title: "Friday Night Run · 5v5 Full Court",
      date: new Date(now + 3 * 3600_000).toISOString(),
      duration: "120 min",
      location: "Tompkins Square Courts",
      neighborhood: "East Village",
      max_players: 10,
      joined: 8,
      skill: "Intermediate",
      price: 0,
      indoor: false,
      is_private: false,
      description:
        "Competitive but chill. We rotate teams every game to 11. Bring a light + dark shirt.",
      host_snapshot: { name: "Marcus Lee", username: "@marcus", avatar: "ML", rating: 4.9 },
    },
    {
      id: "g2",
      host_id: hostId,
      sport: "Soccer",
      title: "Sunday Sunset 7v7",
      date: new Date(now + 22 * 3600_000).toISOString(),
      duration: "90 min",
      location: "Pier 40 Turf",
      neighborhood: "West Side",
      max_players: 14,
      joined: 11,
      skill: "All Levels",
      price: 8,
      indoor: false,
      is_private: false,
      description: "Mixed-gender, all levels. $8 covers turf rental. Cleats recommended.",
      host_snapshot: { name: "Ana García", username: "@anagk", avatar: "AG", rating: 4.8 },
    },
  ];
}

/**
 * Stands in for the fixture games host account when the rows are answered
 * locally. Nobody signs in as it, so the viewer is never the host, as with
 * the real account.
 */
export const MOCK_FIXTURE_HOST_ID = "e2e0e2e0-0000-4000-8000-0000000000f1";

/** The columns the database fills in with defaults, as the sandbox returns them. */
const DB_DEFAULTS = {
  distance_mi: 0,
  lat: 50,
  lng: 50,
  urgent: false,
  trending: false,
  image: "",
  equipment: [],
  status: null,
  joins_closed: false,
  positions_needed: {},
  team_id: null,
  org_id: null,
  signup_cutoff_min: 0,
  hidden_at: null,
  min_age: null,
  max_age: null,
  series_id: null,
  ends_at: null,
  all_day: false,
  timezone: null,
  arrive_early_min: 0,
  rrule: null,
  reminder_offsets: [],
  min_players: 0,
  allow_waitlist: true,
  cancellation_policy: "flexible",
  cancellation_notes: null,
  game_rules: null,
  cancelled_at: null,
  cancellation_reason: null,
  completed_at: null,
  org_official: false,
  org_hidden_at: null,
  org_hidden_by: null,
  cancel_cutoff_min: 120,
  owner_hidden_at: null,
  moderator_hidden_at: null,
};

function json(route: Route, body: unknown) {
  return route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

/**
 * Answer the reads that find g1/g2 from the rows above:
 *
 *  - hosted_games by id (the page's own lookup): the fixture row, or no row for
 *    any other id, so an unknown game is "not found" without asking the sandbox;
 *  - the hosted_games list (the feed store): g1 and g2;
 *  - g1's game_payment_settings: free, no approval, as global-setup seeds it.
 *    The game page fails closed to "Request Spot" until this arrives.
 *
 * Registered on the browser context, so any `page.route` a spec sets for these
 * tables (its own settings, or another hosted game) takes precedence over it.
 */
export async function answerFixtureGameReads(page: Page) {
  const now = Date.now();
  const rows = fixtureGameRows(MOCK_FIXTURE_HOST_ID, now).map((r) => ({
    ...DB_DEFAULTS,
    ...r,
    created_at: new Date(now - 86_400_000).toISOString(),
    updated_at: new Date(now - 60_000).toISOString(),
  }));
  const ctx = page.context();

  await ctx.route(/\/rest\/v1\/hosted_games(?:\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const id = new URL(route.request().url()).searchParams.get("id");
    if (id?.startsWith("eq."))
      return json(
        route,
        rows.filter((r) => r.id === id.slice(3)),
      );
    if (id) return route.fallback();
    return json(route, rows);
  });

  await ctx.route(/\/rest\/v1\/game_payment_settings(?:\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    if (new URL(route.request().url()).searchParams.get("game_id") !== "eq.g1") {
      return route.fallback();
    }
    return json(route, [
      {
        id: "e2e-fixture-g1-settings",
        game_id: "g1",
        host_id: MOCK_FIXTURE_HOST_ID,
        entry_fee: 0,
        accepted_method_ids: [],
        payment_deadline: null,
        refund_policy: null,
        payment_instructions: null,
        requires_approval: false,
        created_at: new Date(now - 86_400_000).toISOString(),
        updated_at: new Date(now - 60_000).toISOString(),
      },
    ]);
  });
}
