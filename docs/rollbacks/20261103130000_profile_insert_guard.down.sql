-- ROLLBACK for supabase/migrations/20261103130000_profile_insert_guard.sql (F7).
-- NOT a migration (outside supabase/migrations). It removes the INSERT guard on public.profiles, so a client
-- that creates its own missing profile row can again choose its own age cohort. It refuses to run unless the
-- session confirms that is intended:
--     PGOPTIONS="-c app.confirm_reopen_profile_insert=yes" psql ... -f <this file>
-- No profile row is changed by the migration or by this script.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reopen_profile_insert', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback lets a client-created profile row choose its own age cohort again. Set app.confirm_reopen_profile_insert=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;
DROP TRIGGER IF EXISTS aa_guard_profile_insert_trg ON public.profiles;
DROP FUNCTION IF EXISTS public.guard_profile_insert();
COMMIT;
