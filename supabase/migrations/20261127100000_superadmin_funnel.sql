-- WP 5.2 (Phase 5, docs/product/phase-5-validation-plan.md): the pilot funnel, counted on the server, totals only.
--
-- WHY. The pilot measures one funnel, post availability -> invited -> joined -> showed up, from tables that already exist. The
-- SuperAdmin Overview shows all-time row counts only. This adds a weekly funnel a superadmin can read, with no client tracking,
-- no identifiers and no per-person rows.
--
-- WHAT.
-- 1. public.superadmin_funnel(_from date, _to date) -> jsonb. SECURITY DEFINER, search_path ''. It checks is_superadmin itself
--    (as payment_health_metrics does) and writes nothing. One row per week, Monday to Sunday in America/New_York (the pilot
--    city's time). Whole weeks only: _from moves back to its Monday and _to on to its Sunday, so two answers never differ by
--    part of a week (subtracting them would give a single day's count, unmasked). Only the current week stops at today, and
--    it grows only as time passes. Defaults: the 8 weeks up to today; at most 26 weeks; never past today. Days before the
--    pilot start (app_settings 'funnel_pilot_start', {"date": "YYYY-MM-DD"}) are left out: a start that is not a Monday
--    counts from the next Monday, so the first week is whole too.
-- 2. Who is counted ("pilot users", plan decision 5): every account except *@lovable.test (auth.users.email) and staff (any
--    user_roles row). Adults only: profiles.age_cohort = 'adult' and no age review pending (the same gate as
--    src/components/AnalyticsHost.tsx). Accounts that are not confirmed adults (minors, unknown age, review pending) are not
--    computed at all unless the under-18 switch (3.) is on. Nothing they do moves an adult number either: an adult invite or
--    self-join counts only in a game whose host is a confirmed adult, and only a player of the same group makes a series
--    copy "held". One host rule for every step that reads a game: a game hosted by a test or staff account counts nowhere
--    (no invite, join or self-join in it, and it is not held), as its host is not a pilot user.
-- 3. The under-18 switch, app_settings 'funnel_minor_counts' ({"enabled": false}, not public). Counsel must sign off on counting
--    minors in product metrics first (pilot checklist B1). Only public.superadmin_set_funnel_minor_counts(_enabled, _reason)
--    changes it: a superadmin, a reason (at least 20 characters to turn it on: name the counsel sign-off), and an admin_audit_log
--    row for every change. A trigger on app_settings refuses any other write that would turn it on (the Ops raw editor, server
--    code, the SQL editor), so turning it on is always that recorded act. Off, superadmin_funnel neither computes nor returns
--    any number about those accounts; on, each week also carries one combined column, not_confirmed_adult.
-- 4. Masking: every count from 1 to 4 leaves the database as the string "<5" (maskSmallCount's threshold,
--    src/lib/sport-activity.ts); 0 stays 0. The two rates are computed here from the raw counts and returned only when both
--    counts are 0 or at least 5, so a rate never reveals a masked count.
--
-- THE STEPS (adults; per week). Posts are attributed to the person's first post day in the week; invites to their creation
-- day; games to their start day. Week = date_trunc('week') of the America/New_York date.
--   posters               distinct player_availabilities.user_id with a post created in the week (hidden_at IS NULL).
--   posters_invited       those posters with a game_invites row (invitee_id = user_id; the user, not availability_id, which a
--                         deleted post sets NULL) created between their first post of the week and 7 days after their last.
--   posters_self_joined   secondary line, approximate: those posters who got a place in the same window by their own request
--                         (a game_participants row, or an approved join_requests row whose idempotency_key is not 'invite:...'),
--                         in a game they had not accepted an invitation to and do not host, under the same host rule as invites.
--   invites_sent          game_invites created in the week. Out of scope: before 2026-11-18 03:34 UTC (the table went live),
--                         games with hidden_at set, games hosted by a *@lovable.test or staff account, invitees outside the group,
--                         and for adults, games whose host is not a confirmed adult (a minor hosting under a team).
--   invites_seen          the invitee's 'game_invite' notification whose link carries inv=<invite id> has read_at set, or the
--                         invite was answered (answering from the game page leaves the notification unread).
--   invites_answered      responded_at is set (accepted, declined, or an accept that found the game closed: 'expired').
--   invites_accepted      status = 'accepted'.
--   invites_joined        the invitee has a game_participants row in that game (never the host's own row) or an approved
--                         join_requests row (game_respond_invite approves the request; a free game's roster row is written
--                         later by the browser, so an approved request without a row counts). One place is credited to one
--                         invite: of a person's invites to one game (a host can cancel and invite again, or invite again
--                         after a decline) only the deciding one counts here and in every later step, the accepted one,
--                         else the latest, and only while it is pending or accepted (a declined invite is not "joined"
--                         when the player later joins on their own). The other invites still count as sent, seen, answered.
--   invites_game_started  joined, the game's date has passed, and it is not cancelled (cancelled_at or status 'cancelled').
--   invites_attendance_marked  of those, game_participants.attended is not NULL (host_mark_attendance).
--   invites_showed_up     of those, attended = true.
--   invites_late_leaves   a late_cancellations row (kind 'game', ref_id = game, user_id = invitee), for the deciding invite.
--   invites_game_cancelled  joined, then the game was cancelled (reported apart from step 7).
--   invites_to_series_games invites to games with a series_id (a subset of invites_sent).
--   games_held            games started in the week, not cancelled, hosted by someone in the group; a series game with no
--                         player other than the host is left out (an automatic copy nobody joined). A player is someone in
--                         the same group with a roster row or an approved request (as for invites_joined).
--   games_held_series     the series games among games_held.
--   games_cancelled       cancelled games of the week (empty series games left out here too).
--   series_games_left_out series games of the week with no player other than the host.
--   marked_coverage_pct   invites_attendance_marked / invites_game_started; show_up_rate_pct = invites_showed_up /
--                         invites_attendance_marked.
--
-- HISTORY. When private_sec.funnel_daily exists (WP 5.3, 20261127110000) the weeks before the frozen line
-- (private_sec.funnel_frozen_before: the Monday of the week holding today - 21 days) are read from it when it holds all seven
-- days of the week; later weeks, and frozen weeks it holds only part of, are computed live and whole. A week is never part
-- history and part live, so nobody is counted twice in it. The not_confirmed_adult column is always live (the history stores
-- adults only).
--
-- WINDOW. _from and _to must be real dates: +/-infinity is refused (INVALID_WINDOW), as '-infinity' passed every clamp and
-- generate_series over it never ends.
--
-- COST. Every step is a join or a keyed lookup, none a scan per row. Measured on a scratch replay with 20k users, 40k posts over
-- 26 weeks, 10k games, 30k invites, 20k roster rows, 20k approved requests and 200k notifications: the default 8 weeks in
-- 1.3-1.6 s, 26 weeks with the under-18 column in 1.5-2.2 s (JIT off / on), under the API's 8 s statement timeout. Before
-- posters_invited became a join it took 18.7 s and 51 s.
--
-- Nothing here changes a row other than the two new app_settings rows, or who can read anything.
--
-- Rollback: docs/rollbacks/20261127100000_superadmin_funnel.down.sql.

SET lock_timeout = '5s';

-- 1. Settings ------------------------------------------------------------------------------------------------------------------------
INSERT INTO public.app_settings (key, value, description, is_public)
VALUES
  ('funnel_minor_counts', '{"enabled": false}'::jsonb,
   'Funnel card: compute the under-18 / unknown-age column. Off until counsel signs off on counting minors (pilot checklist B1). '
   'Changed only from the Funnel card (superadmin_set_funnel_minor_counts), which records who and why.', false),
  ('funnel_pilot_start', '{"date": null}'::jsonb,
   'Funnel card: first day counted, as {"date": "YYYY-MM-DD"} in America/New_York. Earlier days are left out. Use a Monday.', false)
ON CONFLICT (key) DO NOTHING;

-- Whether the under-18 column is on. Anything but {"enabled": true} is off.
CREATE OR REPLACE FUNCTION private_sec.funnel_minor_counts_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT s.value -> 'enabled' = 'true'::jsonb FROM public.app_settings s WHERE s.key = 'funnel_minor_counts'), false)
$$;
REVOKE ALL ON FUNCTION private_sec.funnel_minor_counts_enabled() FROM PUBLIC, anon, authenticated, service_role;

