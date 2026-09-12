-- Back-filled into git on 2026-09-12. Not authored here.
--
-- This migration was applied directly to the production project by the Lovable
-- agent (created_by apikey@lovable.dev, version 20260910195642) and existed in
-- no branch of this repository. It is recorded here verbatim so `supabase db
-- push` recognises it as already applied instead of trying to replay a history
-- the database has already moved past.
--
-- Effect: the trainer_orgs SELECT policy was `USING (true)`, so soft-hiding an
-- org left it readable. It now respects hidden_at, with escapes for the owner,
-- org admins, org members and moderators.
--
-- Interaction with this branch: an unclaimed gym (owner_id IS NULL, hidden_at
-- IS NULL) still satisfies `hidden_at IS NULL`, so it stays visible. Verified
-- against a full replay: this policy is TO authenticated, and the separate
-- "orgs are publicly viewable" policy from 20260719235808 is TO anon and
-- already filters hidden_at, so the two cover disjoint roles and the soft-hide
-- holds for both. The unclaimed-listings work is unaffected.

DROP POLICY IF EXISTS "orgs are viewable by authenticated" ON public.trainer_orgs;
DROP POLICY IF EXISTS "orgs are viewable by signed-in users" ON public.trainer_orgs;

CREATE POLICY "Visible orgs viewable by signed-in users"
ON public.trainer_orgs
FOR SELECT
TO authenticated
USING (
  hidden_at IS NULL
  OR owner_id = auth.uid()
  OR public.is_trainer_org_admin(id, auth.uid())
  OR public.is_trainer_org_member(id, auth.uid())
  OR public.is_moderator(auth.uid())
);
