-- ROLLBACK for supabase/migrations/20261108100000_minor_review_privacy.sql
--
-- NOT a migration: it lives outside supabase/migrations on purpose so no replay or migration tool runs it.
-- It restores the exact definitions that existed before PRIV-1 (captured from a replay of the
-- migrations that precede it) and removes what PRIV-1 added. No review, insight or analysis row is
-- changed by PRIV-1 or by this script.
--
-- THIS RE-OPENS THE EXPOSURE PRIV-1 CLOSES: reviews and AI summaries about people under 18 become
-- readable by anonymous visitors and by any signed-in account again, review statistics about them are
-- returned again, and minors may write and be the subject of reviews again. It therefore refuses to
-- run unless the session says, on purpose, that this is intended:
--
--     PGOPTIONS="-c app.confirm_reopen_minor_review_exposure=yes" psql ... -f <this file>
--
-- PREFER A FORWARD FIX. Narrow options that do NOT re-open any read access:
--   * the app change can be reverted on its own (the app works with either database state);
--   * if only the WRITE rules (no reviews by, or about, people under 18) must be relaxed, drop just that trigger:
--         DROP TRIGGER IF EXISTS aa_enforce_review_age_rules_trg ON public.reviews;
--     (the read policies and the statistics gates stay in force, so nothing becomes readable).
--
-- Do it only with the owner's explicit approval, record it, and add a ledger row.

BEGIN;

DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_minor_review_exposure', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback re-opens public access to reviews and AI summaries about people under 18. Read the header of this file; to proceed deliberately set app.confirm_reopen_minor_review_exposure=yes for the session.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS aa_enforce_review_age_rules_trg ON public.reviews;
DROP FUNCTION IF EXISTS public.enforce_review_age_rules();

CREATE OR REPLACE FUNCTION public.enforce_review_integrity()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  e record;
  k text;
  v numeric;
  _cohort text;
  _is_service boolean := auth.uid() IS NULL;
BEGIN
  IF NEW.reviewee_kind = 'gym' THEN
    -- Gym reviews are stars + text only; keep the structured columns empty.
    NEW.recommend := NULL; NEW.answers := '{}'::jsonb; NEW.tags := '{}';
    RETURN NEW;
  END IF;

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
    NEW.recommend := OLD.recommend; NEW.answers := OLD.answers; NEW.tags := OLD.tags;
  ELSE
    IF _is_service THEN RETURN NEW; END IF;

    IF NEW.reviewee_kind NOT IN ('player', 'host', 'trainer', 'team') THEN
      RAISE EXCEPTION 'Unsupported review type.' USING ERRCODE = '42501';
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
    -- Role is derived from the shared activity, never taken from the client:
    -- the host of the reviewed game reviews as 'host', everyone else as 'player'.
    IF NEW.reviewee_kind = 'player' AND e.game_id IS NOT NULL AND EXISTS (
         SELECT 1 FROM public.hosted_games g
          WHERE g.id = e.game_id AND g.host_id = NEW.reviewer_id) THEN
      NEW.kind := 'host';
    ELSE
      NEW.kind := 'player';
    END IF;
    NEW.sport := e.sport;
    NEW.context := COALESCE(e.context, NEW.context);

    -- Structured answers: only this kind's questions and tags, known values.
    IF jsonb_typeof(COALESCE(NEW.answers, '{}'::jsonb)) <> 'object' THEN
      RAISE EXCEPTION 'Invalid answers.';
    END IF;
    FOR k IN SELECT jsonb_object_keys(COALESCE(NEW.answers, '{}'::jsonb)) LOOP
      IF NOT (k = ANY (public.review_question_keys(NEW.reviewee_kind)))
         OR (NEW.answers ->> k) NOT IN ('yes', 'mostly', 'no') THEN
        RAISE EXCEPTION 'Invalid answers.';
      END IF;
    END LOOP;
    NEW.answers := COALESCE(NEW.answers, '{}'::jsonb);
    NEW.tags := COALESCE(NEW.tags, '{}');
    IF cardinality(NEW.tags) > 5 THEN
      RAISE EXCEPTION 'Pick up to 5 tags.';
    END IF;
    IF EXISTS (SELECT 1 FROM unnest(NEW.tags) t
                WHERE t IS NULL OR NOT (t = ANY (public.review_tag_keys(NEW.reviewee_kind)))) THEN
      RAISE EXCEPTION 'Invalid tags.';
    END IF;
    NEW.tags := ARRAY(SELECT DISTINCT t FROM unnest(NEW.tags) t ORDER BY t);
    NEW.verified := true;
    NEW.flagged := false;
    NEW.helpful_count := 0;
    NEW.created_at := now();

    -- Minors: no under-13 reviewers or reviewees; teens are never sent private feedback.
    IF public.age_cohort_of(NEW.reviewer_id) = 'child_under_13' THEN
      RAISE EXCEPTION 'Reviews are not available for this account.' USING ERRCODE = '42501';
    END IF;
    IF NEW.reviewee_kind IN ('player', 'host') THEN
      _cohort := public.age_cohort_of(public.try_uuid(NEW.reviewee_id));
      IF _cohort = 'child_under_13' THEN
        RAISE EXCEPTION 'Reviews are not available for this player.' USING ERRCODE = '42501';
      END IF;
      IF _cohort <> 'adult' AND NEW.is_private THEN
        NEW.is_private := false;
      END IF;
    END IF;
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
END $function$;

