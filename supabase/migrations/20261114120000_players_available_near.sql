-- WP 1.3 (availability-first, Phase 1): server-side "players available near me".
--
-- WHY. The Players tab loads the newest 100 open posts into the browser and filters, sorts and pages them there. Distance compares the
-- poster's travel radius with a slider instead of measuring anything, a post's times are never compared with the time the viewer cares
-- about, and anything past row 100 is never seen. Find Players needs the database to do this, one page at a time.
--
-- WHAT THIS ADDS. public.players_available_near(...) returns one page of open availability posts, at most one per person, that:
--   * the caller may read: it runs as the caller (SECURITY INVOKER), so the read policy on player_availabilities decides everything about
--     minors, guardians, blocks, suspended authors and hidden posts, exactly as through the table (20261114100000), and it also requires
--     the post to be open, not hidden and not run out (20261114110000), so a guardian or the author does not see closed posts here;
--   * are not the caller's own;
--   * match the sport, the intent ('pickup', 'guest', 'tryout') and the skill tiers asked for (a post that lists no tier for the sport
--     is open to every level);
--   * are free during the window asked for (default: the next 7 days, at most 31): dated slots and weekly slots are turned into real
--     times in the post's own timezone (America/New_York when it has none or an unknown one), legacy starts_on/ends_on posts count as all
--     day on those days, and a post with no times at all ("flexible") matches any window;
--   * are within reach both ways: within the caller's radius of the caller's point AND within the poster's own travel radius.
--     A post without coordinates is left out of a located search unless _include_unlocated is true (then its distance is NULL).
-- Each row gives the earliest matching window and the distance rounded UP to whole miles (at least 1): the post's stored coordinates are
-- already rounded to about a kilometre (or absent) by the location-privacy triggers, and the search adds no precision to them.
-- Paging is limit/offset, as games_near; order 'nearest' (default) or 'soonest', ties broken by post id, so pages are stable.
--
-- Helpers (no table access, no definer rights): private_sec.safe_timezone, private_sec.availability_windows, private_sec.availability_tiers.
-- A malformed slot or legacy date is skipped, never an error for the whole search.
-- No app code calls it yet; the Find Players screen switches over in WP 1.5.
-- ROLLBACK: docs/rollbacks/20261114120000_players_available_near.down.sql. TEST: supabase/tests/860_players_available_near.test.sql.

SET lock_timeout = '5s';

DO $guard$ BEGIN
  IF to_regprocedure('private_sec.availability_expires_at(jsonb,text,date,date,timestamptz)') IS NULL THEN
    RAISE EXCEPTION 'players_available_near: 20261114110000_availability_intent_and_lifecycle must be applied first';
  END IF;
END $guard$;

CREATE INDEX IF NOT EXISTS player_availabilities_open_lat_lng_idx
  ON public.player_availabilities (lat, lng) WHERE status = 'open' AND hidden_at IS NULL AND lat IS NOT NULL AND lng IS NOT NULL;

-- A timezone name that Postgres knows, else the first market's.
CREATE OR REPLACE FUNCTION private_sec.safe_timezone(_tz text)
RETURNS text LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
BEGIN
  IF _tz IS NULL OR btrim(_tz) = '' THEN RETURN 'America/New_York'; END IF;
  PERFORM now() AT TIME ZONE _tz;
  RETURN _tz;
EXCEPTION WHEN invalid_parameter_value THEN
  RETURN 'America/New_York';
END $$;

-- The real time windows of a post that overlap [_from, _to).
CREATE OR REPLACE FUNCTION private_sec.availability_windows(
  _slots jsonb, _tz text, _starts date, _ends date, _from timestamptz, _to timestamptz)
RETURNS TABLE (window_start timestamptz, window_end timestamptz)
LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE
  _z     text := private_sec.safe_timezone(_tz);
  _s     jsonb;
  _d     date;
  _ws    timestamptz;
  _we    timestamptz;
  _first date := (_from AT TIME ZONE _z)::date;
  _last  date := (_to AT TIME ZONE _z)::date;
