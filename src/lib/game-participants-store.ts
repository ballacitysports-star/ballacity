import { useHostedGameJoined } from "@/lib/hosted-games-store";

/**
 * Live per-game participant count, for "N spots left" on game cards, the map,
 * the game page and the pay page.
 *
 * It is hosted_games.joined from the hosted-games store. The
 * game_participants_sync_count trigger keeps that column equal to the game's
 * participant rows (counting every row, including ones a viewer may not see),
 * and the store's one app-wide hosted_games channel delivers each change. So no
 * card opens a channel or runs a count query of its own (P2-6).
 *
 * Returns `undefined` until the store has loaded from the database, and for a
 * game the store does not hold, so callers fall back to their own `game.joined`
 * without briefly showing 0.
 */
export function useLiveParticipantCount(gameId: string | undefined): number | undefined {
  return useHostedGameJoined(gameId);
}
