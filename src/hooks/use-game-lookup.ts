import { useEffect, useState } from "react";
import type { Game } from "@/lib/sample-data";
import { fetchHostedGame } from "@/lib/hosted-games-store";

/** How long a lookup by id may take before the page gives up and renders without it. */
export const GAME_LOOKUP_TIMEOUT_MS = 8_000;

/**
 * Looks a game up by id when the page does not already hold it.
 *
 * `known` is a boolean on purpose. The caller derives it from `useHostedGames()`,
 * which hands back a new array on every render; when the pay page keyed this
 * lookup on that array, every render restarted it, reset it to "loading" and
 * sent another `hosted_games?id=eq.…` request. A lookup that took longer than
 * the gap between two renders never finished, and one that answered "no such
 * game" re-rendered the page and so started itself again: about 130 requests a
 * second, with the page stuck on "Loading… (lookup)" for good.
 *
 * `lookupDone` turns true once the game is known, the lookup answered (found or
 * not), or the timeout passed, and stays true while the inputs stay the same.
 */
export function useGameLookup(
  gameId: string,
  known: boolean,
  options: {
    timeoutMs?: number;
    fetchGame?: (id: string) => Promise<Game | null>;
  } = {},
): { remoteGame: Game | null; lookupDone: boolean } {
  const { timeoutMs = GAME_LOOKUP_TIMEOUT_MS, fetchGame = fetchHostedGame } = options;
  const [remoteGame, setRemoteGame] = useState<Game | null>(null);
  const [lookupDone, setLookupDone] = useState(known);

  useEffect(() => {
    if (known) {
      setLookupDone(true);
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    setLookupDone(false);
    setRemoteGame(null);
    const timeout = new Promise<null>((resolve) => {
      timer = window.setTimeout(() => resolve(null), timeoutMs);
    });
    Promise.race([fetchGame(gameId), timeout])
      .then((found) => {
        if (!cancelled) setRemoteGame(found ?? null);
      })
      .catch(() => {
        if (!cancelled) setRemoteGame(null);
      })
      .finally(() => {
        if (timer !== undefined) window.clearTimeout(timer);
        if (!cancelled) setLookupDone(true);
      });

    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // fetchGame is a dependency in name only: callers pass a stable function.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, known, timeoutMs]);

  return { remoteGame, lookupDone };
}
