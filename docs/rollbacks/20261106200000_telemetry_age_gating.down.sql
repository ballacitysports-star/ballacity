-- ROLLBACK for supabase/migrations/20261106200000_telemetry_age_gating.sql (P3-7).
-- NOT a migration (outside supabase/migrations). It removes the triggers that anonymise telemetry rows of
-- minors and unknown-age accounts, so new rows from those accounts would again store the account id, the
-- full user agent and free-text errors. It cannot restore what the migration already cleared.
-- It refuses to run unless the session confirms that is intended:
--     PGOPTIONS="-c app.confirm_reidentify_minor_telemetry=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_reidentify_minor_telemetry', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this lets telemetry store minors'' account ids and user agents again. Set app.confirm_reidentify_minor_telemetry=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;
DROP TRIGGER IF EXISTS aa_anonymise_minor_location_denial ON public.location_denial_events;
DROP TRIGGER IF EXISTS aa_anonymise_minor_signin_event ON public.auth_signin_events;
DROP FUNCTION IF EXISTS private_sec.anonymise_minor_location_denial();
DROP FUNCTION IF EXISTS private_sec.anonymise_minor_signin_event();
DROP FUNCTION IF EXISTS private_sec.telemetry_subject_is_adult(uuid);
COMMIT;
