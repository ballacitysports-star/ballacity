-- ROLLBACK for supabase/migrations/20261120100000_insights_follow_review_visibility.sql.
-- NOT a migration. It puts back the read rule "Insights are public" from 20261108100000 (minor protection only) and drops
-- private_sec.insight_has_public_review. Summaries whose reviews were made private, flagged or deleted become readable again
-- to everyone, as before. Nothing is written to or deleted from any table.
-- It stops, changing nothing, if the rule or the helper no longer has the definition 20261120100000 gave it (a later change
-- needs a person to look first), and refuses to run unless the session sets the confirmation first:
--     SET app.confirm_insights_visibility_rollback = 'yes';
BEGIN;
DO $guard$
DECLARE
  _rule text;
  _fn text;
BEGIN
  IF current_setting('app.confirm_insights_visibility_rollback', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this makes summaries of hidden reviews readable again. Set app.confirm_insights_visibility_rollback=yes for the session to proceed deliberately.';
  END IF;
  SELECT md5(pg_get_expr(polqual, polrelid)) INTO _rule
    FROM pg_policy WHERE polrelid = 'public.reputation_insights'::regclass AND polname = 'Insights follow review visibility';
  IF _rule IS DISTINCT FROM '7d26571e4e770dd9742df67e6b7798e9' THEN
    RAISE EXCEPTION 'Refusing to run: the rule "Insights follow review visibility" is not the one 20261120100000 created (md5 %). A later change needs a person to look first.', _rule;
  END IF;
  SELECT md5(pg_get_functiondef(p.oid)) INTO _fn
    FROM pg_proc p WHERE p.oid = to_regprocedure('private_sec.insight_has_public_review(text,text)');
  IF _fn IS DISTINCT FROM 'f9ad6bdf5215d7a3151e350520d235f1' THEN
    RAISE EXCEPTION 'Refusing to run: private_sec.insight_has_public_review is not the definition 20261120100000 created (md5 %).', _fn;
  END IF;
END
$guard$;

SET LOCAL lock_timeout = '5s';

DROP POLICY "Insights follow review visibility" ON public.reputation_insights;
CREATE POLICY "Insights are public" ON public.reputation_insights
  FOR SELECT TO public
  USING (private_sec.insight_is_publishable(reviewee_kind, reviewee_id));
DROP FUNCTION private_sec.insight_has_public_review(text, text);

COMMIT;
