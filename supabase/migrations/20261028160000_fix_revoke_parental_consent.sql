-- A guardian withdrawing a child's consent failed outright.
--
-- revoke_parental_consent tightens the child's privacy preferences as part of the
-- withdrawal, and set messages and invites to 'none'. The table only allows
-- 'everyone', 'shared' or 'nobody' (privacy_preferences_allow_messages_check and
-- privacy_preferences_allow_invites_check), so for any child with a privacy
-- preferences row the UPDATE raised, the whole function rolled back, and consent
-- stayed approved. The withdrawal the Parent Center offers did nothing.
--
-- The one change: 'none' -> 'nobody'. Nothing else in the function, its grants or
-- its checks is touched (CREATE OR REPLACE keeps the existing grants).
-- Regression test: supabase/tests/260_guardian_actions.test.sql.

CREATE OR REPLACE FUNCTION public.revoke_parental_consent(_child uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid(); r public.parental_consents;
BEGIN
  SELECT * INTO r FROM public.parental_consents WHERE child_user_id = _child;
  IF r.id IS NULL THEN RAISE EXCEPTION 'CONSENT_NOT_FOUND'; END IF;
  IF NOT (public.is_guardian_of(me, _child) OR public.is_moderator(me)) THEN
    RAISE EXCEPTION 'NOT_AUTHORIZED';
  END IF;

  UPDATE public.parental_consents SET
    status = 'revoked', revoked_at = now(), revoked_reason = _reason,
    verification_token_hash = NULL, token_expires_at = NULL
  WHERE id = r.id;

  -- Immediately apply restrictions rather than only flipping a flag.
  UPDATE public.child_controls SET
    messaging = 'off', media_visibility = 'private', social_discovery = false,
    ai_analysis = false, game_participation = false, updated_by = me
  WHERE child_user_id = _child;

  UPDATE public.privacy_preferences SET
    profile_visibility = 'private', allow_messages = 'nobody', allow_invites = 'nobody',
    location_precision = 'city', ai_processing = false, ai_training_opt_in = false
  WHERE user_id = _child;

  UPDATE public.highlight_reels SET hidden_at = COALESCE(hidden_at, now()) WHERE user_id = _child;
  UPDATE public.player_availabilities SET hidden_at = COALESCE(hidden_at, now()), status = 'inactive'
  WHERE user_id = _child;

  INSERT INTO public.parental_consent_events (consent_id, child_user_id, actor_id, action, from_status, to_status, detail)
  VALUES (r.id, _child, me, 'consent_revoked', r.status, 'revoked', jsonb_build_object('reason', _reason));
END $function$;
