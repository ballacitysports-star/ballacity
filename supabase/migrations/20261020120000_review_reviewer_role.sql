-- Rating system: the reviewer's role is derived on the server.
--
-- `reviews.kind` (shown as the Player / Host / Trainer / Team badge on a review)
-- used to be whatever the client sent, so anyone who shared a game could post
-- as a "Trainer" or "Host". The insert path of enforce_review_integrity now
-- sets it from the eligibility row it already looks up. Everything else in the
-- function is unchanged from 20261012120000_review_integrity.sql. Updates
-- already keep `kind` fixed. There were no reviews in production when this was
-- written, so there is nothing to backfill.

CREATE OR REPLACE FUNCTION public.enforce_review_integrity()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  e record;
  k text;
  v numeric;
  _cohort text;
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
