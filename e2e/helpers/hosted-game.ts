import type { Page } from "@playwright/test";
import { pgrstBody } from "./postgrest";

/**
 * A `hosted_games` row as the database returns it, for specs that mock the
 * game a flow runs on.
 *
 * Specs used to answer `hosted_games` with `[]` and rely on the app's bundled
 * sample games for ids like "g2". Those were removed (src/lib/sample-data.ts:
 * `GAMES` has been `[]` since a06a087d), so an empty answer now means "no such
 * game" and the pay page stays in its lookup stage. Serve the row instead.
 */
export function hostedGameRow(overrides: { id: string; host_id: string } & Record<string, unknown>) {
  const now = new Date().toISOString();
  return {
    sport: "Soccer",
    title: "Sunday Sunset 7v7",
    host_snapshot: { name: "E2E Host", username: "@e2ehost", avatar: "EH", rating: 5 },
    date: new Date(Date.now() + 24 * 3600_000).toISOString(),
    duration: "90 min",
    location: "Pier 40 Turf",
    neighborhood: "West Side",
    distance_mi: null,
    lat: null,
    lng: null,
    max_players: 14,
    joined: 11,
    skill: "All Levels",
    price: 0,
    indoor: false,
    is_private: false,
    image: "",
    description: "E2E fixture game",
    equipment: [],
    status: "scheduled",
    joins_closed: false,
    positions_needed: {},
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

/** Answer `hosted_games` reads (list and `.maybeSingle()`) with `row`. */
export async function serveHostedGame(page: Page, row: ReturnType<typeof hostedGameRow>) {
  await page.route(/\/rest\/v1\/hosted_games(?:\?|$)/, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/1" },
      body: pgrstBody(route, [row]),
    });
  });
}
