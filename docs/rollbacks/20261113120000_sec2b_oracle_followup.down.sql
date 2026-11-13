-- ROLLBACK for supabase/migrations/20261113120000_sec2b_oracle_followup.sql (SEC-2b).
-- NOT a migration. It reopens what the migration closed: a signed-in stranger can again learn, for any account id,
--   * through create_direct_conversation's error and minor_messaging_block_me's answer: whether the person is a minor, their age band
--     (under 13 / 13-15), their guardian's messaging control, and an adult's own allow_messages setting ('nobody' vs 'shared');
--   * through player_activity_stats: an adult's whole activity (private and hidden games, late cancellations, hidden teams), and that anyone
--     who gets zeros is not a confirmed adult;
--   * through request_follow: a block named as such (FOLLOW_BLOCKED), and minor-or-not for accounts whose profile they cannot see
--     ('requested' / 'following'); such accounts are again followed at once, without a request;
--   * through host_attendance_stats: an adult host's private and hidden games;
--   * through player_trait_counts: an adult's review traits (AI-derived included), and that anyone who gets zeros is not a confirmed adult.
-- It puts back, byte for byte, the definitions in force on main before the migration (md5(pg_get_functiondef)):
--   public.create_direct_conversation(uuid, text): cbf648a5ca29740af7ca916631351ce1
--   public.minor_messaging_block_me(uuid): fa778b4b33c2d0b5320ec8a4fc0b9d76
--   public.enforce_minor_messaging(): 78d384b2011d30151c2489cca270cedb
--   public.player_activity_stats(uuid): 8dae1e12c3612739f31a2a04475a0b4a
--   public.request_follow(uuid): 33b706688c43aaaa18e2af7e79d9af06
--   public.host_attendance_stats(uuid): 5e7c94e22cb6ba69a769142c0f68b07d
--   public.player_trait_counts(uuid): 0e1d7c44b6c5cb9f4754dc55e5fd482f
-- gives EXECUTE on public.minor_messaging_block_me(uuid) back to authenticated (the same grants as before; the ACL lists them in another
-- order), and drops private_sec.direct_message_refusal(uuid, uuid). CREATE OR REPLACE keeps owners, grants and comments. Requests that
-- request_follow filed while the migration was in force stay; the people asked approve or decline them as usual. No row is written.
-- The app change that shipped with the migration works either way and stays: with the old definitions the app again shows its per-reason
-- lines for ':self' and its one neutral line for every ':other' reason.
-- It stops, changing nothing, if any of the eight functions no longer has the definition the migration gave it (a later migration changed
-- it): a person needs to look first.
-- It refuses to run unless the session sets the confirmation first:
--     SET app.confirm_sec2b_oracle_followup_rollback = 'yes';
--     (or PGOPTIONS="-c app.confirm_sec2b_oracle_followup_rollback=yes")
BEGIN;
DO $guard$
DECLARE
  _want jsonb := '{"public.create_direct_conversation(uuid,text)": "1f2a487470a181e3115edabd02724107", "public.minor_messaging_block_me(uuid)": "6e0b822e983718277f8be21579edfc7a", "public.enforce_minor_messaging()": "3be7540efc3cba5559a5a7bc91fff27d", "public.player_activity_stats(uuid)": "fe1ee678e641edfac01e427c46ab03e4", "public.request_follow(uuid)": "f6d6e293192a8945d8e51189b8467e58", "public.host_attendance_stats(uuid)": "47121bdc9251be9f3ff3cafd98696b00", "public.player_trait_counts(uuid)": "49c1b3d08a6bd69468b1f41275b4a1ef", "private_sec.direct_message_refusal(uuid,uuid)": "37b99aea414a32f3e5f06ac1b1fa4391"}'::jsonb;
  _k text;
  _got text;
