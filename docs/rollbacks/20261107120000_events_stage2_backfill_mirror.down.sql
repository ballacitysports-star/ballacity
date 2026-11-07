-- ROLLBACK for supabase/migrations/20261107120000_events_stage2_backfill_mirror.sql (P2-1 stage 2).
-- NOT a migration (outside supabase/migrations). It stops the mirror and deletes every event copied from a team post
-- (legacy_post_id set), which cascades to their locations, registrations and availability. The source tables
-- (team_posts, tryout_rsvps, team_event_availability) are untouched, so nothing a member entered is lost while the app
-- still reads the old tables (before stage 3). Events created through create_event (no legacy_post_id) are kept.
-- It restores stage 1's ON DELETE SET NULL on events.legacy_post_id and drops the failure log.
-- It refuses to run unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_events_stage2=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_events_stage2', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: this rollback stops the events mirror and deletes every event copied from a team post. Set app.confirm_drop_events_stage2=yes for the session to proceed deliberately.';
  END IF;
END
$guard$;

DROP TRIGGER IF EXISTS zz_mirror_events ON public.team_posts;
DROP TRIGGER IF EXISTS zz_mirror_event_registrations ON public.tryout_rsvps;
DROP TRIGGER IF EXISTS zz_mirror_event_availability ON public.team_event_availability;

DELETE FROM public.events WHERE legacy_post_id IS NOT NULL;

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_legacy_post_id_fkey;
ALTER TABLE public.events ADD CONSTRAINT events_legacy_post_id_fkey
  FOREIGN KEY (legacy_post_id) REFERENCES public.team_posts(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS private_sec.events_backfill_from_team_posts();
DROP FUNCTION IF EXISTS private_sec.mirror_team_posts_trg();
DROP FUNCTION IF EXISTS private_sec.mirror_tryout_rsvps_trg();
DROP FUNCTION IF EXISTS private_sec.mirror_event_availability_trg();
DROP FUNCTION IF EXISTS private_sec.mirror_team_post(uuid);
DROP FUNCTION IF EXISTS private_sec.mirror_tryout_rsvp(uuid, uuid);
DROP FUNCTION IF EXISTS private_sec.mirror_event_availability(uuid, uuid);
DROP FUNCTION IF EXISTS private_sec.event_age_range_for_team(text);
DROP TABLE IF EXISTS private_sec.event_mirror_failures;
COMMIT;
