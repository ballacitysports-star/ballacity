-- 1. Messages: drop realtime-topic bypass policy. Participation policy remains.
DROP POLICY IF EXISTS "Users subscribe to own realtime topics" ON public.messages;

-- 2. org_members: replace public SELECT with member/admin/self scope.
CREATE OR REPLACE FUNCTION public.is_org_member(_org uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_members
    WHERE org_id = _org AND user_id = _user
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_org_member(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Anyone can view org members" ON public.org_members;

CREATE POLICY "Org-scoped members can view org members"
ON public.org_members
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_trainer_org_admin(org_id, auth.uid())
  OR public.is_org_member(org_id, auth.uid())
);

-- 3. trainer_org_members: replace public-authenticated SELECT with org-scoped policy.
DROP POLICY IF EXISTS "members visible to authenticated" ON public.trainer_org_members;

CREATE POLICY "Org-scoped members can view trainer org members"
ON public.trainer_org_members
FOR SELECT
TO authenticated
USING (
  user_id = auth.uid()
  OR public.is_trainer_org_admin(org_id, auth.uid())
  OR public.is_trainer_org_member(org_id, auth.uid())
);

-- 4. Revoke anon EXECUTE on SECURITY DEFINER helpers. All are used by triggers
--    (which run regardless of grants) or by authenticated callers only.
REVOKE EXECUTE ON FUNCTION public.enforce_account_type_lock()       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_org_owner_account_type()  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_single_linked_org()       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_single_linked_team()      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.enforce_team_owner_account_type() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_account_type(uuid)            FROM PUBLIC, anon;