BEGIN
  IF current_setting('app.confirm_sec2b_oracle_followup_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets every signed-in account learn again whether anyone is a minor, their age band, their guardian''s messaging control, an adult''s full game history and review traits, and whether someone blocked them. Set app.confirm_sec2b_oracle_followup_rollback=yes for the session to proceed deliberately.';
  END IF;
  FOR _k IN SELECT jsonb_object_keys(_want) LOOP
    SELECT md5(pg_get_functiondef(p.oid)) INTO _got FROM pg_proc p WHERE p.oid = to_regprocedure(_k);
    IF _got IS DISTINCT FROM _want ->> _k THEN
      RAISE EXCEPTION 'Refusing to run: % is not the definition 20261113120000 created (md5 %, expected %). A later change needs a person to look first.', _k, _got, _want ->> _k;
    END IF;
  END LOOP;
END
$guard$;

SET LOCAL lock_timeout = '5s';

-- The definitions in force before the migration, unchanged.
CREATE OR REPLACE FUNCTION public.create_direct_conversation(_other_user uuid, _game_id text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _me uuid := auth.uid();
  _existing uuid;
  _new_id uuid;
  _mode text;
  _block text;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _me = _other_user THEN
    RAISE EXCEPTION 'Cannot message yourself';
  END IF;

  _block := public.minor_messaging_block(_me, _other_user);
  IF _block IS NOT NULL THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _block;
  END IF;

  SELECT cp1.conversation_id INTO _existing
  FROM public.conversation_participants cp1
  JOIN public.conversation_participants cp2
    ON cp1.conversation_id = cp2.conversation_id
  WHERE cp1.user_id = _me AND cp2.user_id = _other_user
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  _mode := COALESCE(public.privacy_text(_other_user, 'allow_messages'), 'everyone');
  IF _mode = 'nobody' THEN
    RAISE EXCEPTION 'This player is not accepting new messages.';
  ELSIF _mode = 'shared' AND NOT public.shares_game_or_chat(_me, _other_user) THEN
    RAISE EXCEPTION 'This player only accepts messages from people they share a game or chat with.';
  END IF;

  INSERT INTO public.conversations (created_by, game_id)
  VALUES (_me, _game_id)
  RETURNING id INTO _new_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (_new_id, _me), (_new_id, _other_user);

  RETURN _new_id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.minor_messaging_block_me(_other uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: minor_messaging_block_me needs a signed-in caller' USING ERRCODE = '42501';
  END IF;
  RETURN public.minor_messaging_block(auth.uid(), _other);
END $function$
;

CREATE OR REPLACE FUNCTION public.enforce_minor_messaging()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  other uuid;
  block text;
BEGIN
  FOR other IN
    SELECT user_id FROM public.conversation_participants
    WHERE conversation_id = NEW.conversation_id AND user_id <> NEW.sender_id
  LOOP
    block := public.minor_messaging_block(NEW.sender_id, other);
    IF block IS NOT NULL THEN
      RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', block;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.player_activity_stats(_user uuid)
 RETURNS TABLE(games_joined integer, games_attended integer, no_shows integer, games_completed integer, hosted_total integer, hosted_completed integer, hosted_cancelled integer, teams_count integer, review_count integer, review_avg numeric, verified_review_count integer, first_activity_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _trusted boolean := auth.uid() IS NULL;
  _adult boolean := COALESCE(public.age_cohort_of(_user) = 'adult', false);
BEGIN
  IF NOT (_adult OR _trusted OR public.is_self_or_guardian(_user)) THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0, 0, 0, 0, 0::numeric, 0, NULL::timestamptz;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT s.games_joined, s.games_attended, s.no_shows, s.games_completed, s.hosted_total,
         s.hosted_completed, s.hosted_cancelled, s.teams_count,
         CASE WHEN _adult OR _trusted THEN s.review_count ELSE 0 END,
         CASE WHEN _adult OR _trusted THEN s.review_avg ELSE 0::numeric END,
         CASE WHEN _adult OR _trusted THEN s.verified_review_count ELSE 0 END,
         s.first_activity_at
  FROM (
    WITH parts AS (
      SELECT gp.attended, g.completed_at, g.cancelled_at, g.date, gp.created_at
      FROM public.game_participants gp
      JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE gp.user_id = _user
    ),
    hosted AS (
      SELECT completed_at, cancelled_at, created_at FROM public.hosted_games WHERE host_id = _user
    ),
    revs AS (
      SELECT rating, verified FROM public.reviews
      WHERE reviewee_kind = 'player' AND reviewee_id = _user::text
        AND NOT flagged AND NOT is_private
        AND private_sec.review_is_publishable(id)
    )
    SELECT
      (SELECT count(*) FROM parts WHERE cancelled_at IS NULL)::int,
      (SELECT count(*) FROM parts WHERE attended IS TRUE AND cancelled_at IS NULL)::int,
      ((SELECT count(*) FROM parts WHERE attended IS FALSE AND cancelled_at IS NULL)
        + (SELECT count(*) FROM public.late_cancellations WHERE user_id = _user))::int,
      (SELECT count(*) FROM parts WHERE cancelled_at IS NULL AND completed_at IS NOT NULL)::int,
      (SELECT count(*) FROM hosted)::int,
      (SELECT count(*) FROM hosted WHERE completed_at IS NOT NULL AND cancelled_at IS NULL)::int,
      (SELECT count(*) FROM hosted WHERE cancelled_at IS NOT NULL)::int,
      (SELECT count(*) FROM public.team_members WHERE user_id = _user)::int,
      (SELECT count(*) FROM revs)::int,
      (SELECT coalesce(avg(rating), 0) FROM revs),
      (SELECT count(*) FROM revs WHERE verified)::int,
      least(
        (SELECT min(created_at) FROM parts),
        (SELECT min(created_at) FROM hosted)
      )
  ) AS s(games_joined, games_attended, no_shows, games_completed, hosted_total, hosted_completed,
         hosted_cancelled, teams_count, review_count, review_avg, verified_review_count,
         first_activity_at);
END
$function$
;

CREATE OR REPLACE FUNCTION public.request_follow(_target uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN';
  END IF;
  IF _target IS NULL OR _target = me
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target) THEN
    RAISE EXCEPTION 'INVALID_FOLLOW_TARGET';
  END IF;
  IF public.child_features_locked(me) THEN
    RAISE EXCEPTION 'FOLLOW_LOCKED';
  END IF;
  IF public.blocks_exist_between(me, _target) THEN
    RAISE EXCEPTION 'FOLLOW_BLOCKED';
  END IF;

  IF EXISTS (SELECT 1 FROM public.follows WHERE follower_id = me AND followee_id = _target) THEN
    RETURN 'following';
  END IF;

  IF public.follow_approval_required(_target) THEN
    INSERT INTO public.follow_requests (requester_id, target_id)
    VALUES (me, _target)
    ON CONFLICT DO NOTHING;
    RETURN 'requested';
  END IF;

  INSERT INTO public.follows (follower_id, followee_id)
  VALUES (me, _target)
  ON CONFLICT DO NOTHING;
  RETURN 'following';
END $function$
;

CREATE OR REPLACE FUNCTION public.host_attendance_stats(_host uuid)
 RETURNS TABLE(marked bigint, attended bigint, cancelled_games bigint, completed_games bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (auth.uid() IS NULL
          OR COALESCE(public.age_cohort_of(_host) = 'adult', false)
          OR public.is_self_or_guardian(_host)) THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.game_participants gp
       JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE g.host_id = _host AND gp.attended IS NOT NULL),
    (SELECT COUNT(*) FROM public.game_participants gp
       JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE g.host_id = _host AND gp.attended IS TRUE),
    (SELECT COUNT(*) FROM public.hosted_games WHERE host_id = _host AND cancelled_at IS NOT NULL),
    (SELECT COUNT(*) FROM public.hosted_games WHERE host_id = _host AND completed_at IS NOT NULL);
END
$function$
;

CREATE OR REPLACE FUNCTION public.player_trait_counts(_user uuid)
 RETURNS TABLE(respectful integer, communicative integer, fair_play integer, positive integer, on_time integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (auth.uid() IS NULL OR COALESCE(public.age_cohort_of(_user) = 'adult', false)) THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0;
    RETURN;
  END IF;

  -- Counts the AI-detected traits and the tags the reviewer picked; only reviews that may be published.
  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE 'respectful' = ANY (a.traits) OR 'respectful' = ANY (r.tags))::int,
    count(*) FILTER (WHERE 'communicative' = ANY (a.traits) OR 'communicative' = ANY (r.tags))::int,
    count(*) FILTER (WHERE 'fairPlay' = ANY (a.traits) OR 'fairPlay' = ANY (r.tags))::int,
    count(*) FILTER (WHERE 'positive' = ANY (a.traits) OR 'positive' = ANY (r.tags))::int,
    count(*) FILTER (WHERE 'onTime' = ANY (a.traits) OR 'onTime' = ANY (r.tags))::int
  FROM public.reviews r
  LEFT JOIN public.review_ai_analysis a ON a.review_id = r.id
  WHERE r.reviewee_kind = 'player' AND r.reviewee_id = _user::text
    AND NOT r.flagged AND NOT r.is_private AND NOT COALESCE(a.mismatch, false)
    AND private_sec.review_is_publishable(r.id);
END
$function$
;

-- minor_messaging_block_me was callable by signed-in accounts before the migration.
GRANT EXECUTE ON FUNCTION public.minor_messaging_block_me(uuid) TO authenticated;

-- Nothing calls it any more.
DROP FUNCTION private_sec.direct_message_refusal(uuid, uuid);

COMMIT;
