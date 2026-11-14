/**
 * Serve a game's `hosted_games` row from a route mock, for the realtime specs
 * that mock every other table of the game page.
 *
 * Those specs used to answer /rest/v1/hosted_games with `[]` and let the page
 * fall back to the bundled sample game of the same id. The sample games are
 * gone (`GAMES` in src/lib/sample-data.ts is empty), so the page showed "Game
 * not found" and nothing under test ever rendered. Serving the row the spec
 * needs keeps it independent of what the target backend holds for that id.
 */
import type { Page } from "@playwright/test";

export type MockGameRow = {
  id: string;
  host_id: string;
  title: string;
  /** Entry fee; 0 for a free game. */
  price?: number;
  max_players?: number;
  joined?: number;
};

/** A complete hosted_games row as `rowToGame` reads it, starting tomorrow. */
export function hostedGameRow(opts: MockGameRow): Record<string, unknown> {
  const now = new Date().toISOString();
  return {
    id: opts.id,
    host_id: opts.host_id,
    sport: "Soccer",
    title: opts.title,
    host_snapshot: { name: "E2E Host", username: "@e2ehost", avatar: "EH", rating: 5 },
    date: new Date(Date.now() + 24 * 3600_000).toISOString(),
    duration: "90 min",
    location: "E2E Turf",
    neighborhood: "Testville",
    distance_mi: null,
    lat: null,
    lng: null,
    max_players: opts.max_players ?? 14,
    joined: opts.joined ?? 0,
    skill: "All Levels",
    price: opts.price ?? 0,
    indoor: false,
    is_private: false,
    urgent: false,
    trending: false,
    image: "",
    description: "Served by a realtime spec's route mock.",
    equipment: [],
    status: "scheduled",
    joins_closed: false,
    positions_needed: {},
    created_at: now,
    updated_at: now,
  };
}

/**
 * Does `row` pass the request's `eq.` / `in.(...)` filters on its own columns?
 * Other operators are not interpreted. Without this, a read such as "games I
 * host" (`host_id=eq.<me>`) would get this game back and make the viewer its
 * host.
 */
function rowMatches(url: URL, row: Record<string, unknown>): boolean {
  for (const [col, filter] of url.searchParams) {
    if (!(col in row)) continue;
    const value = String(row[col]);
    if (filter.startsWith("eq.") && filter.slice(3) !== value) return false;
    if (filter.startsWith("in.(") && filter.endsWith(")")) {
      const list = filter
        .slice(4, -1)
        .split(",")
        .map((v) => v.replace(/^"|"$/g, ""));
      if (!list.includes(value)) return false;
    }
  }
  return true;
}

/**
 * Answer every hosted_games GET (the game page's single-row read and the
 * app-wide list) with just this game, where the request's filters admit it.
 * Install before navigating.
 */
export async function serveHostedGame(
  page: Page,
  opts: MockGameRow,
): Promise<{ row: Record<string, unknown> }> {
  const row = hostedGameRow(opts);
  await page.route(
    (url) => String(url).includes("/rest/v1/hosted_games"),
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const rows = rowMatches(new URL(route.request().url()), row) ? [row] : [];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "content-range": rows.length ? "0-0/1" : "*/0" },
        body: JSON.stringify(rows),
      });
    },
  );
  // Mutate `row` to change what later reads see (e.g. `joined` after a leave).
  return { row };
}

/**
 * Deliver the `hosted_games` UPDATE the database would broadcast for `row`
 * (the game_participants_sync_count trigger rewrites `joined` on every join
 * and leave) to the app-wide `hosted_games:all` channel, the way supabase-js
 * hands a live frame to its listeners. Returns how many listeners ran.
 */
export async function pushHostedGameUpdate(
  page: Page,
  row: Record<string, unknown>,
): Promise<number> {
  return page.evaluate(async (newRow) => {
    const mod = await import("/src/integrations/supabase/client.ts");
    const payload = {
      schema: "public",
      table: "hosted_games",
      commit_timestamp: new Date().toISOString(),
      eventType: "UPDATE",
      new: newRow,
      old: { id: newRow.id },
      errors: null,
    };
    let count = 0;
    for (const ch of mod.supabase.getChannels() as Array<{
      topic?: string;
      bindings?: Record<string, Array<{ callback: (p: unknown) => void }>>;
    }>) {
      if (!ch.topic?.endsWith("hosted_games:all")) continue;
      for (const b of ch.bindings?.postgres_changes ?? []) {
        b.callback(payload);
        count += 1;
      }
    }
    return count;
  }, row);
}