-- The pilot start date, or NULL when unset or not a date.
CREATE OR REPLACE FUNCTION private_sec.funnel_pilot_start()
RETURNS date
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  _v text;
BEGIN
  SELECT s.value ->> 'date' INTO _v FROM public.app_settings s WHERE s.key = 'funnel_pilot_start';
  IF _v IS NULL OR _v !~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN NULL;
  END IF;
  RETURN _v::date;
EXCEPTION WHEN others THEN
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION private_sec.funnel_pilot_start() FROM PUBLIC, anon, authenticated, service_role;

-- A write that would turn the under-18 column on must come from superadmin_set_funnel_minor_counts. The reader above and this
-- check use the same test, so nothing the reader takes for "on" gets past it. Turning it off, or deleting the row, is allowed
-- from anywhere: off is the safe side. The row is never public.
CREATE OR REPLACE FUNCTION private_sec.guard_funnel_minor_counts()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.key = 'funnel_minor_counts' THEN
    IF COALESCE(NEW.value -> 'enabled' = 'true'::jsonb, false)
       AND COALESCE(current_setting('app.funnel_minor_counts_rpc', true), '') <> 'on' THEN
      RAISE EXCEPTION 'FUNNEL_MINOR_COUNTS_LOCKED: the under-18 funnel column is turned on only from the Funnel card.'
        USING ERRCODE = '42501';
    END IF;
    NEW.is_public := false;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private_sec.guard_funnel_minor_counts() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS a0_app_settings_funnel_minor_counts_guard ON public.app_settings;
