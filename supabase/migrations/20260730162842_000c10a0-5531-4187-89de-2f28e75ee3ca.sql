-- Allow gym as a review subject
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_kind_check;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_kind_check
  CHECK (kind = ANY (ARRAY['player','trainer','team','host','gym']));
ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS reviews_reviewee_kind_check;
ALTER TABLE public.reviews ADD CONSTRAINT reviews_reviewee_kind_check
  CHECK (reviewee_kind = ANY (ARRAY['player','trainer','team','host','gym']));

CREATE UNIQUE INDEX IF NOT EXISTS reviews_one_per_gym_idx
  ON public.reviews (reviewer_id, reviewee_id) WHERE reviewee_kind = 'gym';

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reviews TO authenticated;
GRANT SELECT ON public.reviews TO anon;
GRANT ALL ON public.reviews TO service_role;
GRANT SELECT, INSERT, DELETE ON public.review_helpfuls TO authenticated;
GRANT ALL ON public.review_helpfuls TO service_role;

-- Safe uuid cast for text reviewee ids
CREATE OR REPLACE FUNCTION public.try_uuid(_v text)
RETURNS uuid LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
BEGIN
  RETURN _v::uuid;
EXCEPTION WHEN others THEN
  RETURN NULL;
END;
$$;

-- A visit is "verified" when the reviewer is a member of the gym, a trainer in
-- the gym, or has an accepted/completed session with one of its trainers.
CREATE OR REPLACE FUNCTION public.has_verified_gym_visit(_org uuid, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _org IS NOT NULL AND _user IS NOT NULL AND (
    EXISTS (SELECT 1 FROM public.org_members WHERE org_id = _org AND user_id = _user)
    OR EXISTS (SELECT 1 FROM public.trainer_org_members WHERE org_id = _org AND user_id = _user)
    OR EXISTS (
      SELECT 1 FROM public.trainer_session_requests r
      JOIN public.trainer_org_members m ON m.trainer_id = r.trainer_id
      WHERE m.org_id = _org AND r.from_user_id = _user
        AND r.status IN ('accepted','completed')
    )
  );
$$;

CREATE OR REPLACE FUNCTION public.is_gym_admin_text(_reviewee_id text, _user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT _user IS NOT NULL
     AND public.try_uuid(_reviewee_id) IS NOT NULL
     AND public.is_trainer_org_admin(public.try_uuid(_reviewee_id), _user);
$$;

-- Validate gym reviews and stamp the verified-visit badge server side.
CREATE OR REPLACE FUNCTION public.enforce_gym_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _org uuid;
BEGIN
  IF NEW.reviewee_kind <> 'gym' THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.reviewer_id   := OLD.reviewer_id;
    NEW.reviewee_id   := OLD.reviewee_id;
    NEW.reviewee_kind := OLD.reviewee_kind;
    NEW.helpful_count := OLD.helpful_count;
    NEW.verified      := OLD.verified;
    IF auth.uid() = OLD.reviewer_id THEN
      NEW.flagged := OLD.flagged;
    END IF;
  END IF;

  _org := public.try_uuid(NEW.reviewee_id);
  IF _org IS NULL OR NOT EXISTS (SELECT 1 FROM public.trainer_orgs WHERE id = _org) THEN
    RAISE EXCEPTION 'Unknown gym.' USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.flagged := false;
    NEW.helpful_count := 0;
    NEW.is_private := false;
    IF EXISTS (SELECT 1 FROM public.trainer_orgs WHERE id = _org AND owner_id = NEW.reviewer_id) THEN
      RAISE EXCEPTION 'You cannot review your own gym.' USING ERRCODE = '42501';
    END IF;
    NEW.verified := public.has_verified_gym_visit(_org, NEW.reviewer_id);
  END IF;

  IF length(btrim(COALESCE(NEW.body,''))) < 10 THEN
    RAISE EXCEPTION 'Review must be at least 10 characters.';
  END IF;
  IF length(NEW.body) > 2000 THEN
    RAISE EXCEPTION 'Review is too long (max 2000 characters).';
  END IF;
  IF NEW.title IS NOT NULL AND length(NEW.title) > 120 THEN
    RAISE EXCEPTION 'Title too long (max 120 characters).';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_gym_review_trg ON public.reviews;
CREATE TRIGGER enforce_gym_review_trg
BEFORE INSERT OR UPDATE ON public.reviews
FOR EACH ROW EXECUTE FUNCTION public.enforce_gym_review();

DROP TRIGGER IF EXISTS bump_helpful_count_trg ON public.review_helpfuls;
CREATE TRIGGER bump_helpful_count_trg
AFTER INSERT OR DELETE ON public.review_helpfuls
FOR EACH ROW EXECUTE FUNCTION public.bump_helpful_count();

-- Authors may edit or remove their own review
DROP POLICY IF EXISTS "Authors update their own reviews" ON public.reviews;
CREATE POLICY "Authors update their own reviews" ON public.reviews
FOR UPDATE TO authenticated
USING (reviewer_id = auth.uid()) WITH CHECK (reviewer_id = auth.uid());

DROP POLICY IF EXISTS "Authors delete their own reviews" ON public.reviews;
CREATE POLICY "Authors delete their own reviews" ON public.reviews
FOR DELETE TO authenticated
USING (reviewer_id = auth.uid());

-- Gym owners/admins can see hidden reviews about their gym so they can moderate
DROP POLICY IF EXISTS "Gym admins view reviews about their gym" ON public.reviews;
CREATE POLICY "Gym admins view reviews about their gym" ON public.reviews
FOR SELECT TO authenticated
USING (reviewee_kind = 'gym' AND public.is_gym_admin_text(reviewee_id, auth.uid()));

-- Moderation: hide/unhide a gym review (gym admins or platform moderators)
CREATE OR REPLACE FUNCTION public.moderate_gym_review(_review_id uuid, _hidden boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _me uuid := auth.uid();
  _r public.reviews%ROWTYPE;
BEGIN
  IF _me IS NULL THEN RAISE EXCEPTION 'Not authenticated' USING ERRCODE = '28000'; END IF;
  SELECT * INTO _r FROM public.reviews WHERE id = _review_id AND reviewee_kind = 'gym';
  IF _r.id IS NULL THEN RAISE EXCEPTION 'Review not found'; END IF;
  IF NOT (public.is_gym_admin_text(_r.reviewee_id, _me)
          OR public.has_role(_me, 'admin') OR public.has_role(_me, 'moderator')) THEN
    RAISE EXCEPTION 'Only gym owners/admins can moderate this review' USING ERRCODE = '42501';
  END IF;
  UPDATE public.reviews SET flagged = _hidden WHERE id = _review_id;
END;
$$;