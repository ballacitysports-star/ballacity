-- WP 3.2a (Phase 3): a host can invite their regulars again, without waiting for an availability post.
--
-- WHY. Since WP 2.0 a host can invite a player only through one of the player's open availability posts. The people who already
-- played in the host's games, the obvious first call for next week's run, could not be invited unless they had posted. The owner
-- decided (2026-11-19) that a host may re-invite people who played in their games in the last 90 days, without a post, subject
-- to blocks, the player's invitation setting, the minor and guardian rules and the game's age range, and that players can turn
-- this off.
--
-- WHAT.
-- 1. privacy_preferences.allow_regular_invites (default true): "hosts I've played with can invite me". The owner edits it like the
--    other settings (existing row policies).
-- 2. private_sec.regular_invitable(_host, _player): the player held a place in a game this host hosted that took place in the
--    last 90 days and was not cancelled; the player is an adult (minors keep the post-based path and its guardian rules), not
--    suspended, with no block either way, and has not turned the setting off.
-- 3. public.game_invite_player: when no post is named and none is visible, a regular may be invited. Everything else is
--    unchanged and still applies: the host owns an open game with room, the player's invitation setting (allow_invites), the
--    minor messaging rules, the game's age range, the 7-day cool-down after a decline, the limits, the neutral refusal
--    INVITE_NOT_AVAILABLE, and the notification. game_invite_players (bulk) calls it, so it follows.
-- 4. public.my_regular_players(_game): for the host of an open game, their regulars (at most 50, most recent first) with when
--    they last played, how many games, and where they stand for this game (in the game, invited, accepted, declined recently,
--    or available). Names are read from profiles as the host may see them.
--
-- Rollback: docs/rollbacks/20261123100000_regular_invites.down.sql.

-- 1. The player's setting --------------------------------------------------------------------------------------------------------
ALTER TABLE public.privacy_preferences ADD COLUMN IF NOT EXISTS allow_regular_invites boolean NOT NULL DEFAULT true;

-- 2. Who is a regular --------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.regular_invitable(_host uuid, _player uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT _host IS NOT NULL AND _player IS NOT NULL AND _host <> _player
     AND EXISTS (SELECT 1 FROM public.game_participants p JOIN public.hosted_games g ON g.id = p.game_id
                  WHERE g.host_id = _host AND p.user_id = _player AND g.cancelled_at IS NULL
                    AND g.date <= now() AND g.date > now() - interval '90 days')
     AND public.age_cohort_of(_player) IS NOT DISTINCT FROM 'adult'
     AND NOT private_sec.blocks_exist_between(_host, _player)
     AND NOT EXISTS (SELECT 1 FROM public.profiles pr
                      WHERE pr.id = _player AND (pr.suspended_at IS NOT NULL OR pr.moderation_state IN ('suspended', 'banned')))
     AND COALESCE((SELECT pp.allow_regular_invites FROM public.privacy_preferences pp WHERE pp.user_id = _player), true)
$$;
REVOKE ALL ON FUNCTION private_sec.regular_invitable(uuid, uuid) FROM PUBLIC, anon, authenticated;

-- 3. Inviting -------------------------------------------------------------------------------------------------------------------------
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
  _regular boolean := false;
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
  -- No open post: a regular (WP 3.2a) may still be invited: an adult who held a place in one of this host's games in the last
  -- 90 days, no block either way, not suspended, and who has not turned "hosts I've played with can invite me" off.
  IF _post IS NULL AND _availability IS NULL THEN
    _regular := private_sec.regular_invitable(_me, _invitee);
  END IF;
  _mode := COALESCE(public.privacy_text(_invitee, 'allow_invites'), 'everyone');
  _block := public.minor_messaging_block(_me, _invitee);
  IF _block LIKE '%:self' THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (_post IS NULL AND NOT _regular)
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

-- 4. The host's list of regulars for a game ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_regular_players(_game text)
RETURNS TABLE (user_id uuid, last_played timestamptz, games integer, status text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
DECLARE
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE = '28000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.hosted_games g WHERE g.id = _game AND g.host_id = _me) THEN
    RAISE EXCEPTION 'NOT_GAME_HOST: only the game''s host can see whom to invite.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH played AS (
    SELECT p.user_id AS uid, max(g.date) AS last_played, count(DISTINCT g.id)::integer AS games
      FROM public.game_participants p JOIN public.hosted_games g ON g.id = p.game_id
     WHERE g.host_id = _me AND p.user_id <> _me AND g.cancelled_at IS NULL
       AND g.date <= now() AND g.date > now() - interval '90 days'
     GROUP BY p.user_id
  )
  SELECT pl.uid, pl.last_played, pl.games,
         CASE
           WHEN private_sec.is_game_participant(_game, pl.uid) THEN 'in_game'
           WHEN EXISTS (SELECT 1 FROM public.game_invites i WHERE i.game_id = _game AND i.invitee_id = pl.uid AND i.status = 'accepted') THEN 'accepted'
           WHEN EXISTS (SELECT 1 FROM public.game_invites i WHERE i.game_id = _game AND i.invitee_id = pl.uid AND i.status = 'pending') THEN 'invited'
           WHEN EXISTS (SELECT 1 FROM public.game_invites i WHERE i.game_id = _game AND i.invitee_id = pl.uid AND i.status = 'declined'
                          AND i.responded_at > now() - interval '7 days') THEN 'declined_recently'
           ELSE 'available'
         END
    FROM played pl
   WHERE private_sec.regular_invitable(_me, pl.uid)
   ORDER BY pl.last_played DESC, pl.uid
   LIMIT 50;
END $$;
REVOKE ALL ON FUNCTION public.my_regular_players(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_regular_players(text) TO authenticated;