CREATE OR REPLACE FUNCTION public.my_reviewable(_kind text DEFAULT NULL::text, _reviewee_id text DEFAULT NULL::text)
 RETURNS TABLE(reviewee_kind text, reviewee_id text, reviewee_name text, game_id text, context text, sport text, happened_at timestamp with time zone, closes_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE me uuid := auth.uid();
BEGIN
  IF me IS NULL THEN RETURN; END IF;
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
     AND (e.k NOT IN ('player', 'host') OR public.age_cohort_of(public.try_uuid(e.rid)) <> 'child_under_13')
   ORDER BY e.happened_at DESC NULLS LAST
   LIMIT 200;
END $function$;

CREATE OR REPLACE FUNCTION public.player_activity_stats(_user uuid)
 RETURNS TABLE(games_joined integer, games_attended integer, no_shows integer, games_completed integer, hosted_total integer, hosted_completed integer, hosted_cancelled integer, teams_count integer, review_count integer, review_avg numeric, verified_review_count integer, first_activity_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    );
$function$;

CREATE OR REPLACE FUNCTION public.player_trait_counts(_user uuid)
 RETURNS TABLE(respectful integer, communicative integer, fair_play integer, positive integer, on_time integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    count(*) FILTER (WHERE 'respectful' = ANY (a.traits) OR 'respectful' = ANY (r.tags))::int,
    count(*) FILTER (WHERE 'communicative' = ANY (a.traits) OR 'communicative' = ANY (r.tags))::int,
    count(*) FILTER (WHERE 'fairPlay' = ANY (a.traits) OR 'fairPlay' = ANY (r.tags))::int,
    count(*) FILTER (WHERE 'positive' = ANY (a.traits) OR 'positive' = ANY (r.tags))::int,
    count(*) FILTER (WHERE 'onTime' = ANY (a.traits) OR 'onTime' = ANY (r.tags))::int
  FROM public.reviews r
  LEFT JOIN public.review_ai_analysis a ON a.review_id = r.id
  WHERE r.reviewee_kind = 'player' AND r.reviewee_id = _user::text
    AND NOT r.flagged AND NOT r.is_private AND NOT COALESCE(a.mismatch, false);
$function$;

DROP POLICY IF EXISTS "Public reviews are viewable by everyone" ON public.reviews;
CREATE POLICY "Public reviews are viewable by everyone" ON public.reviews FOR SELECT TO public
  USING (((is_private = false) AND (flagged = false)));

DROP POLICY IF EXISTS "Reviewees view their private reviews" ON public.reviews;
-- As hotfix 0032 left it (drizzle/migrations/0032_hotfix_close_write_paths.sql): a review held for screening stays
-- hidden from its subject. Restoring the older form here would reopen that gap.
CREATE POLICY "Reviewees view their private reviews" ON public.reviews FOR SELECT TO authenticated
  USING (
    is_private = true
    AND flagged = false
    AND reviewee_id = (auth.uid())::text
    AND reviewee_kind NOT IN ('gym', 'team', 'org', 'trainer_org')
  );

DROP POLICY IF EXISTS "Insights are public" ON public.reputation_insights;
CREATE POLICY "Insights are public" ON public.reputation_insights FOR SELECT TO public
  USING (true);

DROP POLICY IF EXISTS "Gym admins view reviews about their gym" ON public.reviews;
CREATE POLICY "Gym admins view reviews about their gym" ON public.reviews FOR SELECT TO authenticated
  USING (((reviewee_kind = 'gym'::text) AND is_gym_admin_text(reviewee_id, auth.uid())));

CREATE OR REPLACE FUNCTION public.host_attendance_stats(_host uuid)
 RETURNS TABLE(marked bigint, attended bigint, cancelled_games bigint, completed_games bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT
    (SELECT COUNT(*) FROM public.game_participants gp
       JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE g.host_id = _host AND gp.attended IS NOT NULL),
    (SELECT COUNT(*) FROM public.game_participants gp
       JOIN public.hosted_games g ON g.id = gp.game_id
      WHERE g.host_id = _host AND gp.attended IS TRUE),
    (SELECT COUNT(*) FROM public.hosted_games WHERE host_id = _host AND cancelled_at IS NOT NULL),
    (SELECT COUNT(*) FROM public.hosted_games WHERE host_id = _host AND completed_at IS NOT NULL)
$function$;

-- Persistent-protection objects. The two minor_protected COLUMNS are deliberately KEPT: they record which content was
-- written by or about a minor and must not be thrown away by a rollback. Nothing reads them once the policies above
-- are restored, so keeping them is harmless; re-applying the migration reuses them.
DROP TRIGGER IF EXISTS aa_review_minor_protected_trg ON public.reviews;
DROP TRIGGER IF EXISTS aa_insight_minor_protected_trg ON public.reputation_insights;
DROP FUNCTION IF EXISTS public.set_review_minor_protected();
DROP FUNCTION IF EXISTS public.set_insight_minor_protected();
DROP FUNCTION IF EXISTS public.publishable_review_ids(uuid[]);
DROP FUNCTION IF EXISTS private_sec.insight_is_publishable(text, text);
DROP FUNCTION IF EXISTS private_sec.review_is_publishable(uuid);
DROP FUNCTION IF EXISTS private_sec.review_was_minor_involved(timestamptz, uuid, text, text);
DROP FUNCTION IF EXISTS private_sec.subject_was_minor_at(text, text, timestamptz);
DROP FUNCTION IF EXISTS private_sec.was_minor_at(uuid, timestamptz);
DROP FUNCTION IF EXISTS private_sec.review_subject_is_public(text, text);
DROP FUNCTION IF EXISTS private_sec.review_author_is_adult(uuid);

COMMIT;
