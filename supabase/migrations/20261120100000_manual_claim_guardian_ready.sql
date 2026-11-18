-- docs/paid-path-gates.md section 6, "Also related" (d): the pay page can see the manual-claim guardian rule.
--
-- public.game_payment_guardian_ready(game) (20261111100000), the pay page's and PayPal checkout's view of the guardian
-- rule, exempts a player known to be 18 or over even while a guardian link made before 18 is still active. The BEFORE
-- INSERT trigger on payment_submissions that checks a player's own manual claim (Venmo, Cash App, other),
-- enforce_guardian_before_payment, asks private_sec.guardian_payment_approval_missing(player, game) with no such
-- exemption. So that player was shown the host's handles and the proof form, paid in Venmo, and had the proof refused
-- (GUARDIAN_APPROVAL_REQUIRED).
--
-- Owner decision 2026-11-18: the guardian rule is NOT loosened (the trigger keeps refusing). The pay page instead stops
-- offering a manual method it knows the database will refuse. This migration gives it the trigger's exact rule:
--   public.game_manual_claim_guardian_ready(game): true when the signed-in caller's own manual claim for the game would
--   pass enforce_guardian_before_payment (no active guardian link, or a valid guardian approval on an open request for
--   this game), false otherwise and for a caller who is not signed in. It answers only about the caller (no player
--   argument), as game_payment_guardian_ready does, and says nothing that function does not already say to the same
--   caller except whether a guardian link is still active for an adult, which is the caller's own link.
-- Read-only: no table, trigger, policy or existing function changes. The trigger, the RPC and PayPal are unchanged.
-- Deploy order: this migration BEFORE the app. Without it the app fails closed on the manual methods only: the pay
-- page offers no manual method or proof form (a Retry in their place) and the game page's Payments tab shows no
-- handles. PayPal checkout does not depend on this function and stays offered.
-- Rollback: docs/rollbacks/20261120100000_manual_claim_guardian_ready.down.sql (guarded).

CREATE OR REPLACE FUNCTION public.game_manual_claim_guardian_ready(_game_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  -- enforce_guardian_before_payment's rule for the caller's own claim (player_id = auth.uid(), the only row the
  -- "Players create own submissions" policy lets a player write), with no exemption: exactly what the trigger asks.
  SELECT auth.uid() IS NOT NULL
     AND NOT private_sec.guardian_payment_approval_missing(auth.uid(), _game_id);
$$;
REVOKE ALL ON FUNCTION public.game_manual_claim_guardian_ready(text) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.game_manual_claim_guardian_ready(text) TO authenticated;
COMMENT ON FUNCTION public.game_manual_claim_guardian_ready(text) IS
  'Whether the signed-in caller''s own manual payment claim for the game passes enforce_guardian_before_payment (no adult exemption). docs/paid-path-gates.md section 6 (d).';
