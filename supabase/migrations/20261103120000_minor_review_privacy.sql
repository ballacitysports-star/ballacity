-- PRIV-1: minors and reviews.
--
-- Before this migration a person under 18 could be the subject of a public review: the integrity
-- trigger refused only under-13s and even forced a teen's "private" review to public
-- ("teens are never sent private feedback"). Reviews about them, the AI summaries made from those
-- reviews, and the statistics derived from both were readable by anonymous visitors or by any
-- signed-in account. Reviews written by a minor also published that minor's name.
--
-- Rules after this migration (enforced here, in the database, not only in the app):
--   1. Nobody can write a review whose subject (player or host) is under 18 or of unconfirmed age.
--   2. Nobody under 18 (or of unconfirmed age) can write a review of anyone or anything for now.
--      Minor-authored feedback needs a workflow with anonymity, moderation and authorization; until
--      that exists it is off rather than half-protected.
--   3. Existing rows are PRESERVED. Nothing is updated or deleted. A review is simply not
--      readable by others when its subject or its author is not a confirmed adult, and an AI
--      summary is not readable when its subject is not a confirmed adult. The author still reads
--      their own text. Service-role code (moderation, retention review) still reads everything.
--   4. Review-derived statistics about a person under 18 are not returned to anyone but the
--      server; attendance-based counts are returned only to that person and their verified
--      guardian. "Confirmed adult" is profiles.age_cohort = 'adult' (the same value every other
--      age rule uses); anything else, including unknown, fails closed.
--
-- Additive and reversible: new helper functions and one trigger, policies re-created in the same
-- transaction (there is no moment without a policy), function bodies replaced in place.
-- docs/rollbacks/20261103120000_minor_review_privacy.down.sql restores the previous definitions.
-- Gym, team, trainer and adult-subject reviews are unchanged for adult authors.

