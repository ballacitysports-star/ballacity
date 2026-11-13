/**
 * Read a game's live participant counters off the surfaces the realtime specs
 * watch, as they render today.
 *
 * - Feed card (src/components/GameCard.tsx): the counter reads "N spots open"
 *   (or an urgency pill) and carries the exact count in its title,
 *   "X of Y joined". It used to print a bare "X/Y", which is what the specs
 *   looked for; with that gone the feed and map checks were silently skipped
 *   or compared nulls.
 * - Map view: Discover was merged into the feed as its Map view
 *   (src/routes/_tabs.discover.tsx now redirects to /feed). The active pin's
 *   bottom card (PlayMapView's DefaultGameCard) links to the game and shows a
 *   `SpotsPill`, a role="status" element whose text is "N spots" or "Full".
 *   Filtering the feed to the game's title makes that game the active card, so
 *   the spec does not depend on which pin happens to come first.
 */
import type { Locator, Page } from "@playwright/test";

/** The feed card (or any GameCard) linking to `gameId`. */
function gameCardLinks(page: Page, gameId: string): Locator {
  return page.locator(`a[href="/games/${gameId}"]`);
}

/** "X" from the card's "X of Y joined" counter, or null while no card shows one. */
export async function readCardJoinedCount(page: Page, gameId: string): Promise<number | null> {
  const counter = gameCardLinks(page, gameId)
    .getByTitle(/^\d+ of \d+ joined$/)
    .first();
  if ((await counter.count()) === 0) return null;
  const title = await counter.getAttribute("title");
  const m = title?.match(/^(\d+) of \d+ joined$/);
  return m ? Number(m[1]) : null;
}

/** The feed's Map view, filtered so `title`'s game is the active bottom card. */
export function mapViewUrlFor(title: string): string {
  return `/feed?view=map&q=${encodeURIComponent(title)}`;
}

/** The map bottom card's live spots pill for `gameId`. */
export function mapSpotsPill(page: Page, gameId: string): Locator {
  return gameCardLinks(page, gameId).getByRole("status").first();
}

/** Spots left on the map bottom card for `gameId` ("Full" reads as 0), or null if absent. */
export async function readMapSpotsLeft(page: Page, gameId: string): Promise<number | null> {
  const pill = mapSpotsPill(page, gameId);
  if ((await pill.count()) === 0) return null;
  const text = ((await pill.textContent()) ?? "").trim();
  if (/^full$/i.test(text)) return 0;
  const m = text.match(/(\d+)\s+spots?/);
  return m ? Number(m[1]) : null;
}
