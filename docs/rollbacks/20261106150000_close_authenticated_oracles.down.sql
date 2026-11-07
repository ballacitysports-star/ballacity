-- ROLLBACK for supabase/migrations/20261106150000_close_authenticated_oracles.sql (P0-2).
-- NOT a migration (outside supabase/migrations). It restores the state before the migration: any signed-in
-- account can again read a minor's exact age through profile_ages, ask the messaging policy about two other
-- people, and an admin can again write user_roles through the API. It refuses to run unless the session
-- confirms that is intended:
--     PGOPTIONS="-c app.confirm_reopen_auth_oracles=yes" psql ... -f <this file>
-- No row is changed by the migration or by this script.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_auth_oracles', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback exposes minors'' exact ages and messaging controls to every signed-in account and lets admins write roles through the API again. Set app.confirm_reopen_auth_oracles=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

-- 3. user_roles
DROP TRIGGER IF EXISTS aa_guard_user_roles_write_trg ON public.user_roles;
DROP FUNCTION IF EXISTS public.guard_user_roles_write();
GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.user_roles TO authenticated;
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
CREATE POLICY "Admins manage roles" ON public.user_roles
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- 2. messaging policy functions
DROP FUNCTION IF EXISTS public.minor_messaging_block_me(uuid);
GRANT EXECUTE ON FUNCTION public.minor_messaging_block(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minor_messaging_block_reason(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.minor_messaging_allowed(uuid, uuid) TO authenticated;

-- 1. profile_ages: the definition from 20260902000524_b8dccca5-66c6-477c-b252-b076bae5c1aa.sql
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
    AND public.profile_visibility_of(b.user_id) IN ('public','members');
$$;
COMMIT;
