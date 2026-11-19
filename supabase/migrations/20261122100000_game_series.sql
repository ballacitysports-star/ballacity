-- WP 3.1 (Phase 3): a game that repeats, kept going by the server.
--
-- WHY. "Repeat" did not exist: a host could pick several dates up front (the client inserted one game per date and gave them a
-- shared series_id), but a weekly run had to be re-created by hand once those dates ran out. hosted_games.rrule (20260827020515)
-- was never used.
--
-- WHAT.
-- 1. public.game_series: one row per repeating run (its id is the games' series_id): host, how often (every week or every 2
--    weeks), an optional last date, whether it is still running. The host reads their own; nobody writes it directly.
-- 2. public.game_series_start(_game, _freq, _until): the host of an upcoming, listed game makes it repeat. The game gets the
--    series id and rrule ({"freq": ..., "until": ...}, shown to players); the next dates are created at once, up to 4 weeks ahead.
--    A game that is already one of several dates picked up front, cancelled, hidden or past cannot start a series.
-- 3. private_sec.extend_game_series(_series, _now): creates the dates still missing in the next 4 weeks (at most 8 per call),
--    each a copy of the most recent date in the series at the same local time a week (or two) later, with its payment settings.
--    So editing the latest date carries forward. Places, requests, payments and cancellation are never copied. A date id is
--    derived from the series and the day, so a date is never created twice. Before creating anything it checks the host may
--    still host it (not suspended; adult, or still owns or manages the team; the insert triggers check age and guardian
--    locks again), and ends the series if not, or once its last date or the last live game is gone.
-- 4. public.game_series_stop(_series): the host stops the series; its dates no longer say they repeat. Dates already created
--    stay; the host cancels any of them the usual way (which handles players, refunds and notices).
-- 5. A daily job (pg_cron, 'extend-game-series', 04:17 UTC) extends every running series.
--
-- Nothing existing is changed: games with a series_id from the multi-date picker have no game_series row and stay as they are.
--
-- Rollback: docs/rollbacks/20261122100000_game_series.down.sql.

