-- Read-only check that the events copy matches its source (P2-1 stage 2,
-- supabase/migrations/20261107120000_events_stage2_backfill_mirror.sql). Counts only, no user data.
-- Every row must have ok = true. A mismatch names the table and the number of posts affected.
--   psql -X -v ON_ERROR_STOP=1 -f docs/release/p2-1-stage2-verify.sql
-- The statement between BEGIN and ROLLBACK is a single SELECT, so it can also run on its own
-- through Lovable's database tool or the Management API.
BEGIN READ ONLY;
WITH src AS (
  SELECT id, team_id FROM public.team_posts WHERE kind IN ('tryout', 'clinic')
),
failed AS (
  SELECT DISTINCT source_id FROM private_sec.event_mirror_failures WHERE source = 'team_posts'
),
checks(check_name, expected, actual) AS (
  SELECT 'tryouts and clinics without an event (excluding logged failures)', '0',
         (SELECT count(*) FROM src WHERE NOT EXISTS (SELECT 1 FROM public.events e WHERE e.legacy_post_id = src.id)
            AND src.id::text NOT IN (SELECT source_id FROM failed))::text
  UNION ALL
  SELECT 'events copied from a post that is gone or no longer a tryout/clinic', '0',
         (SELECT count(*) FROM public.events e WHERE e.legacy_post_id IS NOT NULL
            AND NOT EXISTS (SELECT 1 FROM src WHERE src.id = e.legacy_post_id))::text
  UNION ALL
  SELECT 'events per team differ from posts per team (teams affected)', '0',
         (SELECT count(*) FROM (
            SELECT team_id, count(*) n FROM src WHERE id::text NOT IN (SELECT source_id FROM failed) GROUP BY 1
            EXCEPT
            SELECT team_id, count(*) FROM public.events WHERE legacy_post_id IS NOT NULL GROUP BY 1) x)::text
  UNION ALL
  SELECT 'posts whose registrations differ from their RSVPs (user, status)', '0',
         (SELECT count(DISTINCT post_id) FROM (
            (SELECT r.post_id, r.user_id, r.status FROM public.tryout_rsvps r
               JOIN public.events e ON e.legacy_post_id = r.post_id
             EXCEPT
             SELECT e.legacy_post_id, g.user_id, g.status FROM public.event_registrations g
               JOIN public.events e ON e.id = g.event_id WHERE e.legacy_post_id IS NOT NULL)
            UNION ALL
            (SELECT e.legacy_post_id, g.user_id, g.status FROM public.event_registrations g
               JOIN public.events e ON e.id = g.event_id WHERE e.legacy_post_id IS NOT NULL
             EXCEPT
             SELECT r.post_id, r.user_id, r.status FROM public.tryout_rsvps r
               JOIN public.events e ON e.legacy_post_id = r.post_id)) d)::text
  UNION ALL
  SELECT 'posts whose availability differs (user, status, note)', '0',
         (SELECT count(DISTINCT post_id) FROM (
            (SELECT a.post_id, a.user_id, a.status, a.note FROM public.team_event_availability a
               JOIN public.events e ON e.legacy_post_id = a.post_id
             EXCEPT
             SELECT e.legacy_post_id, v.user_id, v.status, v.note FROM public.event_availability v
               JOIN public.events e ON e.id = v.event_id WHERE e.legacy_post_id IS NOT NULL)
            UNION ALL
            (SELECT e.legacy_post_id, v.user_id, v.status, v.note FROM public.event_availability v
               JOIN public.events e ON e.id = v.event_id WHERE e.legacy_post_id IS NOT NULL
             EXCEPT
             SELECT a.post_id, a.user_id, a.status, a.note FROM public.team_event_availability a
               JOIN public.events e ON e.legacy_post_id = a.post_id)) d)::text
  UNION ALL
  SELECT 'copied events with a public venue label', '0',
         (SELECT count(*) FROM public.events WHERE legacy_post_id IS NOT NULL AND venue_label IS NOT NULL)::text
  UNION ALL
  -- Exact right after the backfill. Later, a team that gains a minor makes this count its earlier events
  -- (their range is set once).
  SELECT 'copied events with an adult range whose team is youth now', '0',
         (SELECT count(*) FROM public.events e WHERE e.legacy_post_id IS NOT NULL AND e.min_age >= 18
            AND private_sec.team_is_youth(e.team_id))::text
  UNION ALL
  SELECT 'mirror triggers installed (of 3)', '3',
         (SELECT count(*) FROM pg_trigger WHERE tgname IN ('zz_mirror_events', 'zz_mirror_event_registrations', 'zz_mirror_event_availability')
            AND NOT tgisinternal)::text
  UNION ALL
  SELECT '(info) logged mirror failures', '(info)', (SELECT count(*) FROM private_sec.event_mirror_failures)::text
  UNION ALL
  SELECT '(info) tryouts and clinics / copied events', '(info)',
         (SELECT count(*) FROM src)::text || ' / ' || (SELECT count(*) FROM public.events WHERE legacy_post_id IS NOT NULL)::text)
SELECT check_name, expected, actual, (expected = '(info)' OR actual = expected) AS ok FROM checks;
ROLLBACK;
