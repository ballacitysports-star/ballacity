-- ROLLBACK for supabase/migrations/20261107160000_events_stage3b_registration_counts.sql (P2-1 stage 3b).
-- NOT a migration. It removes get_event_registration_counts. No data is stored by it, so nothing is lost.
-- Turn the events_v2 switch off first: with the function gone, the app's events read fails and falls
-- back to team_posts, which is safe but noisy.
-- It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_events_stage3b=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_events_stage3b', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback removes get_event_registration_counts. Set app.confirm_drop_events_stage3b=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.get_event_registration_counts(uuid[]);
COMMIT;
