-- Capture of production's enforce_gym_review().
--
-- DRIFT. Production's version lets system updates through the author-edit lock; the version in this repository
-- (20260730162842) does not. A database rebuilt from source therefore silently ignores a helpful vote on a gym review
-- (the vote counter is an UPDATE issued from inside a trigger, and the lock rolls helpful_count back to its old value)
-- and a flag raised through report_review is undone whenever the reporter is the review's author. Production was fixed by hand;
-- the fix was never written down.
--
-- WHAT THIS DOES. Replaces the function with production's exact text (verified 2026-11-03: pg_get_functiondef md5
-- 1c776a864a0f9e4aac3d17d45cf31c9f, owner postgres, SECURITY DEFINER, search_path = public, trigger function, no
-- arguments) and states its grants. ON PRODUCTION THIS CHANGES NOTHING: the definition is already identical and
-- CREATE OR REPLACE keeps the owner and privileges. Idempotent; does not touch the trigger, table or any data.
--
-- GRANTS. Trigger function: nobody calls it; EXECUTE for service_role only. (Firing a trigger does not check EXECUTE.)
--
-- The two bypasses (trigger depth > 1, and app.review_system = '1') are production's behaviour, kept as is. The GUC
-- cannot be set through the API (only SQL running as a database role can set it), and depth > 1 is reached only by
-- another trigger; see supabase/tests/350_drift_capture_review_functions.test.sql.
CREATE OR REPLACE FUNCTION public.enforce_gym_review()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org uuid;
BEGIN
  IF NEW.reviewee_kind <> 'gym' THEN RETURN NEW; END IF;

  -- System updates must not be rolled back by the author-edit lock below: the
  -- helpful-vote counter (an UPDATE issued from inside a trigger) and
  -- report_review (flags the row under app.review_system).
  IF TG_OP = 'UPDATE' AND (pg_trigger_depth() > 1
       OR current_setting('app.review_system', true) = '1') THEN
    RETURN NEW;
  END IF;

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
$function$;

REVOKE ALL ON FUNCTION public.enforce_gym_review() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_gym_review() TO service_role;