-- ---------------------------------------------------------------------------
-- Policy helpers. Called from row-level security policies, so anon and authenticated need EXECUTE,
-- as with the other private_sec helpers. Fail closed: an unknown cohort is not an adult.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private_sec.review_subject_is_public(_kind text, _reviewee_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT CASE
    WHEN _kind IN ('player', 'host')
      THEN COALESCE(public.age_cohort_of(public.try_uuid(_reviewee_id)) = 'adult', false)
    ELSE true  -- teams, trainers, gyms and organizations are not people under 18
  END;
$$;

CREATE OR REPLACE FUNCTION private_sec.review_author_is_adult(_reviewer uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT COALESCE(public.age_cohort_of(_reviewer) = 'adult', false);
$$;

REVOKE ALL ON FUNCTION private_sec.review_subject_is_public(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION private_sec.review_author_is_adult(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.review_subject_is_public(text, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private_sec.review_author_is_adult(uuid) TO anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read policies. Rows stay in place; they stop being readable.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public reviews are viewable by everyone" ON public.reviews;
CREATE POLICY "Public reviews are viewable by everyone" ON public.reviews
  FOR SELECT TO public
  USING (
    is_private = false AND flagged = false
    AND private_sec.review_subject_is_public(reviewee_kind, reviewee_id)
    AND private_sec.review_author_is_adult(reviewer_id)
  );

-- Private reviews are only ever about adults now; a historical private review about someone
-- under 18 is not shown to them either, until a private-feedback workflow exists.
DROP POLICY IF EXISTS "Reviewees view their private reviews" ON public.reviews;
CREATE POLICY "Reviewees view their private reviews" ON public.reviews
  FOR SELECT TO authenticated
  USING (
    is_private = true
    AND reviewee_id = (auth.uid())::text
    AND reviewee_kind <> ALL (ARRAY['gym'::text, 'team'::text, 'org'::text, 'trainer_org'::text])
    AND private_sec.review_subject_is_public(reviewee_kind, reviewee_id)
  );

-- review_ai_analysis ("Analysis follows review visibility") reads reviews as the caller, so it
-- inherits the policies above and needs no change.

DROP POLICY IF EXISTS "Insights are public" ON public.reputation_insights;
CREATE POLICY "Insights are public" ON public.reputation_insights
  FOR SELECT TO public
  USING (private_sec.review_subject_is_public(reviewee_kind, reviewee_id));

-- ---------------------------------------------------------------------------
-- Authors: nobody under 18 (or of unconfirmed age) writes a review for now, of any kind,
-- gyms included. Named "aa_" so it fires before enforce_gym_review_trg and
-- enforce_review_integrity_trg and its message is the one a minor sees. The service role
-- (auth.uid() IS NULL) is not affected.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_adult_review_author()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF public.age_cohort_of(NEW.reviewer_id) IS DISTINCT FROM 'adult' THEN
    RAISE EXCEPTION 'Reviews are available to adults only for now.' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION public.enforce_adult_review_author() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_adult_review_author() TO service_role;

DROP TRIGGER IF EXISTS aa_enforce_adult_review_author_trg ON public.reviews;
CREATE TRIGGER aa_enforce_adult_review_author_trg
BEFORE INSERT ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.enforce_adult_review_author();

-- ---------------------------------------------------------------------------
-- Subject: the integrity trigger no longer coerces teen reviews to public and refuses any
-- subject who is not a confirmed adult. Replaced in place (the trigger stays bound to it);
-- everything else in the function is unchanged.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_review_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e record;
  k text;
  v numeric;
  _is_service boolean := auth.uid() IS NULL;
BEGIN
  IF NEW.reviewee_kind = 'gym' THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    -- Service role, moderators, and system writes (report_review, helpful-count
    -- trigger) may change moderation fields.
    IF _is_service OR pg_trigger_depth() > 1
       OR current_setting('app.review_system', true) = '1'
       OR public.is_moderator(auth.uid()) THEN
      RETURN NEW;
    END IF;
    -- Authors may only edit the content of their own review.
    NEW.reviewer_id := OLD.reviewer_id;   NEW.reviewee_id := OLD.reviewee_id;
    NEW.reviewee_kind := OLD.reviewee_kind; NEW.kind := OLD.kind;
    NEW.reviewee_name := OLD.reviewee_name; NEW.game_id := OLD.game_id;
    NEW.sport := OLD.sport; NEW.context := OLD.context;
    NEW.verified := OLD.verified; NEW.helpful_count := OLD.helpful_count;
    NEW.flagged := OLD.flagged; NEW.is_private := OLD.is_private;
    NEW.created_at := OLD.created_at;
  ELSE
    IF _is_service THEN RETURN NEW; END IF;

    IF NEW.reviewee_kind NOT IN ('player', 'host', 'trainer', 'team') THEN
      RAISE EXCEPTION 'Unsupported review type.' USING ERRCODE = '42501';
    END IF;

    -- PRIV-1: a person under 18, or whose age is not confirmed, is never the subject of a
    -- review, public or private. (Authors under 18 are refused by enforce_adult_review_author.)
    IF NEW.reviewee_kind IN ('player', 'host')
       AND public.age_cohort_of(public.try_uuid(NEW.reviewee_id)) IS DISTINCT FROM 'adult' THEN
      RAISE EXCEPTION 'Reviews are not available for this person.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO e FROM public.review_eligibility(NEW.reviewer_id, NEW.reviewee_kind, NEW.reviewee_id) x
     WHERE NEW.game_id IS NULL OR x.game_id = NEW.game_id
     ORDER BY x.happened_at DESC NULLS LAST LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'You can only review people you have played, trained or teamed up with.'
        USING ERRCODE = '42501';
    END IF;
    IF e.game_id IS NOT NULL AND e.happened_at < now() - interval '14 days' THEN
      RAISE EXCEPTION 'The 14-day review window for this game has closed.' USING ERRCODE = 'P0001';
    END IF;

    NEW.game_id := e.game_id;
    NEW.sport := e.sport;
    NEW.context := COALESCE(e.context, NEW.context);
    NEW.verified := true;
    NEW.flagged := false;
    NEW.helpful_count := 0;
    NEW.created_at := now();

    IF NEW.reviewee_kind NOT IN ('player', 'host') THEN NEW.is_private := false; END IF;

    IF (SELECT count(*) FROM public.reviews r
         WHERE r.reviewer_id = NEW.reviewer_id AND r.created_at > now() - interval '1 day') >= 20 THEN
      RAISE EXCEPTION 'Daily review limit reached. Try again tomorrow.' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  IF length(btrim(COALESCE(NEW.body, ''))) < 8 THEN
    RAISE EXCEPTION 'Review must be at least 8 characters.';
  END IF;
  IF length(NEW.body) > 2000 THEN
    RAISE EXCEPTION 'Review is too long (max 2000 characters).';
  END IF;
  IF NEW.title IS NOT NULL AND length(NEW.title) > 120 THEN
    RAISE EXCEPTION 'Title too long (max 120 characters).';
  END IF;

  IF jsonb_typeof(COALESCE(NEW.scores, '{}'::jsonb)) <> 'object' THEN
    RAISE EXCEPTION 'Invalid scores.';
  END IF;
  FOR k, v IN SELECT key, CASE WHEN jsonb_typeof(value) = 'number' THEN value::text::numeric END
                FROM jsonb_each(COALESCE(NEW.scores, '{}'::jsonb)) LOOP
    IF v IS NULL OR v < 1 OR v > 5 THEN
      RAISE EXCEPTION 'Scores must be between 1 and 5.';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;


-- Nobody under 18 is offered to review, and a minor is offered nobody.
CREATE OR REPLACE FUNCTION public.my_reviewable(_kind text DEFAULT NULL, _reviewee_id text DEFAULT NULL)
RETURNS TABLE (
  reviewee_kind text, reviewee_id text, reviewee_name text,
  game_id text, context text, sport text, happened_at timestamptz, closes_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE me uuid := auth.uid();
BEGIN
  -- Only an adult can be offered anyone to review (PRIV-1: no minor writes reviews for now).
  IF me IS NULL OR public.age_cohort_of(me) IS DISTINCT FROM 'adult' THEN RETURN; END IF;
  RETURN QUERY
  WITH cand AS (
    -- people from my recent games
    SELECT 'player'::text AS k, p.uid::text AS rid
      FROM (
        SELECT gp.user_id AS uid FROM public.game_participants gp
          JOIN public.game_participants mine ON mine.game_id = gp.game_id AND mine.user_id = me
        UNION SELECT g.host_id FROM public.hosted_games g
          JOIN public.game_participants mine ON mine.game_id = g.id AND mine.user_id = me
        UNION SELECT gp.user_id FROM public.game_participants gp
          JOIN public.hosted_games g ON g.id = gp.game_id AND g.host_id = me
      ) p WHERE p.uid <> me
    UNION
    SELECT 'host', g.host_id::text FROM public.hosted_games g
      JOIN public.game_participants mine ON mine.game_id = g.id AND mine.user_id = me
     WHERE g.host_id <> me
    UNION
    SELECT 'trainer', r.trainer_id FROM public.trainer_session_requests r
     WHERE r.from_user_id = me AND r.status IN ('accepted', 'completed')
    UNION
    SELECT 'team', m.team_id FROM public.team_members m WHERE m.user_id = me
  ), elig AS (
    SELECT c.k, c.rid, e.*
      FROM cand c, LATERAL public.review_eligibility(me, c.k, c.rid) e
     WHERE (_kind IS NULL OR c.k = _kind) AND (_reviewee_id IS NULL OR c.rid = _reviewee_id)
  )
  SELECT e.k, e.rid,
         COALESCE(
           (SELECT pr.display_name FROM public.profiles pr WHERE pr.id = public.try_uuid(e.rid)),
           (SELECT t.name FROM public.teams t WHERE t.id = e.rid), 'Unknown'),
         e.game_id, e.context, e.sport, e.happened_at,
         CASE WHEN e.game_id IS NOT NULL THEN e.happened_at + interval '14 days' END
    FROM elig e
   WHERE (e.game_id IS NULL OR e.happened_at > now() - interval '14 days')
     AND NOT EXISTS (
       SELECT 1 FROM public.reviews r
        WHERE r.reviewer_id = me AND r.reviewee_id = e.rid AND r.reviewee_kind = e.k
          AND r.game_id IS NOT DISTINCT FROM e.game_id)
     -- Nobody under 18, or of unconfirmed age, is offered as a person to review.
     AND (e.k NOT IN ('player', 'host') OR public.age_cohort_of(public.try_uuid(e.rid)) = 'adult')
   ORDER BY e.happened_at DESC NULLS LAST
   LIMIT 200;
END $$;

-- ---------------------------------------------------------------------------
-- Statistics. SECURITY DEFINER, so they read reviews past row-level security and must apply the
-- rule themselves. For a subject who is not a confirmed adult:
--   * review-derived fields (review count/average, trait counts) are zero for everyone except the
--     server (auth.uid() IS NULL);
--   * attendance-derived counts are returned only to that person and a verified guardian
--     (public.is_self_or_guardian), zero for everyone else.
-- The row keeps its shape so callers do not break. host_attendance_stats is unchanged: it holds no
-- review data and the host trust panel depends on it (minor hosts are handled in PRIV-2).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.player_activity_stats(_user uuid)
 RETURNS TABLE(games_joined integer, games_attended integer, no_shows integer, games_completed integer, hosted_total integer, hosted_completed integer, hosted_cancelled integer, teams_count integer, review_count integer, review_avg numeric, verified_review_count integer, first_activity_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
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
        AND private_sec.review_author_is_adult(reviewer_id)
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
$fn$;

CREATE OR REPLACE FUNCTION public.player_trait_counts(_user uuid)
 RETURNS TABLE(respectful integer, communicative integer, fair_play integer, positive integer, on_time integer)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
BEGIN
  IF NOT (auth.uid() IS NULL OR COALESCE(public.age_cohort_of(_user) = 'adult', false)) THEN
    RETURN QUERY SELECT 0, 0, 0, 0, 0;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    count(*) FILTER (WHERE 'respectful' = ANY (a.traits))::int,
    count(*) FILTER (WHERE 'communicative' = ANY (a.traits))::int,
    count(*) FILTER (WHERE 'fairPlay' = ANY (a.traits))::int,
    count(*) FILTER (WHERE 'positive' = ANY (a.traits))::int,
    count(*) FILTER (WHERE 'onTime' = ANY (a.traits))::int
  FROM public.reviews r
  JOIN public.review_ai_analysis a ON a.review_id = r.id
  WHERE r.reviewee_kind = 'player' AND r.reviewee_id = _user::text
    AND NOT r.flagged AND NOT r.is_private AND NOT a.mismatch
    AND private_sec.review_author_is_adult(r.reviewer_id);
END
$fn$;