CREATE TRIGGER a0_app_settings_funnel_minor_counts_guard
  BEFORE INSERT OR UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION private_sec.guard_funnel_minor_counts();

-- The recorded act: a superadmin, a reason, an audit row.
CREATE OR REPLACE FUNCTION public.superadmin_set_funnel_minor_counts(_enabled boolean, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  _me     uuid := auth.uid();
  _why    text := btrim(COALESCE(_reason, ''));
  _before jsonb;
  _after  jsonb;
BEGIN
  IF _me IS NULL OR NOT COALESCE(private_sec.is_superadmin(_me), false) THEN
    RAISE EXCEPTION 'SUPERADMIN_ONLY' USING ERRCODE = '42501';
  END IF;
  _enabled := COALESCE(_enabled, false);   -- no answer is off, the safe side
  IF length(_why) < (CASE WHEN _enabled THEN 20 ELSE 3 END) OR length(_why) > 500 THEN
    RAISE EXCEPTION 'FUNNEL_MINOR_COUNTS_REASON_REQUIRED: say why, and to turn it on name the counsel sign-off (at least 20 characters).'
      USING ERRCODE = '22023';
  END IF;

  SELECT s.value INTO _before FROM public.app_settings s WHERE s.key = 'funnel_minor_counts' FOR UPDATE;
  _after := jsonb_build_object('enabled', _enabled, 'changed_at', now());

  PERFORM set_config('app.funnel_minor_counts_rpc', 'on', true);
  INSERT INTO public.app_settings (key, value, description, is_public, updated_by)
  VALUES ('funnel_minor_counts', _after,
          'Funnel card: compute the under-18 / unknown-age column. Off until counsel signs off on counting minors (pilot checklist B1). '
          'Changed only from the Funnel card (superadmin_set_funnel_minor_counts), which records who and why.', false, _me)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by;
  -- The flag is only for the write above; nothing later in this transaction may reuse it.
  PERFORM set_config('app.funnel_minor_counts_rpc', 'off', true);

  INSERT INTO public.admin_audit_log (actor_id, action, target_type, target_id, reason, before, after, metadata)
  VALUES (_me, 'feature_flag.update', 'app_setting', 'funnel_minor_counts', _why, _before, _after,
          jsonb_build_object('key', 'funnel_minor_counts', 'isPublic', false, 'via', 'superadmin_set_funnel_minor_counts'));

  RETURN jsonb_build_object('enabled', _enabled);
END $$;
REVOKE ALL ON FUNCTION public.superadmin_set_funnel_minor_counts(boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_set_funnel_minor_counts(boolean, text) TO authenticated;
COMMENT ON FUNCTION public.superadmin_set_funnel_minor_counts(boolean, text) IS
  'WP 5.2: turns the funnel''s under-18 / unknown-age column on or off. Superadmin only, with a reason; every change is audited.';

-- 2. The counting ------------------------------------------------------------------------------------------------------------------
-- Every day before the returned Monday is frozen: the Monday of the week holding today - 21 days (America/New_York). Whole
-- weeks freeze together, so a week is read either all from history or all live and a person is never counted twice in a week.
CREATE OR REPLACE FUNCTION private_sec.funnel_frozen_before(_now timestamptz)
RETURNS date
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT date_trunc('week', ((_now AT TIME ZONE 'America/New_York')::date - 21)::timestamp)::date
$$;
REVOKE ALL ON FUNCTION private_sec.funnel_frozen_before(timestamptz) FROM PUBLIC, anon, authenticated, service_role;

-- Raw daily counts for one group (adults, or everyone who is not a confirmed adult), for each day from _from to _to
-- (America/New_York dates), as of _now. Counts only: no identifier leaves this function. Internal: callers mask.
CREATE OR REPLACE FUNCTION private_sec.funnel_day_metrics(_from date, _to date, _now timestamptz, _adults boolean)
RETURNS TABLE (day date, metrics jsonb)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH
  b AS (
    SELECT (_from::timestamp AT TIME ZONE 'America/New_York') AS from_at,
           (date_trunc('week', _from::timestamp) AT TIME ZONE 'America/New_York') AS week_from_at,
           ((_to + 1)::timestamp AT TIME ZONE 'America/New_York') AS to_at
  ),
  people AS (
    SELECT u.id AS user_id
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
     WHERE lower(split_part(COALESCE(u.email, ''), '@', 2)) <> 'lovable.test'   -- *@lovable.test: the e2e accounts
       AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id)
       AND COALESCE(p.age_cohort = 'adult' AND NOT p.age_review_required, false) = _adults
  ),
  -- Whose games count, the one host rule every step that reads a game applies: never a test or staff account, and for
  -- adults only a confirmed adult, so a minor's hosting never moves an adult number. (games_held reads the host from
  -- `people`, which is this rule for adults.) NOT MATERIALIZED: each use becomes key lookups on the host, not a scan.
  hosts AS NOT MATERIALIZED (
    SELECT u.id AS user_id
      FROM auth.users u
      LEFT JOIN public.profiles p ON p.id = u.id
     WHERE lower(split_part(COALESCE(u.email, ''), '@', 2)) <> 'lovable.test'
       AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id)
       AND (NOT _adults OR COALESCE(p.age_cohort = 'adult' AND NOT p.age_review_required, false))
  ),
  inv AS (
    SELECT i.id, i.game_id, i.invitee_id, i.status, i.responded_at, i.created_at,
           g.host_id, g.date AS game_date, g.series_id IS NOT NULL AS series,
           (g.cancelled_at IS NOT NULL OR COALESCE(g.status, '') = 'cancelled') AS game_cancelled
      FROM public.game_invites i
      JOIN public.hosted_games g ON g.id = i.game_id
      JOIN hosts h ON h.user_id = g.host_id
      JOIN people pe ON pe.user_id = i.invitee_id
     CROSS JOIN b
     WHERE i.created_at >= timestamptz '2026-11-18 03:34:00+00'
       AND i.created_at >= b.week_from_at AND i.created_at < b.to_at + interval '7 days' AND i.created_at <= _now
       AND g.hidden_at IS NULL
  ),
  -- Of a person's invites to one game, the one credited with what followed: the accepted one, else the latest.
  decider AS (
    SELECT DISTINCT ON (gi.game_id, gi.invitee_id) gi.id
      FROM public.game_invites gi
     WHERE EXISTS (SELECT 1 FROM inv i WHERE i.game_id = gi.game_id AND i.invitee_id = gi.invitee_id)
       AND gi.created_at >= timestamptz '2026-11-18 03:34:00+00' AND gi.created_at <= _now
     ORDER BY gi.game_id, gi.invitee_id, (gi.status = 'accepted') DESC, gi.created_at DESC, gi.id
  ),
  inv_facts AS (
    SELECT (i.created_at AT TIME ZONE 'America/New_York')::date AS on_day,
           i.series, i.game_cancelled,
           COALESCE(i.responded_at <= _now, false) AS answered,
           COALESCE(i.status = 'accepted' AND i.responded_at <= _now, false) AS accepted,
           i.status IN ('pending', 'accepted') AND i.id IN (SELECT d.id FROM decider d) AS credited,
           COALESCE(i.responded_at <= _now, false)
             OR EXISTS (SELECT 1 FROM public.notifications n
                         WHERE n.user_id = i.invitee_id AND n.type = 'game_invite'
                           AND n.read_at IS NOT NULL AND n.read_at <= _now
                           AND strpos(COALESCE(n.link, ''), 'inv=' || i.id::text) > 0) AS seen,
           gp.id IS NOT NULL AS on_roster,
           gp.attended,
           EXISTS (SELECT 1 FROM public.join_requests jr
                    WHERE jr.game_id = i.game_id AND jr.player_id = i.invitee_id AND jr.status = 'approved') AS approved,
           i.game_date <= _now AS game_due,
           EXISTS (SELECT 1 FROM public.late_cancellations lc
                    WHERE lc.kind = 'game' AND lc.ref_id = i.game_id AND lc.user_id = i.invitee_id) AS late_leave
      FROM inv i
     CROSS JOIN b
      LEFT JOIN public.game_participants gp
        ON gp.game_id = i.game_id AND gp.user_id = i.invitee_id AND gp.user_id <> i.host_id
     WHERE i.created_at >= b.from_at AND i.created_at < b.to_at
  ),
  inv_steps AS (
    SELECT f.*, f.credited AND (f.on_roster OR f.approved) AS joined,
           f.credited AND (f.on_roster OR f.approved) AND f.game_due AND NOT f.game_cancelled AS started
      FROM inv_facts f
  ),
  inv_day AS (
    SELECT s.on_day,
           count(*) AS invites_sent,
           count(*) FILTER (WHERE s.seen) AS invites_seen,
           count(*) FILTER (WHERE s.answered) AS invites_answered,
           count(*) FILTER (WHERE s.accepted) AS invites_accepted,
           count(*) FILTER (WHERE s.joined) AS invites_joined,
           count(*) FILTER (WHERE s.started) AS invites_game_started,
           count(*) FILTER (WHERE s.started AND s.on_roster AND s.attended IS NOT NULL) AS invites_attendance_marked,
           count(*) FILTER (WHERE s.started AND s.on_roster AND s.attended IS TRUE) AS invites_showed_up,
           count(*) FILTER (WHERE s.credited AND s.late_leave) AS invites_late_leaves,
           count(*) FILTER (WHERE s.joined AND s.game_cancelled) AS invites_game_cancelled,
           count(*) FILTER (WHERE s.series) AS invites_to_series_games
      FROM inv_steps s
     GROUP BY s.on_day
  ),
  posts AS (
    SELECT a.user_id, a.created_at
      FROM public.player_availabilities a
      JOIN people pe ON pe.user_id = a.user_id
     CROSS JOIN b
     WHERE a.hidden_at IS NULL
       AND a.created_at >= b.week_from_at AND a.created_at < b.to_at AND a.created_at <= _now
  ),
  poster_weeks AS (
    SELECT p.user_id, date_trunc('week', p.created_at AT TIME ZONE 'America/New_York') AS wk,
           min(p.created_at) AS first_at, max(p.created_at) AS last_at
      FROM posts p
     GROUP BY 1, 2
  ),
  -- Posters invited, as one join on the person. (An EXISTS over `inv` per poster rescanned every invite of the window for
  -- each poster: posters x invites, 18 s for 8 weeks at 11k poster-weeks and 30k invites.)
  poster_invited AS (
    SELECT DISTINCT pw.user_id, pw.wk
      FROM poster_weeks pw
      JOIN inv i ON i.invitee_id = pw.user_id
     WHERE i.created_at >= pw.first_at AND i.created_at < pw.last_at + interval '7 days'
  ),
  poster_steps AS (
    SELECT (pw.first_at AT TIME ZONE 'America/New_York')::date AS on_day,
           pi.user_id IS NOT NULL AS invited,
           EXISTS (SELECT 1 FROM public.game_participants gp
                     JOIN public.hosted_games g ON g.id = gp.game_id
                    WHERE gp.user_id = pw.user_id AND g.host_id <> pw.user_id AND g.hidden_at IS NULL
                      AND EXISTS (SELECT 1 FROM hosts h WHERE h.user_id = g.host_id)
                      AND gp.created_at >= pw.first_at AND gp.created_at < pw.last_at + interval '7 days' AND gp.created_at <= _now
                      AND NOT EXISTS (SELECT 1 FROM public.game_invites gi
                                       WHERE gi.game_id = gp.game_id AND gi.invitee_id = gp.user_id AND gi.status = 'accepted'))
           OR EXISTS (SELECT 1 FROM public.join_requests jr
                        JOIN public.hosted_games g ON g.id = jr.game_id
                       WHERE jr.player_id = pw.user_id AND jr.status = 'approved' AND g.host_id <> pw.user_id AND g.hidden_at IS NULL
                         AND EXISTS (SELECT 1 FROM hosts h WHERE h.user_id = g.host_id)
                         AND jr.idempotency_key NOT LIKE 'invite:%'
                         AND jr.created_at >= pw.first_at AND jr.created_at < pw.last_at + interval '7 days' AND jr.created_at <= _now
                         AND NOT EXISTS (SELECT 1 FROM public.game_invites gi
                                          WHERE gi.game_id = jr.game_id AND gi.invitee_id = jr.player_id AND gi.status = 'accepted'))
             AS self_joined
      FROM poster_weeks pw
      LEFT JOIN poster_invited pi ON pi.user_id = pw.user_id AND pi.wk = pw.wk
     CROSS JOIN b
     WHERE pw.first_at >= b.from_at
  ),
  poster_day AS (
    SELECT s.on_day,
           count(*) AS posters,
           count(*) FILTER (WHERE s.invited) AS posters_invited,
           count(*) FILTER (WHERE s.self_joined) AS posters_self_joined
      FROM poster_steps s
     GROUP BY s.on_day
  ),
  games AS (
    SELECT (g.date AT TIME ZONE 'America/New_York')::date AS on_day,
           (g.cancelled_at IS NOT NULL OR COALESCE(g.status, '') = 'cancelled') AS cancelled,
           g.series_id IS NOT NULL AS series,
           -- a player of the same group, on the roster or with an approved request (as invites_joined counts them)
           EXISTS (SELECT 1 FROM public.game_participants gp JOIN people pp ON pp.user_id = gp.user_id
                    WHERE gp.game_id = g.id AND gp.user_id <> g.host_id)
           OR EXISTS (SELECT 1 FROM public.join_requests jr JOIN people pp ON pp.user_id = jr.player_id
                       WHERE jr.game_id = g.id AND jr.status = 'approved' AND jr.player_id <> g.host_id) AS has_players
      FROM public.hosted_games g
      JOIN people pe ON pe.user_id = g.host_id
     CROSS JOIN b
     WHERE g.hidden_at IS NULL AND g.date >= b.from_at AND g.date < b.to_at AND g.date <= _now
  ),
  game_day AS (
    SELECT gm.on_day,
           count(*) FILTER (WHERE NOT gm.cancelled AND (NOT gm.series OR gm.has_players)) AS games_held,
           count(*) FILTER (WHERE NOT gm.cancelled AND gm.series AND gm.has_players) AS games_held_series,
           count(*) FILTER (WHERE gm.cancelled AND (NOT gm.series OR gm.has_players)) AS games_cancelled,
           count(*) FILTER (WHERE gm.series AND NOT gm.has_players) AS series_games_left_out
      FROM games gm
     GROUP BY gm.on_day
  )
  SELECT d.d::date,
         jsonb_build_object(
           'posters', COALESCE(pd.posters, 0),
           'posters_invited', COALESCE(pd.posters_invited, 0),
           'posters_self_joined', COALESCE(pd.posters_self_joined, 0),
           'invites_sent', COALESCE(id.invites_sent, 0),
           'invites_seen', COALESCE(id.invites_seen, 0),
           'invites_answered', COALESCE(id.invites_answered, 0),
           'invites_accepted', COALESCE(id.invites_accepted, 0),
           'invites_joined', COALESCE(id.invites_joined, 0),
           'invites_game_started', COALESCE(id.invites_game_started, 0),
           'invites_attendance_marked', COALESCE(id.invites_attendance_marked, 0),
           'invites_showed_up', COALESCE(id.invites_showed_up, 0),
           'invites_late_leaves', COALESCE(id.invites_late_leaves, 0),
           'invites_game_cancelled', COALESCE(id.invites_game_cancelled, 0),
           'invites_to_series_games', COALESCE(id.invites_to_series_games, 0),
           'games_held', COALESCE(gd.games_held, 0),
           'games_held_series', COALESCE(gd.games_held_series, 0),
           'games_cancelled', COALESCE(gd.games_cancelled, 0),
           'series_games_left_out', COALESCE(gd.series_games_left_out, 0))
    FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') AS d(d)
    LEFT JOIN poster_day pd ON pd.on_day = d.d::date
    LEFT JOIN inv_day id ON id.on_day = d.d::date
    LEFT JOIN game_day gd ON gd.on_day = d.d::date
   ORDER BY 1
