-- Fix: review_ring_suspects() failed on every call with
--   ERROR: column reference "avg_rating" is ambiguous
-- because its RETURNS TABLE column `avg_rating` clashed with the `avg_rating`
-- column of the `pairs` CTE inside the function body (plpgsql treats output
-- columns as variables). `CREATE FUNCTION` only checks syntax, so this only
-- showed up when the function was first executed. The CTE column is renamed;
-- nothing else changes, including the function's signature and grants.

CREATE OR REPLACE FUNCTION public.review_ring_suspects(_days int DEFAULT 60)
RETURNS TABLE (user_a uuid, user_b uuid, a_to_b int, b_to_a int, avg_rating numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;
