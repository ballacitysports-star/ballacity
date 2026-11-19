-- An AI review summary (reputation_insights) is shown only while at least one of the reviews behind it can still be seen.
--
-- WHY. A summary is written from the reviewee's public, unflagged reviews (src/lib/review-ai.server.ts) and kept. Nothing hid
-- it afterwards: when those reviews were made private, flagged by moderation or deleted, the summary of them stayed readable to
-- everyone, signed-out visitors included. The read rule "Insights are public" (20261108100000) only checks minor protection
-- (private_sec.insight_is_publishable).
--
-- The sandbox carries an out-of-repo version of this change (ledger 20261118021038, "Insights follow review visibility") that
-- replaced the rule with "the reviewee, or any public review exists". That version drops the minor protection: a summary about
-- someone who was under 18, or of unknown age, would become readable again. This migration keeps the protection and adds the
-- review condition. It uses the same rule name, so applying it on the sandbox replaces that version.
--
-- WHAT.
-- 1. private_sec.insight_has_public_review(_kind, _reviewee_id): a review of that subject that is public, not flagged and
--    publishable under the minor rules (private_sec.review_is_publishable) exists now.
-- 2. One read rule, "Insights follow review visibility": insight_is_publishable AND insight_has_public_review. It replaces
--    "Insights are public" (and the sandbox's rule of the same new name), in one transaction.
-- Nothing is written to or deleted from any table.
--
-- Rollback: docs/rollbacks/20261120100000_insights_follow_review_visibility.down.sql.

CREATE OR REPLACE FUNCTION private_sec.insight_has_public_review(_kind text, _reviewee_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.reviews r
     WHERE r.reviewee_kind::text = _kind
       AND r.reviewee_id::text = _reviewee_id
       AND NOT r.is_private
       AND NOT r.flagged
       AND private_sec.review_is_publishable(r.id))
$$;
REVOKE ALL ON FUNCTION private_sec.insight_has_public_review(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_sec.insight_has_public_review(text, text) TO anon, authenticated, service_role;

DROP POLICY IF EXISTS "Insights are public" ON public.reputation_insights;
DROP POLICY IF EXISTS "Insights follow review visibility" ON public.reputation_insights;
CREATE POLICY "Insights follow review visibility" ON public.reputation_insights
  FOR SELECT TO public
  USING (private_sec.insight_is_publishable(reviewee_kind, reviewee_id)
         AND private_sec.insight_has_public_review(reviewee_kind, reviewee_id));
