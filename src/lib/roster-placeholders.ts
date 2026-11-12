/**
 * How many anonymous "taken" chips the game page's roster strip draws besides the players it can name.
 *
 * game_participants is readable only by the host and the game's own players. Anyone else gets no rows, while the live
 * count (hosted_games.joined) still counts every place, so they see one placeholder per place taken by someone else.
 * A viewer who can read the roster sees none once it has loaded, so a player the host removed leaves no ghost behind.
 * While the roster is still loading, placeholders stand in for the places it will fill.
 */
export function rosterPlaceholderCount(opts: {
  /** Places taken, the viewer's own included when it counts (the strip's "Roster (N/M)" number). */
  takenPlaces: number;
  /** The viewer is drawn separately, as "YOU". */
  viewerHoldsPlace: boolean;
  /** Other players the strip can name from the roster it read. */
  namedOthers: number;
  rosterLoading: boolean;
  /** The host or one of the game's players: allowed to read the whole roster. */
  canReadRoster: boolean;
}): number {
  if (opts.canReadRoster && !opts.rosterLoading) return 0;
  return Math.max(0, opts.takenPlaces - (opts.viewerHoldsPlace ? 1 : 0) - opts.namedOthers);
}