BEGIN
  IF _from IS NULL OR _to IS NULL OR _to <= _from THEN RETURN; END IF;
  IF _slots IS NOT NULL AND jsonb_typeof(_slots) = 'array' AND jsonb_array_length(_slots) > 0 THEN
    FOR _s IN SELECT e FROM jsonb_array_elements(_slots) e LOOP
      BEGIN
        IF _s ? 'date' THEN
          _d  := (_s ->> 'date')::date;
          _ws := (_d + (_s ->> 'start')::interval) AT TIME ZONE _z;
          _we := (_d + (_s ->> 'end')::interval) AT TIME ZONE _z;
          IF _ws < _to AND _we > _from THEN window_start := _ws; window_end := _we; RETURN NEXT; END IF;
        ELSIF _s ? 'weekday' THEN
          FOR _d IN SELECT g::date FROM generate_series(_first, _last, interval '1 day') g LOOP
            CONTINUE WHEN extract(dow FROM _d)::int <> (_s ->> 'weekday')::int;
            _ws := (_d + (_s ->> 'start')::interval) AT TIME ZONE _z;
            _we := (_d + (_s ->> 'end')::interval) AT TIME ZONE _z;
            IF _ws < _to AND _we > _from THEN window_start := _ws; window_end := _we; RETURN NEXT; END IF;
          END LOOP;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        NULL;   -- a malformed slot is skipped
      END;
    END LOOP;
  ELSIF _starts IS NOT NULL OR _ends IS NOT NULL THEN
    BEGIN
      _ws := greatest(coalesce(_starts::timestamp AT TIME ZONE _z, _from), _from);
      _we := least(coalesce((_ends + 1)::timestamp AT TIME ZONE _z, _to), _to);
      IF _ws < _we THEN window_start := _ws; window_end := _we; RETURN NEXT; END IF;
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  RETURN;
END $$;