-- 1. Table ---------------------------------------------------------------------------------------------------------------------------
CREATE TABLE public.game_series (
  id uuid PRIMARY KEY,
  host_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  freq text NOT NULL CHECK (freq IN ('weekly', 'biweekly')),
  until_date date,
  active boolean NOT NULL DEFAULT true,
  ended_at timestamptz,
  ended_reason text,
  last_extended_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX game_series_active_idx ON public.game_series (active) WHERE active;
ALTER TABLE public.game_series ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.game_series FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.game_series TO authenticated;
GRANT ALL ON public.game_series TO service_role;
CREATE POLICY "Hosts read their series" ON public.game_series FOR SELECT TO authenticated USING (host_id = auth.uid());

-- 2. May this host still host a copy of this game? (the rule WP 3.0 applies to members, for writes made without one) ---------------
CREATE OR REPLACE FUNCTION private_sec.series_host_still_eligible(_host uuid, _team text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT NOT EXISTS (SELECT 1 FROM public.profiles p
                      WHERE p.id = _host AND (p.suspended_at IS NOT NULL OR p.moderation_state IN ('suspended', 'banned')))
     AND CASE WHEN _team IS NULL THEN public.age_cohort_of(_host) IS NOT DISTINCT FROM 'adult'
              ELSE COALESCE(private_sec.is_team_manager(_team, _host), false) END
$$;
REVOKE ALL ON FUNCTION private_sec.series_host_still_eligible(uuid, text) FROM PUBLIC, anon, authenticated;

-- 3. Create the missing dates ----------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.extend_game_series(_series uuid, _now timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  s public.game_series%ROWTYPE;
  g public.hosted_games%ROWTYPE;
  _tz text;
  _step interval;
  _next timestamptz;
  _len interval;
  _id text;
  _made integer := 0;
  _horizon timestamptz := _now + interval '28 days';
BEGIN
  SELECT * INTO s FROM public.game_series WHERE id = _series FOR UPDATE;
  IF NOT FOUND OR NOT s.active THEN RETURN 0; END IF;

  -- the most recent live date is the template
  SELECT * INTO g FROM public.hosted_games
   WHERE series_id = _series AND cancelled_at IS NULL AND hidden_at IS NULL AND moderator_hidden_at IS NULL
   ORDER BY date DESC LIMIT 1;
  IF NOT FOUND THEN
    UPDATE public.game_series SET active = false, ended_at = _now, ended_reason = 'no_live_game' WHERE id = _series;
    RETURN 0;
  END IF;
  IF g.host_id IS DISTINCT FROM s.host_id OR NOT private_sec.series_host_still_eligible(s.host_id, g.team_id) THEN
    UPDATE public.game_series SET active = false, ended_at = _now, ended_reason = 'host_not_eligible' WHERE id = _series;
    RETURN 0;
  END IF;

  _tz := private_sec.safe_timezone(g.timezone);
  _step := CASE s.freq WHEN 'biweekly' THEN interval '14 days' ELSE interval '7 days' END;
  _len := CASE WHEN g.ends_at IS NOT NULL THEN g.ends_at - g.date END;
  -- same local wall-clock time, a week (or two) later, across daylight-saving changes
  _next := ((g.date AT TIME ZONE _tz) + _step) AT TIME ZONE _tz;

  WHILE _next <= _horizon AND _made < 8 LOOP
    IF s.until_date IS NOT NULL AND (_next AT TIME ZONE _tz)::date > s.until_date THEN
      UPDATE public.game_series SET active = false, ended_at = _now, ended_reason = 'until_reached' WHERE id = _series;
      EXIT;
    END IF;
    IF _next > _now THEN
      _id := 'series-' || left(replace(_series::text, '-', ''), 12) || '-' || to_char(_next AT TIME ZONE _tz, 'YYYYMMDD');
      INSERT INTO public.hosted_games (
        id, host_id, sport, title, date, duration, location, neighborhood, lat, lng, max_players, skill, price, indoor,
        is_private, image, description, equipment, status, host_snapshot, positions_needed, team_id, org_id, org_official,
        signup_cutoff_min, min_age, max_age, series_id, ends_at, all_day, timezone, arrive_early_min, rrule, reminder_offsets,
        min_players, allow_waitlist, cancellation_policy, cancellation_notes, game_rules, cancel_cutoff_min)
      VALUES (
        _id, g.host_id, g.sport, g.title, _next, g.duration, g.location, g.neighborhood, g.lat, g.lng, g.max_players, g.skill,
        g.price, g.indoor, g.is_private, g.image, g.description, g.equipment, g.status, g.host_snapshot, g.positions_needed,
        g.team_id, g.org_id, g.org_official, g.signup_cutoff_min, g.min_age, g.max_age, _series,
        CASE WHEN _len IS NOT NULL THEN _next + _len END, g.all_day, g.timezone, g.arrive_early_min, g.rrule,
        g.reminder_offsets, g.min_players, g.allow_waitlist, g.cancellation_policy, g.cancellation_notes, g.game_rules,
        g.cancel_cutoff_min)
      ON CONFLICT (id) DO NOTHING;
      IF FOUND THEN
        _made := _made + 1;
        INSERT INTO public.game_payment_settings (
          game_id, host_id, entry_fee, accepted_method_ids, refund_policy, payment_instructions, requires_approval,
          payment_mode, payment_hold_minutes, refund_rule, late_refund_pct)
        SELECT _id, ps.host_id, ps.entry_fee, ps.accepted_method_ids, ps.refund_policy, ps.payment_instructions,
               ps.requires_approval, ps.payment_mode, ps.payment_hold_minutes, ps.refund_rule, ps.late_refund_pct
          FROM public.game_payment_settings ps WHERE ps.game_id = g.id
        ON CONFLICT DO NOTHING;
      END IF;
    END IF;
    _next := ((_next AT TIME ZONE _tz) + _step) AT TIME ZONE _tz;
  END LOOP;

  UPDATE public.game_series SET last_extended_at = _now WHERE id = _series;
  RETURN _made;
END $$;
REVOKE ALL ON FUNCTION private_sec.extend_game_series(uuid, timestamptz) FROM PUBLIC, anon, authenticated;

-- every running series; one that fails is skipped (and tried again tomorrow), it does not stop the others
CREATE OR REPLACE FUNCTION private_sec.extend_all_game_series(_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  r record;
  _made integer := 0;
  _failed integer := 0;
BEGIN
  FOR r IN SELECT id FROM public.game_series WHERE active ORDER BY created_at LIMIT 500 LOOP
    BEGIN
      _made := _made + private_sec.extend_game_series(r.id, _now);
    EXCEPTION WHEN OTHERS THEN
      _failed := _failed + 1;
    END;
  END LOOP;
  RETURN jsonb_build_object('created', _made, 'failed', _failed);
END $$;
REVOKE ALL ON FUNCTION private_sec.extend_all_game_series(timestamptz) FROM PUBLIC, anon, authenticated;

-- 4. The host starts and stops a series ---------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.game_series_start(_game text, _freq text, _until date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  _me uuid := auth.uid();
  g public.hosted_games%ROWTYPE;
  _series uuid := gen_random_uuid();
  _made integer;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Sign in to make a game repeat.' USING ERRCODE = '42501'; END IF;
  IF _freq NOT IN ('weekly', 'biweekly') THEN
    RAISE EXCEPTION 'A game can repeat every week or every 2 weeks.' USING ERRCODE = '22023', HINT = 'SERIES_BAD_FREQ';
  END IF;
  SELECT * INTO g FROM public.hosted_games WHERE id = _game FOR UPDATE;
  IF NOT FOUND OR g.host_id IS DISTINCT FROM _me THEN
    RAISE EXCEPTION 'Only the host can make this game repeat.' USING ERRCODE = '42501', HINT = 'SERIES_NOT_HOST';
  END IF;
  IF g.series_id IS NOT NULL THEN
    RAISE EXCEPTION 'This game is already part of a series.' USING ERRCODE = '22023', HINT = 'SERIES_ALREADY';
  END IF;
  IF g.date <= now() OR g.cancelled_at IS NOT NULL OR g.completed_at IS NOT NULL
     OR g.hidden_at IS NOT NULL OR g.moderator_hidden_at IS NOT NULL OR g.owner_hidden_at IS NOT NULL THEN
    RAISE EXCEPTION 'Only an upcoming, listed game can repeat.' USING ERRCODE = '22023', HINT = 'SERIES_GAME_NOT_OPEN';
  END IF;
  IF _until IS NOT NULL AND _until < (g.date AT TIME ZONE private_sec.safe_timezone(g.timezone))::date THEN
    RAISE EXCEPTION 'The last date must be on or after the first game.' USING ERRCODE = '22023', HINT = 'SERIES_BAD_UNTIL';
  END IF;

  INSERT INTO public.game_series (id, host_id, freq, until_date) VALUES (_series, _me, _freq, _until);
  UPDATE public.hosted_games
     SET series_id = _series, rrule = jsonb_build_object('freq', _freq, 'until', _until)
   WHERE id = _game;
  _made := private_sec.extend_game_series(_series, now());
  RETURN jsonb_build_object('series_id', _series, 'created', _made);
END $$;
REVOKE ALL ON FUNCTION public.game_series_start(text, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_series_start(text, text, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.game_series_stop(_series uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501'; END IF;
  UPDATE public.game_series SET active = false, ended_at = now(), ended_reason = 'stopped_by_host'
   WHERE id = _series AND host_id = auth.uid() AND active;
  IF FOUND THEN
    UPDATE public.hosted_games SET rrule = NULL WHERE series_id = _series AND rrule IS NOT NULL;
    RETURN true;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.game_series WHERE id = _series AND host_id = auth.uid()) THEN
    RAISE EXCEPTION 'Only the host can stop this series.' USING ERRCODE = '42501', HINT = 'SERIES_NOT_HOST';
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.game_series_stop(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.game_series_stop(uuid) TO authenticated;

-- 5. Schedule ----------------------------------------------------------------------------------------------------------------------------
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('extend-game-series', '17 4 * * *', $j$SELECT private_sec.extend_all_game_series()$j$);
  ELSE
    RAISE NOTICE 'pg_cron is not installed: extend-game-series not scheduled';
  END IF;
EXCEPTION WHEN others THEN
  RAISE NOTICE 'extend-game-series not scheduled: %', SQLERRM;
END
$cron$;
