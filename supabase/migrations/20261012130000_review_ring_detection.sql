-- Rating system, phase 2: abuse signals for moderators.
-- Flags pairs of players who rate each other highly and repeatedly, and
-- reviewers who give (almost) the same score to everyone. Read-only; a human
-- decides what to do with the result.

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
           avg(rating) AS avg_rating
      FROM r WHERE reviewee IS NOT NULL AND reviewer_id <> reviewee
     GROUP BY 1, 2
  )
  SELECT a, b, ab::int, ba::int, round(avg_rating, 2)
    FROM pairs WHERE ab >= 2 AND ba >= 2 AND avg_rating >= 4.5
   ORDER BY (ab + ba) DESC LIMIT 100;
END $$;

CREATE OR REPLACE FUNCTION public.review_uniform_raters(_min int DEFAULT 6)
RETURNS TABLE (reviewer_id uuid, reviews bigint, avg_rating numeric, stddev_rating numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.is_moderator(auth.uid()) THEN
    RAISE EXCEPTION 'Moderators only.' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT r.reviewer_id, count(*), round(avg(r.rating), 2), round(coalesce(stddev_pop(r.rating), 0), 2)
    FROM public.reviews r
   WHERE r.reviewee_kind <> 'gym'
   GROUP BY r.reviewer_id
  HAVING count(*) >= _min AND coalesce(stddev_pop(r.rating), 0) < 0.3
   ORDER BY count(*) DESC LIMIT 100;
END $$;

REVOKE ALL ON FUNCTION public.review_ring_suspects(int) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.review_uniform_raters(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_ring_suspects(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.review_uniform_raters(int) TO authenticated;
