import { useEffect, useState } from "react";
import { getGameRefundTerms, type GamePaymentSettings } from "@/lib/payments";
import type { RefundTerms } from "@/lib/refund-policy";

/**
 * Refund terms for a game, whoever is looking. The host and linked players
 * already hold the full settings row; everyone else (visitors, players who
 * haven't asked to join) gets the public terms instead of an empty default.
 */
export function useGameRefundTerms(
  gameId: string | undefined,
  settings: GamePaymentSettings | null,
): RefundTerms | null {
  const [publicTerms, setPublicTerms] = useState<RefundTerms | null>(null);
  useEffect(() => {
    if (!gameId || settings) return;
    let cancelled = false;
    getGameRefundTerms(gameId)
      .then((t) => !cancelled && setPublicTerms(t))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [gameId, settings]);
  return settings ?? publicTerms;
}
