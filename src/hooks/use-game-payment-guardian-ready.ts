import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

type GuardianCheckRpc = "game_payment_guardian_ready" | "game_manual_claim_guardian_ready";

/**
 * One of the guardian checks for the signed-in viewer and a game. `requestKey` should change whenever the viewer's
 * request for the game does (its status or guardian stamp), so the answer is asked again. The previous answer for the
 * same game and viewer is kept while the new one loads, so the proof form is not torn down on a refresh; another
 * viewer's answer never is. An error is an error: the caller fails closed.
 */
function useGuardianCheck(
  rpc: GuardianCheckRpc,
  gameId: string | undefined,
  userId: string | null,
  requestKey: string,
) {
  const game = gameId ?? "";
  const viewer = userId ?? "anon";
  return useQuery({
    queryKey: [rpc.replace(/_/g, "-"), game, viewer, requestKey],
    enabled: !!gameId && !!userId,
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === game && previousQuery?.queryKey[2] === viewer
        ? previous
        : undefined,
    staleTime: 30_000,
    retry: 1,
    // While the answer is no, a guardian may approve (or end the link) from their own device: ask again now and then.
    refetchInterval: (q) => (q.state.data === false ? 15_000 : false),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase.rpc(rpc as never, { _game_id: gameId } as never);
      if (error) throw new Error(error.message);
      if (typeof data !== "boolean") throw new Error(`${rpc}: no answer`);
      return data;
    },
  });
}

/**
 * public.game_payment_guardian_ready(game) for the signed-in viewer (20261111100000): false while the viewer has an
 * active guardian link and no guardian-approved request for this game (an adult with a stored birthday is exempt).
 * The PayPal checkout asks the same on the server; the pay page asks it before it shows the host's handles, because a
 * host-approved request can still be waiting on the guardian.
 */
export function useGamePaymentGuardianReady(
  gameId: string | undefined,
  userId: string | null,
  requestKey: string,
) {
  return useGuardianCheck("game_payment_guardian_ready", gameId, userId, requestKey);
}

/**
 * public.game_manual_claim_guardian_ready(game) for the signed-in viewer (20261124200000): the manual-claim trigger's
 * own rule (enforce_guardian_before_payment), with no adult exemption. It differs from useGamePaymentGuardianReady only
 * for a viewer known to be 18 or over whose guardian link from before 18 is still active: PayPal takes their payment,
 * the database refuses their Venmo / Cash App proof. The pay page asks it before it shows a manual method
 * (payManualMethodsStep, docs/paid-path-gates.md section 6 (d)).
 */
export function useGameManualClaimGuardianReady(
  gameId: string | undefined,
  userId: string | null,
  requestKey: string,
) {
  return useGuardianCheck("game_manual_claim_guardian_ready", gameId, userId, requestKey);
}
