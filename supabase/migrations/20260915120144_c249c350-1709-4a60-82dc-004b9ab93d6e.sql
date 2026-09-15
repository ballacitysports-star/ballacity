-- 1. AI bookkeeping tables: read-own only for members, no writes outside server code.
REVOKE ALL ON public.ai_generation_jobs FROM anon;
REVOKE ALL ON public.ai_usage_events FROM anon;
REVOKE ALL ON public.ai_text_moderation FROM anon;

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ai_generation_jobs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ai_usage_events FROM authenticated;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.ai_text_moderation FROM authenticated;

GRANT SELECT ON public.ai_generation_jobs TO authenticated;
GRANT SELECT ON public.ai_usage_events TO authenticated;
GRANT SELECT ON public.ai_text_moderation TO authenticated;

GRANT ALL ON public.ai_generation_jobs TO service_role;
GRANT ALL ON public.ai_usage_events TO service_role;
GRANT ALL ON public.ai_text_moderation TO service_role;

-- 2. Quarantined reel media: no read for anyone under RLS, owner included.
DROP POLICY IF EXISTS "quarantined highlight media is unreadable" ON storage.objects;
CREATE POLICY "quarantined highlight media is unreadable"
ON storage.objects
AS RESTRICTIVE
FOR SELECT
USING (
  bucket_id <> 'highlight-videos'
  OR NOT EXISTS (
    SELECT 1
    FROM public.image_moderation im
    WHERE im.bucket = 'highlight-videos'
      AND im.path = storage.objects.name
      AND im.status = 'quarantined'
  )
);

-- 3. Privilege escalation: team managers cannot insert an owner row.
DROP POLICY IF EXISTS "team_members_manager_write" ON public.team_members;
CREATE POLICY "team_members_manager_write"
ON public.team_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_team_manager(team_id, auth.uid())
  AND role <> 'owner'::team_role
);

-- 4. Privilege escalation: trainer org admins cannot create or promote owners.
DROP POLICY IF EXISTS "owner/admin can add members directly" ON public.trainer_org_members;
CREATE POLICY "owner/admin can add members directly"
ON public.trainer_org_members
FOR INSERT
TO authenticated
WITH CHECK (
  public.is_trainer_org_admin(org_id, auth.uid())
  AND (
    role <> 'owner'::trainer_org_role
    OR EXISTS (
      SELECT 1 FROM public.trainer_org_members me
      WHERE me.org_id = trainer_org_members.org_id
        AND me.user_id = auth.uid()
        AND me.role = 'owner'::trainer_org_role
    )
  )
);

DROP POLICY IF EXISTS "owner/admin can change roles" ON public.trainer_org_members;
CREATE POLICY "owner/admin can change roles"
ON public.trainer_org_members
FOR UPDATE
TO authenticated
USING (
  public.is_trainer_org_admin(org_id, auth.uid())
  AND (
    role <> 'owner'::trainer_org_role
    OR user_id = auth.uid()
  )
)
WITH CHECK (
  public.is_trainer_org_admin(org_id, auth.uid())
  AND (
    role <> 'owner'::trainer_org_role
    OR EXISTS (
      SELECT 1 FROM public.trainer_org_members me
      WHERE me.org_id = trainer_org_members.org_id
        AND me.user_id = auth.uid()
        AND me.role = 'owner'::trainer_org_role
    )
  )
);