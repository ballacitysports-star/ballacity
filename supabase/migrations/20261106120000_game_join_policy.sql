-- Public read of a game's join policy (does it require host approval?).
--
-- game_payment_settings is readable only by the host and players already linked
-- to the game (payment_settings_host_guard), because that row also holds the
-- payee and payment instructions. But `requires_approval` is a non-sensitive
-- join-UX flag, not a payment destination: it only says whether the host
-- screens joiners. After the read lockdown, a prospective viewer read it as
-- absent, so the join CTA fell back to the "request to join" default on EVERY
-- game — including ones whose host explicitly set requires_approval = false
-- (instant join). The host's chosen setting became invisible to the very people
-- it is for.
--
-- Expose just that one flag, the same way get_game_refund_terms exposes the
-- refund fields: for games the caller is allowed to see, and only from the
-- payee's row so a stranger's planted row is never believed. The payee, the fee
-- destination and the payment methods stay host-only. A game with no settings
-- row returns no row here, and the app keeps its "approval by default" fallback.
CREATE OR REPLACE FUNCTION public.get_game_join_policy(_game_id text)
RETURNS TABLE (requires_approval boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.requires_approval
  FROM public.game_payment_settings s
  JOIN public.hosted_games g ON g.id = s.game_id
  WHERE s.game_id = _game_id
    AND s.host_id = private_sec.game_payee(s.game_id)
    AND (
      g.is_private = false
      OR g.host_id = auth.uid()
      OR public.is_game_participant(g.id, auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.join_requests jr
        WHERE jr.game_id = g.id AND jr.player_id = auth.uid()
      )
    )
  ORDER BY s.created_at DESC
  LIMIT 1;
$$;
REVOKE EXECUTE ON FUNCTION public.get_game_join_policy(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_game_join_policy(text) TO anon, authenticated;
