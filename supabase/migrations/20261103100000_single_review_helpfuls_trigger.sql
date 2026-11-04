-- One helpful-count trigger on review_helpfuls, not two.
--
-- Source history: 20260603182324 creates trg_review_helpfuls_count, and 20260730162842 creates a
-- second trigger, bump_helpful_count_trg, that runs the same bump_helpful_count() on the same
-- events. Both fire on every vote, so a database rebuilt from this repository increments (and
-- decrements) reviews.helpful_count twice per vote.
--
-- Production has only trg_review_helpfuls_count: the duplicate was removed there by hand and the
-- removal was never written down. This migration records it. It is a no-op on production and
-- changes no data (production has no reviews, so no counts need repair).
--
-- The surviving trigger is the original one, trg_review_helpfuls_count. If a database somehow has
-- only the later one, the original is created first so the count is never left unmaintained.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.review_helpfuls'::regclass
      AND tgname = 'trg_review_helpfuls_count'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER trg_review_helpfuls_count
      AFTER INSERT OR DELETE ON public.review_helpfuls
      FOR EACH ROW EXECUTE FUNCTION public.bump_helpful_count();
  END IF;
END $$;

DROP TRIGGER IF EXISTS bump_helpful_count_trg ON public.review_helpfuls;
