-- Rating system, phase 1: make reviews real and server-verified.
--
-- Before this migration the INSERT policy on public.reviews only checked
-- reviewer_id = auth.uid(), so anyone could review anyone, repeatedly, with
-- verified = true. Eligibility is now decided in the database, the same way
-- enforce_gym_review does it for gyms:
--   player  -> both people were in a started game together (attended not false)
--   host    -> reviewer was in a started game run by that host
--   trainer -> reviewer has an accepted/completed session with that trainer
--   team    -> reviewer is a team member
-- Reviews are verified by construction, one per (reviewer, reviewee, game),
-- and game reviews close 14 days after the game.

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS game_id text,
  ADD COLUMN IF NOT EXISTS sport text;

-- One review per person per game; one standing review per trainer/team.
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_game_idx
  ON public.reviews (reviewer_id, reviewee_id, reviewee_kind, game_id)
  WHERE game_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_standing_idx
  ON public.reviews (reviewer_id, reviewee_id, reviewee_kind)
  WHERE game_id IS NULL AND reviewee_kind IN ('trainer', 'team');
CREATE INDEX IF NOT EXISTS reviews_reviewer_created_idx
  ON public.reviews (reviewer_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Eligibility: what can `_reviewer` legitimately review right now?
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_eligibility(
  _reviewer uuid, _kind text, _reviewee_id text
)
RETURNS TABLE (game_id text, context text, sport text, happened_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _reviewee uuid := public.try_uuid(_reviewee_id);
BEGIN
  IF _reviewer IS NULL OR _reviewee_id IS NULL OR _reviewee_id = _reviewer::text THEN
    RETURN;
  END IF;

  IF _kind = 'player' AND _reviewee IS NOT NULL THEN
    RETURN QUERY
    WITH people AS (
      SELECT gp.game_id AS gid, gp.user_id AS uid
        FROM public.game_participants gp WHERE gp.attended IS DISTINCT FROM false
      UNION
      SELECT g.id, g.host_id FROM public.hosted_games g
    )
    SELECT g.id, g.title, g.sport, COALESCE(g.completed_at, g.ends_at, g.date)
      FROM public.hosted_games g
      JOIN people a ON a.gid = g.id AND a.uid = _reviewer
      JOIN people b ON b.gid = g.id AND b.uid = _reviewee
     WHERE g.cancelled_at IS NULL AND g.date <= now();

  ELSIF _kind = 'host' AND _reviewee IS NOT NULL THEN
    RETURN QUERY
    SELECT g.id, g.title, g.sport, COALESCE(g.completed_at, g.ends_at, g.date)
      FROM public.hosted_games g
      JOIN public.game_participants gp ON gp.game_id = g.id AND gp.user_id = _reviewer
     WHERE g.host_id = _reviewee AND gp.attended IS DISTINCT FROM false
       AND g.cancelled_at IS NULL AND g.date <= now();

  ELSIF _kind = 'trainer' THEN
    RETURN QUERY
    SELECT NULL::text, r.session_type, NULL::text, r.updated_at
      FROM public.trainer_session_requests r
     WHERE r.trainer_id = _reviewee_id AND r.from_user_id = _reviewer
       AND r.status IN ('accepted', 'completed')
     ORDER BY r.updated_at DESC LIMIT 1;

  ELSIF _kind = 'team' THEN
    RETURN QUERY
    SELECT NULL::text, t.name, NULL::text, m.created_at
      FROM public.team_members m JOIN public.teams t ON t.id = m.team_id
     WHERE m.team_id = _reviewee_id AND m.user_id = _reviewer;
  END IF;
END $$;

REVOKE ALL ON FUNCTION public.review_eligibility(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Client-facing: everything the signed-in user may review and hasn't yet.
CREATE OR REPLACE FUNCTION public.my_reviewable(_kind text DEFAULT NULL, _reviewee_id text DEFAULT NULL)
RETURNS TABLE (
  reviewee_kind text, reviewee_id text, reviewee_name text,
  game_id text, context text, sport text, happened_at timestamptz, closes_at timestamptz
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
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
END $$;

REVOKE ALL ON FUNCTION public.my_reviewable(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_reviewable(text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- Insert/update guard for every non-gym review (gyms keep enforce_gym_review).
-- ---------------------------------------------------------------------------
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

DROP TRIGGER IF EXISTS enforce_review_integrity_trg ON public.reviews;
CREATE TRIGGER enforce_review_integrity_trg
BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.enforce_review_integrity();

-- The old policy let non-gym inserts through unchecked; the trigger is the gate
-- now, but also stop authors self-flagging/self-verifying via the WITH CHECK.
DROP POLICY IF EXISTS "Users can write reviews as themselves" ON public.reviews;
CREATE POLICY "Users can write reviews as themselves" ON public.reviews
  FOR INSERT TO authenticated
  WITH CHECK (reviewer_id = auth.uid() AND flagged = false);

-- ---------------------------------------------------------------------------
-- Reports: any signed-in user can report a review; three distinct reporters
-- hide it pending moderator review. Replaces the client-side "flag" toggle.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.review_reports (
  review_id uuid NOT NULL REFERENCES public.reviews(id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (review_id, reporter_id)
);
GRANT ALL ON public.review_reports TO service_role;
ALTER TABLE public.review_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Moderators read review reports" ON public.review_reports
  FOR SELECT TO authenticated USING (public.is_moderator(auth.uid()));

CREATE OR REPLACE FUNCTION public.report_review(_review_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to report.' USING ERRCODE = '42501'; END IF;
  INSERT INTO public.review_reports (review_id, reporter_id)
    VALUES (_review_id, auth.uid()) ON CONFLICT DO NOTHING;
  SELECT count(*) INTO _n FROM public.review_reports WHERE review_id = _review_id;
  IF _n >= 3 THEN
    PERFORM set_config('app.review_system', '1', true);
    UPDATE public.reviews SET flagged = true WHERE id = _review_id;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.report_review(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_review(uuid) TO authenticated;
