-- Server-side game discovery (backlog P1-4, first slice).
--
-- The games feed loads every unhidden game into the browser and filters by distance in
-- JavaScript. games_near does that filtering in the database and returns one page of game
-- ids with their distance. It runs as the caller (SECURITY INVOKER), so the hosted_games
-- row level security still decides what anyone can see: a signed-out visitor gets only
-- adult-only, listable games, exactly as through the table.
--
-- No app code uses it yet; the feed switches over in a later change, behind parity checks.
-- No extension is needed: a latitude/longitude box narrows the rows (indexed), then the
-- haversine distance is computed for those only.

CREATE INDEX IF NOT EXISTS hosted_games_sport_date_live_idx
  ON public.hosted_games (sport, date) WHERE hidden_at IS NULL;
CREATE INDEX IF NOT EXISTS hosted_games_lat_lng_idx
  ON public.hosted_games (lat, lng) WHERE hidden_at IS NULL AND lat IS NOT NULL AND lng IS NOT NULL;

CREATE OR REPLACE FUNCTION public.games_near(
  _lat double precision DEFAULT NULL,
  _lng double precision DEFAULT NULL,
  _radius_mi double precision DEFAULT 25,
  _sports text[] DEFAULT NULL,
  _after timestamptz DEFAULT now(),
  _order text DEFAULT 'soonest',
  _limit integer DEFAULT 30,
  _offset integer DEFAULT 0)
RETURNS TABLE (id text, date timestamptz, distance_mi double precision)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH params AS (
    SELECT
      _lat IS NOT NULL AND _lng IS NOT NULL AS located,
      least(greatest(coalesce(_radius_mi, 25), 0.1), 500) AS r,
      least(greatest(coalesce(_limit, 30), 1), 100) AS lim,
      greatest(coalesce(_offset, 0), 0) AS off
  ), candidates AS (
    SELECT g.id, g.date,
      CASE WHEN p.located AND g.lat IS NOT NULL AND g.lng IS NOT NULL THEN
        3958.8 * 2 * asin(sqrt(
          power(sin(radians((g.lat::double precision - _lat) / 2)), 2)
          + cos(radians(_lat)) * cos(radians(g.lat::double precision))
            * power(sin(radians((g.lng::double precision - _lng) / 2)), 2)))
      END AS distance_mi
    FROM public.hosted_games g, params p
    WHERE g.is_private = false
      AND g.hidden_at IS NULL
      AND g.cancelled_at IS NULL
      AND g.completed_at IS NULL
      AND coalesce(g.status, '') NOT IN ('cancelled', 'completed')
      AND g.date >= coalesce(_after, now())
      AND (_sports IS NULL OR cardinality(_sports) = 0 OR g.sport = ANY (_sports))
      AND (NOT p.located OR (
            g.lat IS NOT NULL AND g.lng IS NOT NULL
            -- One degree of latitude is about 69 miles; widen longitude by latitude.
            AND g.lat BETWEEN _lat - p.r / 69.0 AND _lat + p.r / 69.0
            AND g.lng BETWEEN _lng - p.r / (69.0 * greatest(cos(radians(_lat)), 0.01))
                          AND _lng + p.r / (69.0 * greatest(cos(radians(_lat)), 0.01))))
  )
  SELECT c.id, c.date, c.distance_mi
  FROM candidates c, params p
  WHERE NOT p.located OR c.distance_mi <= p.r
  ORDER BY
    CASE WHEN _order = 'nearest' THEN c.distance_mi END ASC NULLS LAST,
    c.date ASC, c.id ASC
  LIMIT (SELECT lim FROM params) OFFSET (SELECT off FROM params);
$$;

REVOKE ALL ON FUNCTION public.games_near(double precision, double precision, double precision, text[], timestamptz, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.games_near(double precision, double precision, double precision, text[], timestamptz, text, integer, integer)
  TO anon, authenticated, service_role;
