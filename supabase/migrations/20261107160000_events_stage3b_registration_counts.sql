-- P2-1 stage 3b: seat counts for events, for everyone who can see the event.
-- Design: docs/design/p2-1-events.md. Builds on stages 1 to 3 (20261106220000, 20261107120000,
-- 20261107140000).
--
-- Why: the events_v2 read counted seats by reading event_registrations, but a member may read only
-- their own (and their children's) registrations, so anyone but team staff saw 0 or 1 seats taken.
-- Today's page shows team_posts.spots_taken, a count anyone who can see the post can read.
--
-- get_event_registration_counts(ids): for each event the caller may see (listed to the public, or
-- the caller is its staff), the number of registered seats. Counts only, never who registered.
-- Anonymous visitors get counts for listed adult-only events, the only events they can read
-- (events_anon_adult_only). At most 200 ids per call. Events with no registrations come back with 0.
--
-- Rollback: docs/rollbacks/20261107160000_events_stage3b_registration_counts.down.sql.

CREATE OR REPLACE FUNCTION public.get_event_registration_counts(_ids uuid[])
RETURNS TABLE (event_id uuid, registered integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT e.id,
         (SELECT count(*)::int FROM public.event_registrations r
           WHERE r.event_id = e.id AND r.status = 'registered')
    FROM public.events e
   WHERE e.id = ANY (_ids[1:200])
     AND (
       (private_sec.event_is_listed(e.id) AND (auth.uid() IS NOT NULL OR e.min_age >= 18))
       OR (auth.uid() IS NOT NULL AND private_sec.is_event_staff(e.id, auth.uid()))
     );
$$;
REVOKE ALL ON FUNCTION public.get_event_registration_counts(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_event_registration_counts(uuid[]) TO anon, authenticated, service_role;
