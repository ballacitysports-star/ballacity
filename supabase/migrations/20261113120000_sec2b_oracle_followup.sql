-- SEC-2b: six more SECURITY DEFINER functions stop being oracles about other people (follow-up to 20261112150000_helper_oracle_containment).
--
-- WHY. SEC-2 gave fixed answers to the 26 helper predicates when a signed-in client asks about someone else. Six functions that call the same
-- logic with definer rights still answered a signed-in stranger with details row security hides from them (verified on a replay of main
-- d612af26, 2026-11-13):
--   * create_direct_conversation raised 'MINOR_MESSAGING_BLOCKED:<reason>:other' naming the target's age band (child_needs_guardian = under 13,
--     teen_needs_shared_game = 13-15) or their guardian's messaging control (messaging_off / guardian_only / teammates_only), and two different
--     sentences for the target's allow_messages setting ('nobody' vs 'shared');
--   * minor_messaging_block_me returned the same reasons as a value, with no side effect at all;
--   * player_activity_stats gave anyone the full activity of an adult (private and hidden games, late cancellations, hidden teams) and a
--     constant zero row for anyone else, which says "not a confirmed adult";
--   * request_follow told a missing account (INVALID_FOLLOW_TARGET) from a block in either direction (FOLLOW_BLOCKED), and answered
--     'requested' / 'following' (= minor or not) about accounts the caller cannot see;
--   * host_attendance_stats counted an adult host's private and hidden games for anyone, even when the host's profile is private;
--   * player_trait_counts (the sibling of player_activity_stats) gave anyone an adult's review traits, AI-derived ones included, and zeros
--     for anyone else ("not a confirmed adult").
--
-- WHAT THIS DOES (each change only narrows what a caller learns or can do; the migration itself writes no row):
--   * Messaging. Every refusal that is about the OTHER person now has one text: 'MINOR_MESSAGING_BLOCKED:recipient_restricted:other'. That
--     covers all ':other' minor rules AND the target's allow_messages setting ('nobody', or 'shared' without a shared game or chat), so a refusal
--     no longer separates an under-13, a 13-15, a guardian's control or an adult's own privacy choice. Refusals about the CALLER (':self') are
--     unchanged: they describe the caller's own account. The prefix keeps its old name so builds of the app that predate this still recognise
--     a refusal. The rules themselves (public.minor_messaging_block) are untouched, and so is who may message whom.
--       - create_direct_conversation and minor_messaging_block_me share one check, private_sec.direct_message_refusal, in the order the RPC
--         always used (minor rules, then an existing conversation, then allow_messages). minor_messaging_block_me therefore answers exactly what
--         create_direct_conversation would do, and nothing more.
--       - The send-time trigger enforce_minor_messaging collapses ':other' the same way.
--   * minor_messaging_block_me is no longer callable by signed-in accounts (service role only). Nothing in the app calls it, and for a minor
--     caller it was the side-effect-free way to sort ids into adults and non-adults: an under-13 or unguarded 13-15 gets a ':self' code only
--     when the other person is an adult. create_direct_conversation stays the one, enforced, way to ask.
--   * player_activity_stats: the gate depends only on who is asking: the service role (no auth.uid()), the person themselves or their verified
--     guardian. Everyone else gets the same zero row for every target, adult or not. The app only asks about the signed-in user. Review numbers
--     for a minor stay zero even for themselves and their guardian, as before.
--   * player_trait_counts (its sibling, called by the app right after it with the same id): the same caller-only gate. Zeros for everyone
--     else, and still zeros for a minor even for themselves and their guardian; the service role reads any account, as before.
--   * request_follow: the caller's own lock (FOLLOW_LOCKED) is checked first. Then one error, INVALID_FOLLOW_TARGET, for a missing account,
--     yourself, or a block in either direction; FOLLOW_BLOCKED is no longer raised. An account whose profile the caller cannot see (profiles
--     row security shows only 'public' and 'members' profiles) is never followed at once: request_follow files a request and answers
--     'requested', whatever the account's age or settings, so the answer no longer says minor-or-not. A visible account is followed or asked
--     exactly as before. NOTE: 'private' is not a rare setting. handle_new_user stores default_profile_visibility_for(NEW.id) at sign-up,
--     before any birthday exists, so every account starts 'private' and stays so until the person changes it (the cohort re-clamp only ever
--     lowers visibility). Such adults can still be followed: they now approve a request (they are notified, /account/follow-requests).
--   * host_attendance_stats: the host themselves, their guardian and the service role get the full numbers, as before. Anyone else gets an
--     adult host's numbers counted only from the host's public, unhidden games (the ones anyone can list), whatever the host's profile
--     visibility, so the attendance line stays on game pages of default-'private' adult hosts. A minor host's numbers stay zero for others.
--
-- WHAT STAYS (accepted residuals, stated so nobody relies on more):
--   * Blocks. Success-or-refusal still carries one bit. request_follow refuses a visible, existing profile only for a block, so a refusal there
--     tells the caller that a block stands (they know whether they blocked). Before this file the error named it (FOLLOW_BLOCKED); now it
--     reads like a missing account, but the bit remains. Closing it would mean hiding a blocker's profile from the person they blocked.
--   * Minor callers. create_direct_conversation still refuses an under-13 or an unguarded 13-15 with their own ':self' code only when the
--     other person is an adult (for a 13-15: an adult they share no game with), and otherwise succeeds (opening a conversation) or gives the
--     neutral code, so a minor can still learn adult-or-not one conversation attempt at a time. That is the minor-safety rule working; it is
--     not loosened.
--   * Minor hosts. host_attendance_stats returns zeros to others for a minor host and numbers for an adult host with public, marked games,
--     so non-zero numbers still mean "adult host". Showing a minor host's numbers would loosen a minor-safety rule, so this stays.
--
-- APP FIRST. The app in this commit shows one neutral line ("This player can't receive messages from you right now.") for
-- 'recipient_restricted', and no longer claims the person is a child in the "message their guardian instead" dialog. It works before and
-- after this file. An older build shows its generic safety-settings line for the new code.
--
-- Rollback: docs/rollbacks/20261113120000_sec2b_oracle_followup.down.sql (guarded).

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- Messaging
-- ---------------------------------------------------------------------------------------------------------------------------------------------

