-- Lovable rollback, hotfix 20261031120000 (PR #287), part 3 of 4: review screening hold (reviews).
-- RE-OPENS F12: a review written straight through the API is public again without screening.
-- PUBLISH THE PREVIOUS APP BUILD FIRST: the #287 build relies on the hold; without it, reviews the AI screening sends
-- for human review would be published. The previous build works with either database state.
-- Only with the owner's explicit approval, and recorded. Send this whole file to Lovable's agent as one migration,
-- unchanged (docs/release/hotfix-286-287-runbook.md, section 7). It is one statement, so it applies whole or not at all.
-- Reviews still held for screening stay flagged (hidden); the notice gives their number, and superadmins decide them in
-- Moderation (reviews, hidden only). The policies are restored exactly as main defined them (20261012120000 and
-- 20260915225632).
DO $rollback$
DECLARE
  _n integer;
BEGIN
  IF to_regclass('private_sec.review_screening_holds') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM private_sec.review_screening_holds h JOIN public.reviews r ON r.id = h.review_id
              WHERE r.flagged AND NOT h.keep_flagged' INTO _n;
    RAISE NOTICE '% review(s) held only for screening stay flagged (hidden); decide them in Moderation (reviews, hidden only)', _n;
  END IF;
  DROP TRIGGER IF EXISTS zz_reviews_hold_for_screening ON public.reviews;
  DROP FUNCTION IF EXISTS public.hold_review_for_screening();
  DROP POLICY IF EXISTS "Users can write reviews as themselves" ON public.reviews;
  CREATE POLICY "Users can write reviews as themselves" ON public.reviews
    FOR INSERT TO authenticated
    WITH CHECK (reviewer_id = auth.uid() AND flagged = false);
  DROP POLICY IF EXISTS "Reviewees view their private reviews" ON public.reviews;
  CREATE POLICY "Reviewees view their private reviews"
  ON public.reviews
  FOR SELECT
  TO authenticated
  USING (
    is_private = true
    AND reviewee_id = (auth.uid())::text
    AND reviewee_kind NOT IN ('gym', 'team', 'org', 'trainer_org')
  );
  DROP FUNCTION IF EXISTS public.release_review_screening(uuid, text, text);
  DROP FUNCTION IF EXISTS private_sec.review_is_held(uuid);
  DROP FUNCTION IF EXISTS private_sec.record_review_hold(uuid, boolean);
  DROP TABLE IF EXISTS private_sec.review_screening_holds;
  IF to_regprocedure('public.hold_review_for_screening()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'zz_reviews_hold_for_screening')
     OR to_regprocedure('public.release_review_screening(uuid,text,text)') IS NOT NULL
     OR to_regprocedure('private_sec.review_is_held(uuid)') IS NOT NULL
     OR to_regprocedure('private_sec.record_review_hold(uuid,boolean)') IS NOT NULL
     OR to_regclass('private_sec.review_screening_holds') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback of 20261031120000 part 3 incomplete';
  END IF;
END
$rollback$;
