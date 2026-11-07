-- P0-2 (Phase 0 audit, 2026-11-06): close two "oracles" any signed-in account could ask about any other
-- account, and the write path that let an admin promote themselves. Nothing here changes a row; it changes
-- who may call three functions and who may write one table. Read-only checks on a replay of `main`
-- (961 SQL assertions) and on the catalog found no policy or non-definer function that depends on the
-- grants removed below: every caller of the messaging functions is itself SECURITY DEFINER, and the only
-- writers of user_roles are the server (service role) and migrations.
--
-- 1. public.profile_ages(uuid[]) returned the exact age of every account whose profile is public or
--    members-visible. A minor's profile defaults to members-visible, so any signed-in stranger could read a
--    13-17 year old's exact age, and the browser calls this function from the players tab, the player page
--    and the host's request list. Now a minor's age is returned only to the minor, a verified guardian, a
--    moderator, or the server. Adults are unchanged (their visibility setting still decides). Nothing is
--    returned for a minor to anyone else, which the clients already treat as "age not shown". The cohort
--    itself stays hidden too: age_cohort_of was revoked from authenticated on 2026-09-02 for this reason, so
--    this function must not become a way around that.
--
-- 2. public.minor_messaging_block(uuid, uuid), minor_messaging_block_reason(uuid, uuid) and
--    minor_messaging_allowed(uuid, uuid) were executable by authenticated. Their answers ("guardian_only",
--    "child_needs_guardian", ...) reveal whether an arbitrary id is a minor and how their guardian set
--    messaging. No client code calls them (create_direct_conversation and the enforce_minor_messaging
--    trigger call them inside SECURITY DEFINER functions, which keep working). They are now service-role
--    only, and minor_messaging_block_me(_other) answers the one question a client may ask: about itself.
--
-- 3. public.user_roles: the policy "Admins manage roles" was FOR ALL with has_role(auth.uid(), 'admin'),
--    and authenticated held the default INSERT/UPDATE/DELETE grants. An admin could insert
--    (its own id, 'superadmin') through the API. The app never writes roles from the browser: adminSetRole
--    and superadminSetRole run on the server with the service role after their own checks and audit. So
--    the API roles lose every write privilege on the table, the FOR ALL policy goes, and a trigger refuses
--    any write made by a signed-in caller even if a grant is ever restored. "Users view own roles" stays,
--    so admins still read the table.
--
-- ROLLBACK: docs/rollbacks/20261106150000_close_authenticated_oracles.down.sql (guarded; it reopens all
-- three). TEST: supabase/tests/500_authenticated_oracles.test.sql.

SET lock_timeout = '5s';

-- ============================================================ 1. profile_ages: minors only to those with a reason
CREATE OR REPLACE FUNCTION public.profile_ages(_ids uuid[])
RETURNS TABLE(id uuid, age integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.user_id,
         date_part('year', age(b.birthday))::int
  FROM public.profile_birthdays b
  WHERE b.user_id = ANY(_ids)
    AND b.birthday IS NOT NULL
    AND public.profile_visibility_of(b.user_id) IN ('public','members')
    AND (
      -- an adult's age follows their visibility setting, as before
      public.age_cohort_of(b.user_id) = 'adult'
      -- the server (service role, workers, migrations) has no auth.uid()
      OR auth.uid() IS NULL
      -- a minor's age: the minor, a verified guardian, or a moderator
      OR b.user_id = auth.uid()
      OR public.is_guardian_of(auth.uid(), b.user_id)
      OR public.is_moderator(auth.uid())
    );
$$;
REVOKE EXECUTE ON FUNCTION public.profile_ages(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.profile_ages(uuid[]) TO authenticated, service_role;

-- ============================================================ 2. messaging policy functions: not for probing others
REVOKE EXECUTE ON FUNCTION public.minor_messaging_block(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minor_messaging_block(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.minor_messaging_block_reason(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minor_messaging_block_reason(uuid, uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.minor_messaging_allowed(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.minor_messaging_allowed(uuid, uuid) TO service_role;

-- The self-scoped question: may I, the signed-in caller, message _other? Same answer codes as
-- minor_messaging_block (NULL when nothing blocks), always about the caller, so it tells a caller nothing
-- about two third parties.
CREATE OR REPLACE FUNCTION public.minor_messaging_block_me(_other uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'NOT_SIGNED_IN: minor_messaging_block_me needs a signed-in caller' USING ERRCODE = '42501';
  END IF;
  RETURN public.minor_messaging_block(auth.uid(), _other);
END $$;
REVOKE EXECUTE ON FUNCTION public.minor_messaging_block_me(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minor_messaging_block_me(uuid) TO authenticated, service_role;

-- ============================================================ 3. user_roles: the server writes roles, nobody else
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_roles FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;

-- Belt and braces: a grant restored by a later migration or by hand must not reopen the path. The server
-- (service role, the signup trigger, migrations) has no auth.uid() and is untouched.
CREATE OR REPLACE FUNCTION public.guard_user_roles_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'ROLE_WRITE_FORBIDDEN: roles are granted and revoked by the server on a superadmin''s instruction, never written through the API'
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.guard_user_roles_write() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.guard_user_roles_write() TO service_role;

DROP TRIGGER IF EXISTS aa_guard_user_roles_write_trg ON public.user_roles;
CREATE TRIGGER aa_guard_user_roles_write_trg
BEFORE INSERT OR UPDATE OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.guard_user_roles_write();