-- Why _me may not open a new direct conversation with _other, as the caller is allowed to know it: NULL (allowed), a '<rule>:self' code about
-- _me's own account, or 'recipient_restricted:other' for every reason that is about _other. Internal: not callable through the API.
CREATE OR REPLACE FUNCTION private_sec.direct_message_refusal(_me uuid, _other uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _block text;
  _mode text;
BEGIN
  _block := public.minor_messaging_block(_me, _other);
  IF _block IS NOT NULL THEN
    RETURN CASE WHEN _block LIKE '%:self' THEN _block ELSE 'recipient_restricted:other' END;
  END IF;

  -- An existing conversation is reopened whatever the other person's allow_messages says (the send-time trigger still applies the minor rules).
  IF EXISTS (
    SELECT 1
    FROM public.conversation_participants cp1
    JOIN public.conversation_participants cp2 ON cp1.conversation_id = cp2.conversation_id
    WHERE cp1.user_id = _me AND cp2.user_id = _other
  ) THEN
    RETURN NULL;
  END IF;

  _mode := COALESCE(public.privacy_text(_other, 'allow_messages'), 'everyone');
  IF _mode = 'nobody' OR (_mode = 'shared' AND NOT public.shares_game_or_chat(_me, _other)) THEN
    RETURN 'recipient_restricted:other';
  END IF;
  RETURN NULL;
END;
$function$;
REVOKE ALL ON FUNCTION private_sec.direct_message_refusal(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private_sec.direct_message_refusal(uuid, uuid) TO service_role;

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
  _refusal text;
BEGIN
  IF _me IS NULL THEN
    RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000';
  END IF;
  IF _me = _other_user THEN
    RAISE EXCEPTION 'Cannot message yourself';
  END IF;

  -- One text for every refusal about the other person (SEC-2b); ':self' codes describe the caller's own account.
  _refusal := private_sec.direct_message_refusal(_me, _other_user);
  IF _refusal IS NOT NULL THEN
    RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%', _refusal;
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

  INSERT INTO public.conversations (created_by, game_id)
  VALUES (_me, _game_id)
  RETURNING id INTO _new_id;

  INSERT INTO public.conversation_participants (conversation_id, user_id)
  VALUES (_new_id, _me), (_new_id, _other_user);

  RETURN _new_id;
END;
$function$;

-- What create_direct_conversation would say, without opening anything: NULL, a ':self' code, or 'recipient_restricted:other'. No longer callable
-- by signed-in accounts (below): nothing in the app calls it, and for a minor caller a ':self' answer still says the other person is an adult.
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
  RETURN private_sec.direct_message_refusal(auth.uid(), _other);
END $function$;
-- Closed to the API: create_direct_conversation stays the one, enforced, way to ask. The service role keeps it (anonymous visitors never had it).
REVOKE EXECUTE ON FUNCTION public.minor_messaging_block_me(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minor_messaging_block_me(uuid) TO service_role;

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
      -- ':self' codes are about the sender; anything about the other person is one neutral code (SEC-2b).
      RAISE EXCEPTION 'MINOR_MESSAGING_BLOCKED:%',
        CASE WHEN block LIKE '%:self' THEN block ELSE 'recipient_restricted:other' END;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- player_activity_stats: only the person, their verified guardian and the service role
-- ---------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.player_activity_stats(_user uuid)
 RETURNS TABLE(games_joined integer, games_attended integer, no_shows integer, games_completed integer, hosted_total integer, hosted_completed integer, hosted_cancelled integer, teams_count integer, review_count integer, review_avg numeric, verified_review_count integer, first_activity_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _trusted boolean := auth.uid() IS NULL;
  _adult boolean;
BEGIN
  -- Who is asking decides, never the target's age (SEC-2b): everyone else gets the same zero row for every target.
  IF NOT (_trusted OR public.is_self_or_guardian(_user)) THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0, 0, 0, 0, 0::numeric, 0, NULL::timestamptz;
    RETURN;
  END IF;
  -- The caller is the person, their guardian or the server: review numbers stay hidden for a minor, as before.
  _adult := COALESCE(public.age_cohort_of(_user) = 'adult', false);

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
$function$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- request_follow: one neutral error for a missing or blocked target; an account the caller cannot see can only be asked
-- ---------------------------------------------------------------------------------------------------------------------------------------------
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
  -- About the caller only, so it may come first.
  IF public.child_features_locked(me) THEN
    RAISE EXCEPTION 'FOLLOW_LOCKED';
  END IF;
  -- One answer for a target that does not exist or is blocked in either direction (SEC-2b; FOLLOW_BLOCKED is no longer raised).
  IF _target IS NULL OR _target = me
     OR NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = _target)
     OR public.blocks_exist_between(me, _target) THEN
    RAISE EXCEPTION 'INVALID_FOLLOW_TARGET';
  END IF;

  IF EXISTS (SELECT 1 FROM public.follows WHERE follower_id = me AND followee_id = _target) THEN
    RETURN 'following';
  END IF;

  -- A profile the caller cannot see (row security shows only 'public' and 'members' profiles) is never followed at once: it is always asked,
  -- whatever its age or settings, so 'requested' says nothing about who it is (SEC-2b). Otherwise as before: approval when the account needs it.
  IF private_sec.profile_visibility_of(_target) NOT IN ('public', 'members')
     OR public.follow_approval_required(_target) THEN
    INSERT INTO public.follow_requests (requester_id, target_id)
    VALUES (me, _target)
    ON CONFLICT DO NOTHING;
    RETURN 'requested';
  END IF;

  INSERT INTO public.follows (follower_id, followee_id)
  VALUES (me, _target)
  ON CONFLICT DO NOTHING;
  RETURN 'following';
END $function$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- host_attendance_stats: others see only what the host's public, unhidden games add up to
-- ---------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.host_attendance_stats(_host uuid)
 RETURNS TABLE(marked bigint, attended bigint, cancelled_games bigint, completed_games bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  -- The host, their guardian and the server see every game; anyone else only public, unhidden ones (SEC-2b).
  _full boolean := auth.uid() IS NULL OR public.is_self_or_guardian(_host);
BEGIN
  -- Unchanged: a minor host's numbers stay with the host, their guardian and the server.
  IF NOT (_full OR COALESCE(public.age_cohort_of(_host) = 'adult', false)) THEN
    RETURN QUERY SELECT 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    (SELECT COUNT(*) FROM public.game_participants gp
       JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE g.host_id = _host AND gp.attended IS NOT NULL
        AND (_full OR (g.is_private = false AND g.hidden_at IS NULL))),
    (SELECT COUNT(*) FROM public.game_participants gp
       JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE g.host_id = _host AND gp.attended IS TRUE
        AND (_full OR (g.is_private = false AND g.hidden_at IS NULL))),
    (SELECT COUNT(*) FROM public.hosted_games g
      WHERE g.host_id = _host AND g.cancelled_at IS NOT NULL
        AND (_full OR (g.is_private = false AND g.hidden_at IS NULL))),
    (SELECT COUNT(*) FROM public.hosted_games g
      WHERE g.host_id = _host AND g.completed_at IS NOT NULL
        AND (_full OR (g.is_private = false AND g.hidden_at IS NULL)));
END
$function$;

-- ---------------------------------------------------------------------------------------------------------------------------------------------
-- player_trait_counts: like player_activity_stats, only the person, their verified guardian and the service role
-- ---------------------------------------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.player_trait_counts(_user uuid)
 RETURNS TABLE(respectful integer, communicative integer, fair_play integer, positive integer, on_time integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Who is asking decides (SEC-2b): everyone else gets zeros for every target. For the person and their guardian the counts stay zero for a
  -- minor, as before; the server reads them for anyone.
  IF NOT (auth.uid() IS NULL
          OR (public.is_self_or_guardian(_user) AND COALESCE(public.age_cohort_of(_user) = 'adult', false))) THEN
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
$function$;
