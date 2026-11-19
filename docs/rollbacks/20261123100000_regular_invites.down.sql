-- ROLLBACK for supabase/migrations/20261123100000_regular_invites.sql (WP 3.2a).
-- NOT a migration. It puts back game_invite_player exactly as WP 2.0 (20261119100000) wrote it (an open availability post is
-- needed again), drops my_regular_players and private_sec.regular_invitable, and drops privacy_preferences.allow_regular_invites
-- (players' choices on that setting are lost; nothing else is). Invitations already sent stay as they are.
-- It stops, changing nothing, if game_invite_player no longer has the definition 20261123100000 gave it (a later change needs a
-- person to look first), and refuses to run unless the session sets the confirmation first:
--     SET app.confirm_regular_invites_rollback = 'yes';
BEGIN;
DO $guard$
DECLARE
  _got text;
BEGIN
  IF current_setting('app.confirm_regular_invites_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: hosts could no longer invite their regulars, and the players'' setting is dropped. Set app.confirm_regular_invites_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _got
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.game_invite_player(text,uuid,uuid,text)');
  IF _got IS DISTINCT FROM '955ca0a1686c3ce0474bc1777d99918b' THEN
    RAISE EXCEPTION 'Refusing to run: public.game_invite_player is not the definition 20261123100000 created (md5 %). A later change needs a person to look first.', _got;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

-- game_invite_player as 20261119100000 wrote it
CREATE OR REPLACE FUNCTION public.game_invite_player(
  _game text, _invitee uuid, _availability uuid DEFAULT NULL, _message text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $$
DECLARE
  _me      uuid := auth.uid();
  _g       record;
  _post    uuid;
  _mode    text;
  _block   text;
  _id      uuid;
  _msg     text := NULLIF(btrim(COALESCE(_message, '')), '');
  _when    text;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  SELECT id, host_id, title, date INTO _g FROM public.hosted_games WHERE id = _game FOR NO KEY UPDATE;
  IF _g.id IS NULL OR _g.host_id IS DISTINCT FROM _me THEN
    RAISE EXCEPTION 'NOT_GAME_HOST: only the game''s host can invite players to it.' USING ERRCODE = '42501';
  END IF;
  IF _invitee IS NULL OR _invitee = _me THEN RAISE EXCEPTION 'SELF_INVITE'; END IF;
  IF _msg IS NOT NULL AND length(_msg) > 500 THEN RAISE EXCEPTION 'Message too long (max 500 characters).'; END IF;
  IF NOT private_sec.game_open_for_invites(_game) THEN
    RAISE EXCEPTION 'GAME_NOT_OPEN: this game is not taking players now.';
  END IF;
  IF (SELECT count(*) FROM public.game_participants p WHERE p.game_id = _game)
     >= (SELECT max_players FROM public.hosted_games WHERE id = _game) THEN
    RAISE EXCEPTION 'GAME_FULL: this game has no free places.';
  END IF;
  IF private_sec.is_game_participant(_game, _invitee)
     OR EXISTS (SELECT 1 FROM public.join_requests jr
                 WHERE jr.game_id = _game AND jr.player_id = _invitee AND jr.status = 'approved') THEN
    RAISE EXCEPTION 'ALREADY_IN_GAME: this player already has a place.';
  END IF;

  -- A pending invitation answers a second one (no second notification).
  SELECT id INTO _id FROM public.game_invites WHERE game_id = _game AND invitee_id = _invitee AND status = 'pending';
  IF _id IS NOT NULL THEN RETURN _id; END IF;

  -- The player: one of their open posts the host can see (blocks either way, suspended accounts, minors and unknown ages
  -- under the read policy's rule), their invitation setting, the messaging rules for minors, a guardian's permission for
  -- games, the game's age range. One answer for all of them.
  SELECT a.id INTO _post
    FROM public.player_availabilities a
   WHERE a.user_id = _invitee
     AND (_availability IS NULL OR a.id = _availability)
     AND a.status = 'open' AND a.hidden_at IS NULL
     AND COALESCE(private_sec.availability_expires_at(a.time_slots, a.timezone, a.starts_on, a.ends_on, a.last_confirmed_at) > now(), true)
     AND private_sec.availability_post_visible(a.user_id)
   ORDER BY (a.id = _availability) DESC NULLS LAST, a.created_at DESC
   LIMIT 1;
  _mode := COALESCE(public.privacy_text(_invitee, 'allow_invites'), 'everyone');
  _block := public.minor_messaging_block(_me, _invitee);
  IF _block LIKE '%:self' THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _post IS NULL
     OR _mode = 'nobody'
     OR (_mode = 'shared' AND NOT public.shares_game_or_chat(_me, _invitee))
     OR _block IS NOT NULL
     OR (private_sec.is_minor(_invitee) AND NOT private_sec.child_game_participation_allowed(_invitee))
     OR NOT COALESCE(private_sec.game_age_fits(_game, _invitee), false) THEN
    RAISE EXCEPTION 'INVITE_NOT_AVAILABLE: this player can''t be invited to this game.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF EXISTS (SELECT 1 FROM public.game_invites
              WHERE game_id = _game AND invitee_id = _invitee AND status = 'declined'
                AND responded_at > now() - interval '7 days') THEN
    RAISE EXCEPTION 'INVITE_DECLINED_RECENTLY: this player declined an invitation to this game in the last 7 days.';
  END IF;
  IF (SELECT count(*) FROM public.game_invites WHERE game_id = _game AND status = 'pending') >= 50 THEN
    RAISE EXCEPTION 'INVITE_LIMIT: a game can have at most 50 invitations waiting for an answer.';
  END IF;
  IF (SELECT count(*) FROM public.game_invites WHERE host_id = _me AND created_at > now() - interval '1 day') >= 100 THEN
    RAISE EXCEPTION 'INVITE_LIMIT: at most 100 invitations a day.';
  END IF;

  INSERT INTO public.game_invites (game_id, host_id, invitee_id, availability_id, message)
  VALUES (_game, _me, _invitee, _post, _msg)
  RETURNING id INTO _id;

  _when := private_sec.game_invite_when(_game);
  INSERT INTO public.notifications (user_id, type, title, body, link)
  VALUES (_invitee, 'game_invite', left('You''re invited to ' || _g.title, 200), _when,
          '/games/' || _game || '?invite=1&from=' || _me || '&inv=' || _id
            || '&exp=' || floor(extract(epoch FROM _g.date) * 1000)::bigint);
  IF private_sec.is_minor(_invitee) THEN
    PERFORM public.notify_guardians(_invitee, 'game_invite', 'Game invitation for your player',
                                    left(_g.title || ' · ' || COALESCE(_when, ''), 300), '/parent');
  END IF;
  RETURN _id;
END $$;
REVOKE ALL ON FUNCTION public.game_invite_player(text, uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_invite_player(text, uuid, uuid, text) TO authenticated;

DROP FUNCTION public.my_regular_players(text);
DROP FUNCTION private_sec.regular_invitable(uuid, uuid);
ALTER TABLE public.privacy_preferences DROP COLUMN allow_regular_invites;

COMMIT;
