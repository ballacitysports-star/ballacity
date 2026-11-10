-- ROLLBACK for supabase/migrations/20261108130000_events_stage5_facility_events.sql (P2-1 stage 5, Home feed slice E).
-- NOT a migration. It removes venue events: create_facility_event and is_facility_staff are dropped, venue staff lose
-- their staff rights on events, and the 'open_gym' kind is removed. is_event_staff and event_is_listed go back to the
-- stage 1 bodies (team hosts only).
-- Only the 'venue_events' switch row is removed. It refuses to run while any venue event exists (move or delete those deliberately first), and
-- unless the session confirms:
--     PGOPTIONS="-c app.confirm_drop_facility_events=yes" psql ... -f <this file>
BEGIN;
DO $guard$
BEGIN
  IF current_setting('app.confirm_drop_facility_events', true) IS DISTINCT FROM 'yes' THEN
    RAISE EXCEPTION 'Refusing to run: venues would stop being able to create events. Set app.confirm_drop_facility_events=yes for the session to proceed deliberately.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.events WHERE host_kind = 'facility' OR kind = 'open_gym') THEN
    RAISE EXCEPTION 'Refusing to run: venue or open gym events exist. Their staff would lose access and the kind check would fail.';
  END IF;
END
$guard$;

DROP FUNCTION IF EXISTS public.create_facility_event(uuid, jsonb);

CREATE OR REPLACE FUNCTION private_sec.is_event_staff(_event uuid, _user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT e.host_kind = 'team' AND public.is_team_manager(e.team_id, _user)
      FROM public.events e WHERE e.id = _event), false);
$$;

CREATE OR REPLACE FUNCTION private_sec.event_is_listed(_event uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT COALESCE((
    SELECT e.moderation_status = 'approved'
       AND e.hidden_at IS NULL AND e.owner_hidden_at IS NULL AND e.moderator_hidden_at IS NULL
       AND (e.host_kind <> 'team' OR EXISTS (
             SELECT 1 FROM public.teams t
              WHERE t.id = e.team_id AND t.hidden_at IS NULL
                AND t.owner_hidden_at IS NULL AND t.moderator_hidden_at IS NULL))
      FROM public.events e WHERE e.id = _event), false);
$$;

DROP FUNCTION IF EXISTS private_sec.is_facility_staff(uuid, uuid);

ALTER TABLE public.events DROP CONSTRAINT IF EXISTS events_kind_check;
ALTER TABLE public.events ADD CONSTRAINT events_kind_check
  CHECK (kind IN ('tryout', 'clinic', 'camp', 'tournament'));

DELETE FROM public.app_settings WHERE key = 'venue_events';

COMMIT;
