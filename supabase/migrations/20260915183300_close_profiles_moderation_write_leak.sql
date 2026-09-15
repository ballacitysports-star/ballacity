-- Captures a fix Lovable's security-scan agent applied directly to production
-- at 2026-09-15T17:42Z (findings: SUPA_anon_security_definer_function_executable,
-- follows_readable_by_any_authenticated_user,
-- post_reactions_readable_by_any_authenticated_user,
-- profiles_avatar_url_private_bypass), which never went through this repo.
-- Sections 1-4 restate what was already applied, verbatim and idempotently, so
-- git matches production. Section 5 is a new fix for a gap that migration left
-- open.
--
-- 1. follows: only the parties involved, or mutually visible profiles
DROP POLICY IF EXISTS "Follows are readable by signed-in users" ON public.follows;
DROP POLICY IF EXISTS "Follows readable by involved or visible users" ON public.follows;
CREATE POLICY "Follows readable by involved or visible users"
ON public.follows FOR SELECT TO authenticated
USING (
  auth.uid() = follower_id
  OR auth.uid() = followee_id
  OR (
    private_sec.profile_visibility_of(follower_id) = ANY (ARRAY['public','members'])
    AND private_sec.profile_visibility_of(followee_id) = ANY (ARRAY['public','members'])
  )
);

-- 2. post_reactions: same subject-visibility gate as post_comments
DROP POLICY IF EXISTS "Reactions are readable by signed-in users" ON public.post_reactions;
DROP POLICY IF EXISTS "Reactions are readable by permitted viewers" ON public.post_reactions;
CREATE POLICY "Reactions are readable by permitted viewers"
ON public.post_reactions FOR SELECT TO anon, authenticated
USING (
  private_sec.can_comment_on_minor_content(
    auth.uid(),
    private_sec.comment_subject_owner(subject_type, subject_id)
  )
);

-- 3. profiles: sensitive columns unreadable through the Data API.
-- This half of Lovable's fix worked (verified: absent from
-- information_schema.column_privileges for anon/authenticated on production).
REVOKE SELECT (avatar_url_private, suspended_at, suspended_reason, moderation_state)
  ON public.profiles FROM anon, authenticated;
GRANT ALL ON public.profiles TO service_role;

-- 4. has_entitlement not callable anonymously
REVOKE EXECUTE ON FUNCTION public.has_entitlement(uuid, text, text) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_entitlement(uuid, text, text) TO authenticated, service_role;

-- 5. NEW: the write-side half of #3 was a no-op on production.
--
-- Lovable's migration also ran:
--   REVOKE UPDATE (avatar_url_private, suspended_at, suspended_reason,
--     moderation_state) ON public.profiles FROM anon, authenticated;
--
-- Verified on production this had no effect: those four columns carry no
-- column-level ACL at all (pg_attribute.attacl is null for each), and
-- `authenticated` holds a pre-existing TABLE-level UPDATE/INSERT grant on
-- profiles. A column-level REVOKE only removes a column-level grant — it
-- cannot narrow a broader table-level one. That's a standing Postgres
-- privilege-model gotcha, not specific to this fix, so don't repeat it: to
-- restrict a subset of columns when a table-level grant already exists, use
-- a trigger (as below), not a column-level REVOKE.
--
-- Net effect until now: any authenticated user could update their own
-- profiles row and set suspended_at/suspended_reason to null and
-- moderation_state to 'active' — self-un-suspending — or overwrite
-- avatar_url_private. The existing row-scoped RLS UPDATE policy on profiles
-- never stopped this because it does not gate individual columns.
--
-- Fix follows the same pattern already in use on this table for a different
-- set of system-owned columns — see guard_profile_age_fields() in
-- 20260902142608_6742c3dc-9ed0-4de4-92f8-d0c919a9fcad.sql. Every existing
-- write to these four columns already goes through supabaseAdmin
-- (service_role) — moderation.functions.ts, superadmin-images.functions.ts,
-- superadmin.functions.ts, and account.functions.ts's account-deletion
-- anonymization — none of which carry a caller auth.uid(), so this changes
-- nothing for them.
CREATE OR REPLACE FUNCTION public.guard_profile_moderation_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'superadmin') THEN
    NEW.avatar_url_private := OLD.avatar_url_private;
    NEW.suspended_at := OLD.suspended_at;
    NEW.suspended_reason := OLD.suspended_reason;
    NEW.moderation_state := OLD.moderation_state;
  END IF;
  RETURN NEW;
END $$;

REVOKE EXECUTE ON FUNCTION public.guard_profile_moderation_fields() FROM PUBLIC;

DROP TRIGGER IF EXISTS guard_profile_moderation_fields ON public.profiles;
CREATE TRIGGER guard_profile_moderation_fields
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.guard_profile_moderation_fields();
