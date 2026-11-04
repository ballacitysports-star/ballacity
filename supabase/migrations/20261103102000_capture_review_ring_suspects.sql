-- Capture of production's review_ring_suspects(integer).
--
-- DRIFT. The version in this repository (20261012130000) names an aggregate `avg_rating` inside a function whose
-- result table also has a column `avg_rating`. PL/pgSQL rejects that as an ambiguous column reference when the function
-- runs, so on a database rebuilt from source the moderator dashboard's "review rings" call fails. Production was fixed by
-- hand (the aggregate is named `mean_rating`); the fix was never written down.
--
-- WHAT THIS DOES. Replaces the function with production's exact text (verified 2026-11-03: pg_get_functiondef md5
-- f41ec9f31e2ef4b00a08dde328ea4f51, owner postgres, SECURITY DEFINER, STABLE, search_path = public) and states its
-- grants (production: authenticated and service_role; the body itself refuses callers who are not moderators).
-- ON PRODUCTION THIS CHANGES NOTHING. Idempotent. No table or data is touched.
--
-- The signature is unchanged (same name, argument and result columns), so CREATE OR REPLACE applies.
CREATE OR REPLACE FUNCTION public.review_ring_suspects(_days integer DEFAULT 60)
 RETURNS TABLE(user_a uuid, user_b uuid, a_to_b integer, b_to_a integer, avg_rating numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH r AS (
    SELECT reviewer_id, public.try_uuid(reviewee_id) AS reviewee, rating
      FROM public.reviews
     WHERE reviewee_kind IN ('player', 'host') AND created_at > now() - make_interval(days => _days)
  ), pairs AS (
    SELECT least(reviewer_id, reviewee) AS a, greatest(reviewer_id, reviewee) AS b,
           count(*) FILTER (WHERE reviewer_id < reviewee) AS ab,
           count(*) FILTER (WHERE reviewer_id > reviewee) AS ba,
           avg(rating) AS mean_rating
      FROM r WHERE reviewee IS NOT NULL AND reviewer_id <> reviewee
     GROUP BY 1, 2
  )
  SELECT a, b, ab::int, ba::int, round(mean_rating, 2)
    FROM pairs WHERE ab >= 2 AND ba >= 2 AND mean_rating >= 4.5
   ORDER BY (ab + ba) DESC LIMIT 100;
END $function$;

REVOKE ALL ON FUNCTION public.review_ring_suspects(integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_ring_suspects(integer) TO authenticated, service_role;
