import { useEffect, useState } from "react";
import { getGameJoinPolicy, type GamePaymentSettings } from "@/lib/payments";

/**
 * Whether a game requires host approval to join, whoever is looking.
 *
 * The host and linked players hold the full settings row, so they read the flag
 * straight from it. Everyone else (visitors, players who haven't asked to join)
 * cannot read that row, so they get the flag from the public
 * `get_game_join_policy` RPC instead of falling back to the request-to-join
 * default on every game. Returns `null` while unknown — no settings loaded and
 * the public read hasn't resolved (or the game has no settings row) — so the
 * caller applies its own approval-by-default.
 */
export function useGameJoinPolicy(
  gameId: string | undefined,
  settings: GamePaymentSettings | null,
): boolean | null {
  const [publicRequiresApproval, setPublicRequiresApproval] = useState<boolean | null>(null);
  useEffect(() => {
    if (!gameId || settings) return;
    let cancelled = false;
    getGameJoinPolicy(gameId)
      .then((p) => !cancelled && setPublicRequiresApproval(p ? p.requires_approval : null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gameId, settings]);
  return settings ? !!settings.requires_approval : publicRequiresApproval;
}
