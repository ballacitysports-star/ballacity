-- Fix: helpful-vote counts on reviews were wrong in two ways.
--
-- 1. Votes on ordinary reviews counted TWICE (and un-votes subtracted twice).
--    review_helpfuls has two identical AFTER INSERT OR DELETE triggers that both
--    call bump_helpful_count(): trg_review_helpfuls_count from the first reviews
--    migration, and bump_helpful_count_trg, added again with gym reviews
--    (20260730162842) without noticing the first. The duplicate is dropped.
-- 2. Votes on gym reviews NEVER counted. enforce_gym_review() resets
--    helpful_count on every UPDATE, including the vote counter's own UPDATE, so
--    the increment was silently undone. System updates (nested trigger updates
--    and report_review) now pass through, the same guard enforce_review_integrity
--    already has; direct edits by an author are still locked exactly as before.
--    The rest of the function is unchanged.
--
-- There were no reviews in production when this was written, so there are no
-- wrong counts to repair.

DROP TRIGGER IF EXISTS bump_helpful_count_trg ON public.review_helpfuls;

CREATE OR REPLACE FUNCTION public.enforce_gym_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
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
$$;
