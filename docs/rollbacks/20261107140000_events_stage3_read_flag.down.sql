-- ROLLBACK for supabase/migrations/20261107140000_events_stage3_read_flag.sql (P2-1 stage 3).
-- NOT a migration. It removes the evaluations copy and its mirror, get_event_locations, and the events_v2 switch.
-- tryout_evaluations (the source) is untouched, so nothing a coach entered is lost while writes still go there.
-- Turn the switch off (or leave it off) before running this: once the switch row is gone the app reads team_posts,
-- which is safe, but get_event_locations disappears with it.
-- It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_events_stage3=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_events_stage3', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback removes the events evaluations copy, get_event_locations and the events_v2 switch. Set app.confirm_drop_events_stage3=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DELETE FROM public.app_settings WHERE key = 'events_v2';
DROP FUNCTION IF EXISTS public.get_event_locations(uuid[]);
DROP TRIGGER IF EXISTS zz_mirror_event_evaluations ON public.tryout_evaluations;
DROP TRIGGER IF EXISTS zz_mirror_evaluation_on_registration ON public.event_registrations;
DROP TABLE IF EXISTS public.event_evaluations;
DROP FUNCTION IF EXISTS private_sec.mirror_tryout_evaluations_trg();
DROP FUNCTION IF EXISTS private_sec.mirror_evaluation_for_registration_trg();
DROP FUNCTION IF EXISTS private_sec.mirror_tryout_evaluation(uuid);
COMMIT;
