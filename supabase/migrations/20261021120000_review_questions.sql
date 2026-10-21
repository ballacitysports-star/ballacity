-- Rating system, step 2: structured review questions.
--
-- Replaces the ten 1-5 criterion sliders with a headline question (would you
-- do this with them again?), three yes/mostly/no behaviour questions and up to
-- five praise tags. Three new columns on public.reviews; `scores` stays for
-- older reviews and is no longer written by the form.
--
-- Backward compatible on purpose: every new column is nullable/defaulted and
-- the trigger only validates what is present, so the review form that is live
-- today keeps working until the new one ships. (The server function, not the
-- database, requires the headline answer.)
--
-- The key lists below must match src/lib/review-questions.ts; the test in
-- review-questions.test.ts reads this file and fails if they drift.

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS recommend text,
  ADD COLUMN IF NOT EXISTS answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}';

ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_recommend_check;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_recommend_check
  CHECK (recommend IS NULL OR recommend IN ('yes', 'not_sure', 'no'));

CREATE OR REPLACE FUNCTION public.review_question_keys(_kind text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _kind
    WHEN 'player' THEN ARRAY['fair','respect','teammate']
    WHEN 'host' THEN ARRAY['accurate','fairRules','safe']
    WHEN 'trainer' THEN ARRAY['clear','value','safe']
    WHEN 'team' THEN ARRAY['organised','playingTime','welcoming']
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION public.review_tag_keys(_kind text)
RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE _kind
    WHEN 'player' THEN ARRAY['respectful','communicative','fairPlay','positive','onTime','teamPlayer','hustle','welcoming']
    WHEN 'host' THEN ARRAY['organized','fairTeams','clearComms','wellRun','greatVenue','welcomingHost']
    WHEN 'trainer' THEN ARRAY['knowledgeable','motivating','patient','explainsClearly','prepared','safetyMinded']
    WHEN 'team' THEN ARRAY['organized','welcomingTeam','fairPlayingTime','goodCoaching','competitive','fun']
    ELSE ARRAY[]::text[]
  END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_review_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
END $$;


-- Sportsmanship badge traits now count praise tags as well as the AI's reading
-- of the review text. Player tags that match a trait use the trait's own key.
-- A review that has both counts once; reviews the AI marked as contradicting
-- their stars are still left out.
CREATE OR REPLACE FUNCTION public.player_trait_counts(_user uuid)
RETURNS TABLE (respectful int, communicative int, fair_play int, positive int, on_time int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
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
$$;