$$;
REVOKE ALL ON FUNCTION private_sec.funnel_day_metrics(date, date, timestamptz, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- A count as it may leave the database: 1 to 4 become "<5" (src/lib/sport-activity.ts SPORT_ACTIVITY_MIN = 5); 0 stays 0.
CREATE OR REPLACE FUNCTION private_sec.funnel_mask(_n bigint)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN _n BETWEEN 1 AND 4 THEN to_jsonb('<5'::text) ELSE to_jsonb(COALESCE(_n, 0)) END
$$;
REVOKE ALL ON FUNCTION private_sec.funnel_mask(bigint) FROM PUBLIC, anon, authenticated, service_role;

-- A whole percentage, only when neither count is masked (each is 0 or at least 5) and the denominator is not 0.
CREATE OR REPLACE FUNCTION private_sec.funnel_rate(_num bigint, _den bigint)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE WHEN _den >= 5 AND (_num = 0 OR _num >= 5) THEN round(100.0 * _num / _den)::integer END
$$;
REVOKE ALL ON FUNCTION private_sec.funnel_rate(bigint, bigint) FROM PUBLIC, anon, authenticated, service_role;

-- One week's raw totals ({key: number}) as they may leave the database: every count masked, plus the two rates.
CREATE OR REPLACE FUNCTION private_sec.funnel_week_summary(_raw jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT COALESCE((SELECT jsonb_object_agg(e.key, private_sec.funnel_mask((e.value #>> '{}')::bigint))
                     FROM jsonb_each(COALESCE(_raw, '{}'::jsonb)) e), '{}'::jsonb)
         || jsonb_build_object(
              'marked_coverage_pct', private_sec.funnel_rate((_raw ->> 'invites_attendance_marked')::bigint,
                                                             (_raw ->> 'invites_game_started')::bigint),
              'show_up_rate_pct', private_sec.funnel_rate((_raw ->> 'invites_showed_up')::bigint,
                                                          (_raw ->> 'invites_attendance_marked')::bigint))
$$;
REVOKE ALL ON FUNCTION private_sec.funnel_week_summary(jsonb) FROM PUBLIC, anon, authenticated, service_role;

-- The report. _minors decides whether the not_confirmed_adult column is computed at all.
CREATE OR REPLACE FUNCTION private_sec.funnel_report(_from date, _to date, _now timestamptz, _minors boolean)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  _today         date := (_now AT TIME ZONE 'America/New_York')::date;
  _start         date := private_sec.funnel_pilot_start();
  _frozen_before date := private_sec.funnel_frozen_before(_now);
  _history       boolean := to_regclass('private_sec.funnel_daily') IS NOT NULL;
  _hist          jsonb := '{}'::jsonb;
  _live_from     date;
  _weeks         jsonb;
  _minor_weeks   jsonb;
BEGIN
  -- A date can be +/-infinity; '-infinity' survives every step below and generate_series over it never ends.
  IF NOT isfinite(COALESCE(_from, _today)) OR NOT isfinite(COALESCE(_to, _today)) THEN
    RAISE EXCEPTION 'INVALID_WINDOW: the start and end must be real dates.' USING ERRCODE = '22023';
  END IF;
  _to := LEAST(COALESCE(_to, _today), _today);
  _from := COALESCE(_from, _to - 49);   -- 8 weeks
  IF _from > _to THEN
    RAISE EXCEPTION 'INVALID_WINDOW: the start is after the end.' USING ERRCODE = '22023';
  END IF;
  -- Whole weeks, at most 26 of them: Monday to Sunday, and only the current week stops at today. A window ending mid-week
  -- would let two answers be subtracted into one day's exact count.
  _to := LEAST((date_trunc('week', _to::timestamp) + interval '6 days')::date, _today);
  _from := GREATEST(date_trunc('week', _from::timestamp)::date, date_trunc('week', (_to - 175)::timestamp)::date);
  -- The pilot start, moved on to a Monday (a start that is a Monday stays), so no day before it counts and the first week is whole.
  IF _start IS NOT NULL THEN
    _from := GREATEST(_from, date_trunc('week', (_start + 6)::timestamp)::date);
  END IF;

  IF _from > _to THEN
    _weeks := '[]'::jsonb;
  ELSE
    -- Frozen weeks the history holds all seven days of. A week it holds only part of is computed live, whole.
    IF _history THEN
      EXECUTE 'SELECT COALESCE(jsonb_object_agg(f.day::text, f.metrics), ''{}''::jsonb)
                 FROM private_sec.funnel_daily f
                WHERE f.day >= $1 AND f.day <= $2 AND f.day < $3
                  AND (SELECT count(*) FROM private_sec.funnel_daily x
                        WHERE x.day >= date_trunc(''week'', f.day::timestamp)::date
                          AND x.day < date_trunc(''week'', f.day::timestamp)::date + 7) = 7'
         INTO _hist USING _from, _to, _frozen_before;
    END IF;
    SELECT min(g.d)::date INTO _live_from
      FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') g(d)
     WHERE NOT (_hist ? (g.d::date)::text);

    WITH live AS (
           SELECT m.day, m.metrics FROM private_sec.funnel_day_metrics(_live_from, _to, _now, true) m
         ),
         days AS (
           SELECT g.d::date AS on_day,
                  COALESCE(_hist -> (g.d::date)::text, l.metrics) AS m,
                  _hist ? (g.d::date)::text AS from_history
             FROM generate_series(_from::timestamp, _to::timestamp, interval '1 day') g(d)
             LEFT JOIN live l ON l.day = g.d::date
         ),
         sums AS (
           SELECT date_trunc('week', d.on_day::timestamp)::date AS week_start, e.key, sum((e.value #>> '{}')::bigint) AS total
             FROM days d CROSS JOIN LATERAL jsonb_each(COALESCE(d.m, '{}'::jsonb)) e
            GROUP BY 1, 2
         ),
         weekly AS (
           SELECT date_trunc('week', d.on_day::timestamp)::date AS week_start,
                  min(d.on_day) AS first_day, max(d.on_day) AS last_day,
                  bool_and(d.from_history) AS all_history, bool_or(d.from_history) AS any_history
             FROM days d
            GROUP BY 1
         )
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
             'week_start', w.week_start, 'first_day', w.first_day, 'last_day', w.last_day,
             'source', CASE WHEN w.all_history THEN 'history' WHEN w.any_history THEN 'mixed' ELSE 'live' END,
             'adults', private_sec.funnel_week_summary(
                         (SELECT jsonb_object_agg(s.key, s.total) FROM sums s WHERE s.week_start = w.week_start)))
           ORDER BY w.week_start), '[]'::jsonb)
      INTO _weeks
      FROM weekly w;

    -- Accounts that are not confirmed adults: computed only while the switch is on, always live.
    IF _minors THEN
      WITH sums AS (
             SELECT date_trunc('week', m.day::timestamp)::date AS week_start, e.key, sum((e.value #>> '{}')::bigint) AS total
               FROM private_sec.funnel_day_metrics(_from, _to, _now, false) m
              CROSS JOIN LATERAL jsonb_each(m.metrics) e
              GROUP BY 1, 2
           )
      SELECT COALESCE(jsonb_object_agg(x.week_start::text, private_sec.funnel_week_summary(x.raw)), '{}'::jsonb)
        INTO _minor_weeks
        FROM (SELECT s.week_start, jsonb_object_agg(s.key, s.total) AS raw FROM sums s GROUP BY s.week_start) x;

      SELECT COALESCE(jsonb_agg(w.value || jsonb_build_object('not_confirmed_adult', _minor_weeks -> (w.value ->> 'week_start'))
                                ORDER BY w.ord), '[]'::jsonb)
        INTO _weeks
        FROM jsonb_array_elements(_weeks) WITH ORDINALITY AS w(value, ord);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'timezone', 'America/New_York',
    'from', _from,
    'to', _to,
    'pilot_start', _start,
    'minors_column', COALESCE(_minors, false),
    'history', jsonb_build_object('available', _history, 'frozen_before', _frozen_before,
                                  'days_used', (SELECT count(*) FROM jsonb_object_keys(_hist))),
    'weeks', _weeks);
END $$;
REVOKE ALL ON FUNCTION private_sec.funnel_report(date, date, timestamptz, boolean) FROM PUBLIC, anon, authenticated, service_role;

-- 3. The superadmin entry point ------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.superadmin_funnel(_from date DEFAULT NULL, _to date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Checked here, not only in the admin page: the page is not an authorization boundary.
  IF NOT COALESCE(private_sec.is_superadmin(auth.uid()), false) THEN
    RAISE EXCEPTION 'SUPERADMIN_ONLY' USING ERRCODE = '42501';
  END IF;
  RETURN private_sec.funnel_report(_from, _to, now(), private_sec.funnel_minor_counts_enabled());
END $$;
REVOKE ALL ON FUNCTION public.superadmin_funnel(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.superadmin_funnel(date, date) TO authenticated;
COMMENT ON FUNCTION public.superadmin_funnel(date, date) IS
  'WP 5.2: the weekly pilot funnel (America/New_York weeks), totals only, 1-4 masked as "<5". Superadmin only; writes nothing.';

RESET lock_timeout;
