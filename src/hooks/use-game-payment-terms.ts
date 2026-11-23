import { useEffect, useState } from "react";
import {
  getGamePaymentTerms,
  type GamePaymentSettings,
  type GamePaymentTerms,
} from "@/lib/payments";

/**
 * The payment terms a player who cannot read the host's settings row may know before approval or payment: the entry fee
 * PayPal will charge, the deadline, the accepted payment apps by name, and whether the host approves first
 * (public.get_game_payment_terms; docs/paid-path-gates.md section 6 (c)). The host and linked players hold the full row
 * and read it directly, so nothing is asked for them (`settings` is set), and nothing is asked while signed out or for
 * the host.
 *
 * Fails closed: while unknown, and when the read fails (the function is not there yet, an error), the answer is null
 * and the page shows what it showed before. No error text is kept or shown. pay-entry-gate.ts (payTermsView) decides
 * whether a given page shows them.
 */
export function useGamePaymentTerms(
  gameId: string | undefined,
  settings: GamePaymentSettings | null,
  options: { enabled: boolean; userId: string | null | undefined },
): GamePaymentTerms | null {
  const [terms, setTerms] = useState<{ key: string; terms: GamePaymentTerms | null } | null>(null);
  const { userId } = options;
  const enabled = options.enabled && !settings && !!gameId && !!userId;
  // The answer belongs to one signed-in account and one game: the server answers about the caller, so another
  // account's answer, or another game's, never stands in for this one's (a refused viewer is told nothing).
  const key = enabled ? `${userId}:${gameId}` : null;
  useEffect(() => {
    if (!key || !gameId) {
      // Signed out, the viewer reads the row, or the read is off: nothing is kept.
      setTerms(null);
      return;
    }
    let cancelled = false;
    getGamePaymentTerms(gameId)
      .then((t) => !cancelled && setTerms({ key, terms: t }))
      .catch(() => !cancelled && setTerms({ key, terms: null }));
    return () => {
      cancelled = true;
    };
  }, [gameId, key]);
  return key && terms && terms.key === key ? terms.terms : null;
}
