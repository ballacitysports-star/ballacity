/**
 * What the game list should say when it has nothing to show. One wrong answer used
 * to cover every case ("your filters are narrowing this down"), including a list
 * that had not loaded yet, one that failed to load, and an area with no games at
 * all. Pure, so each case can be tested.
 */
export type FeedEmptyKind = "loading" | "error" | "none-yet" | "search" | "filters";

export function feedEmptyKind(input: {
  /** The first load has not finished. */
  loading: boolean;
  /** The first load failed. */
  failed: boolean;
  /** How many games exist in total, before any filter or search. */
  totalGames: number;
  query: string;
  filtersActive: boolean;
}): FeedEmptyKind {
  if (input.totalGames === 0) {
    if (input.failed) return "error";
    if (input.loading) return "loading";
    return "none-yet";
  }
  if (input.query.trim()) return "search";
  return input.filtersActive ? "filters" : "none-yet";
}
