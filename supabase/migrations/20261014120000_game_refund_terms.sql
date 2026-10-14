-- Public read of a game's refund terms.
--
-- game_payment_settings is readable only by the host and players already linked
-- to the game (it also holds payment instructions), so a visitor — or a player
-- who hasn't asked to join yet — read it as empty and the app fell back to the
-- default "refundable until cutoff" wording, even for non-refundable events.
-- Refund terms are meant to be seen *before* joining, so expose just those
-- three fields, for games the caller is allowed to see.

CREATE OR REPLACE FUNCTION public.get_game_refund_terms(_game_id text)
RETURNS TABLE (refund_rule text, late_refund_pct integer, refund_policy text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.refund_rule, s.late_refund_pct, s.refund_policy
  FROM public.game_payment_settings s
  JOIN public.hosted_games g ON g.id = s.game_id
  WHERE s.game_id = _game_id
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

REVOKE EXECUTE ON FUNCTION public.get_game_refund_terms(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_game_refund_terms(text) TO anon, authenticated;