-- The skill tiers a post lists for one sport (the app's " · "-joined format; legacy skill_level for the primary sport), without
-- "All Levels". Empty means open to every level.
CREATE OR REPLACE FUNCTION private_sec.availability_tiers(_skill_levels jsonb, _skill_level text, _sports text[], _sport text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
  SELECT coalesce(array_agg(t) FILTER (WHERE t <> '' AND t <> 'All Levels'), ARRAY[]::text[])
    FROM unnest(regexp_split_to_array(
           coalesce(
             CASE WHEN jsonb_typeof(_skill_levels) = 'object' THEN _skill_levels ->> _sport END,
             CASE WHEN _sports[1] = _sport THEN _skill_level END,
             ''),
           '\s*[·,]\s*')) AS u(t)
$$;

REVOKE ALL ON FUNCTION private_sec.safe_timezone(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private_sec.availability_windows(jsonb, text, date, date, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private_sec.availability_tiers(jsonb, text, text[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private_sec.safe_timezone(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private_sec.availability_windows(jsonb, text, date, date, timestamptz, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private_sec.availability_tiers(jsonb, text, text[], text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.players_available_near(
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL,
  _radius_mi double precision DEFAULT 15,
  _sport text DEFAULT NULL,
  _from timestamptz DEFAULT NULL,
  _to timestamptz DEFAULT NULL,
  _intent text DEFAULT NULL,
  _skill text[] DEFAULT NULL,
  _include_unlocated boolean DEFAULT false,
  _order text DEFAULT 'nearest',
  _limit integer DEFAULT 20,
  _offset integer DEFAULT 0)
RETURNS TABLE (
  availability_id uuid, user_id uuid, sports text[], skill_level text, skill_levels jsonb, looking_for text[], city text,
  distance_mi integer, window_start timestamptz, window_end timestamptz)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path TO ''
AS $$
  WITH params AS (
    SELECT
      _lat IS NOT NULL AND _lng IS NOT NULL                              AS located,
      least(greatest(coalesce(_radius_mi, 15), 0.5), 100)                 AS r,
      coalesce(_from, now())                                             AS f,
      least(coalesce(_to, coalesce(_from, now()) + interval '7 days'),
            coalesce(_from, now()) + interval '31 days')                 AS t,
      least(greatest(coalesce(_limit, 20), 1), 50)                       AS lim,
      greatest(coalesce(_offset, 0), 0)                                  AS off
  ), posts AS (
    SELECT a.id, a.user_id, a.sports, a.skill_level, a.skill_levels, a.looking_for, a.city, a.created_at,
           a.time_slots, a.timezone, a.starts_on, a.ends_on, a.travel_radius_km,
           CASE WHEN p.located AND a.lat IS NOT NULL AND a.lng IS NOT NULL THEN
             3958.8 * 2 * asin(sqrt(
               power(sin(radians((a.lat::double precision - _lat) / 2)), 2)
               + cos(radians(_lat)) * cos(radians(a.lat::double precision))
                 * power(sin(radians((a.lng::double precision - _lng) / 2)), 2)))
           END AS d
      FROM public.player_availabilities a, params p
     WHERE a.status = 'open'
       AND a.hidden_at IS NULL
       AND a.user_id IS DISTINCT FROM auth.uid()
       AND coalesce(private_sec.availability_expires_at(a.time_slots, a.timezone, a.starts_on, a.ends_on, a.last_confirmed_at) > now(), true)
       AND (_sport IS NULL OR _sport = ANY (a.sports))
       AND (_intent IS NULL OR _intent = ANY (a.looking_for))
       AND (_sport IS NULL OR _skill IS NULL OR cardinality(_skill) = 0
            OR cardinality(private_sec.availability_tiers(a.skill_levels, a.skill_level, a.sports, _sport)) = 0
            OR private_sec.availability_tiers(a.skill_levels, a.skill_level, a.sports, _sport) && _skill)
       AND (NOT p.located
            OR (a.lat IS NULL AND _include_unlocated)
            OR (a.lat IS NOT NULL AND a.lng IS NOT NULL
                -- One degree of latitude is about 69 miles; widen longitude by latitude.
                AND a.lat BETWEEN _lat - p.r / 69.0 AND _lat + p.r / 69.0
                AND a.lng BETWEEN _lng - p.r / (69.0 * greatest(cos(radians(_lat)), 0.01))
                              AND _lng + p.r / (69.0 * greatest(cos(radians(_lat)), 0.01))))
  ), timed AS (
    SELECT po.*, w.window_start AS ws, w.window_end AS we
      FROM posts po
      CROSS JOIN params p
      LEFT JOIN LATERAL (
        SELECT x.window_start, x.window_end
          FROM private_sec.availability_windows(po.time_slots, po.timezone, po.starts_on, po.ends_on, p.f, p.t) x
         ORDER BY x.window_start
         LIMIT 1) w ON true
     WHERE (po.d IS NULL OR (po.d <= p.r AND po.d <= po.travel_radius_km * 0.621371))
       AND (w.window_start IS NOT NULL
            OR (coalesce(jsonb_array_length(po.time_slots), 0) = 0 AND po.starts_on IS NULL AND po.ends_on IS NULL))
  ), per_person AS (
    SELECT DISTINCT ON (tm.user_id) tm.*
      FROM timed tm
     ORDER BY tm.user_id, tm.ws NULLS LAST, tm.d NULLS LAST, tm.created_at DESC, tm.id
  )
  SELECT pp.id, pp.user_id, pp.sports, pp.skill_level, pp.skill_levels, pp.looking_for, pp.city,
         CASE WHEN pp.d IS NULL THEN NULL ELSE greatest(1, ceil(pp.d))::integer END,
         pp.ws, pp.we
    FROM per_person pp
   ORDER BY
     CASE WHEN _order = 'soonest' THEN pp.ws END ASC NULLS LAST,
     pp.d ASC NULLS LAST,
     pp.ws ASC NULLS LAST,
     pp.id ASC
   LIMIT (SELECT lim FROM params) OFFSET (SELECT off FROM params);
$$;

REVOKE ALL ON FUNCTION public.players_available_near(double precision, double precision, double precision, text, timestamptz, timestamptz, text, text[], boolean, text, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.players_available_near(double precision, double precision, double precision, text, timestamptz, timestamptz, text, text[], boolean, text, integer, integer)
  TO authenticated, service_role;
