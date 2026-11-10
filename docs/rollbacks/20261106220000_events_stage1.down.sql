-- ROLLBACK for supabase/migrations/20261106220000_events_stage1.sql (P2-1 stage 1).
-- NOT a migration (outside supabase/migrations). It drops the events tables and their
-- functions, which DELETES every event, location, registration and availability row
-- stored in them. Stage 1 is additive and nothing in the app reads these tables yet, so
-- dropping them changes no page; but once stage 2 has backfilled them, or anyone has
-- registered through register_for_event, those rows are gone. It refuses to run unless
-- the session confirms that is intended:
--     PGOPTIONS="-c app.confirm_drop_events_stage1=yes" psql ... -f <this file>
-- It also refuses while any registration is still active, unless the session adds
-- app.confirm_drop_event_registrations=yes as well.
-- team_posts, tryout_rsvps, team_waivers and team_event_availability are not touched.
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_events_stage1', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback drops public.events and its tables with all their rows. Set app.confirm_drop_events_stage1=yes for the session to proceed deliberately.';
  END IF;
  IF to_regclass('public.event_registrations') IS NOT NULL
     AND EXISTS (SELECT 1 FROM public.event_registrations WHERE status = 'registered')
     AND current_setting('app.confirm_drop_event_registrations', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: people are registered for events. Export public.event_registrations first, then also set app.confirm_drop_event_registrations=yes.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.create_event(text, jsonb);
DROP FUNCTION IF EXISTS public.update_event(uuid, jsonb);
DROP FUNCTION IF EXISTS public.set_event_hidden(uuid, boolean);
DROP FUNCTION IF EXISTS public.get_event_location(uuid);
DROP FUNCTION IF EXISTS public.register_for_event(uuid, uuid, uuid, boolean);
DROP FUNCTION IF EXISTS public.cancel_event_registration(uuid, uuid);
DROP FUNCTION IF EXISTS public.set_event_availability(uuid, uuid, text, text);

DROP TABLE IF EXISTS public.event_availability;
DROP TABLE IF EXISTS public.event_registrations;
DROP TABLE IF EXISTS public.event_locations;
DROP TABLE IF EXISTS public.events;

DROP FUNCTION IF EXISTS private_sec.write_event_location(uuid, jsonb);
DROP FUNCTION IF EXISTS private_sec.can_see_event_location(uuid, uuid);
DROP FUNCTION IF EXISTS private_sec.age_on(uuid, date);
DROP FUNCTION IF EXISTS private_sec.event_is_listed(uuid);
DROP FUNCTION IF EXISTS private_sec.is_event_staff(uuid, uuid);
COMMIT;
