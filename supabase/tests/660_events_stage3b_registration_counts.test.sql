-- P2-1 stage 3b (supabase/migrations/20261107160000_events_stage3b_registration_counts.sql).
-- It covers:
--   * a member sees the whole seat count, not only the registrations they may read (the stage 3 bug);
--   * anonymous visitors get counts for listed adult-only events only;
--   * an unlisted event's count goes to its staff only;
--   * cancelled registrations are not counted, and an event with none reads 0.
BEGIN;

-- ---- setup ------------------------------------------------------------------------
SELECT t.person('coach', 35), t.person('kid', 11), t.person('kid2', 10), t.person('adult', 28),
       t.person('stranger', 40), t.person('late', 30), t.person('owner', 45);
INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups)
VALUES ('cubs', t.id('coach'), 'team', 'Cubs', 'cubs', ARRAY['youth']),
       ('grown', t.id('owner'), 'team', 'Grown', 'grown', ARRAY['adult']);
SELECT t.member('cubs', 'kid', 'player');

INSERT INTO public.team_posts (id, team_id, author_id, kind, title, event_date, location, moderation_status)
VALUES (t.id('p-youth'), 'cubs', t.id('coach'), 'tryout', 'U12 tryout', now() + interval '5 days', 'School Field', 'approved'),
       (t.id('p-adult'), 'grown', t.id('owner'), 'clinic', 'Adult clinic', now() + interval '6 days', 'City Gym', 'approved'),
       (t.id('p-empty'), 'grown', t.id('owner'), 'clinic', 'Empty clinic', now() + interval '7 days', 'City Gym', 'approved'),
       (t.id('p-hidden'), 'cubs', t.id('coach'), 'tryout', 'Hidden tryout', now() + interval '8 days', 'School Field', 'approved');
INSERT INTO public.tryout_rsvps (post_id, team_id, user_id, registered_by, status)
VALUES (t.id('p-youth'), 'cubs', t.id('kid'), t.id('coach'), 'registered'),
       (t.id('p-youth'), 'cubs', t.id('kid2'), t.id('coach'), 'registered'),
       (t.id('p-adult'), 'grown', t.id('adult'), t.id('adult'), 'registered'),
       (t.id('p-adult'), 'grown', t.id('stranger'), t.id('stranger'), 'registered'),
       (t.id('p-adult'), 'grown', t.id('late'), t.id('late'), 'cancelled'),
       (t.id('p-hidden'), 'cubs', t.id('kid'), t.id('coach'), 'registered');
UPDATE public.events SET hidden_at = now() WHERE legacy_post_id = t.id('p-hidden');

CREATE TEMP TABLE ev ON COMMIT DROP AS
  SELECT e.id, p.title FROM public.events e JOIN public.team_posts p ON p.id = e.legacy_post_id
   WHERE e.legacy_post_id IN (t.id('p-youth'), t.id('p-adult'), t.id('p-empty'), t.id('p-hidden'));
GRANT SELECT ON ev TO anon, authenticated;
CREATE TEMP VIEW counts AS
  SELECT string_agg(ev.title || '=' || c.registered, ',' ORDER BY ev.title) AS s
    FROM public.get_event_registration_counts((SELECT array_agg(id) FROM ev)) c
    JOIN ev ON ev.id = c.event_id;
GRANT SELECT ON counts TO anon, authenticated;

SELECT t.eq((SELECT count(*)::int FROM ev), 4, 'the four posts were copied to events');

-- ---- a member sees the whole count -------------------------------------------------------
SELECT t.as_user(t.id('kid'));
SELECT t.eq(t.count($$SELECT 1 FROM public.event_registrations r JOIN ev ON ev.id = r.event_id
                       WHERE ev.title = 'U12 tryout'$$), 1,
  'reading registrations directly, the player sees only their own (why counts need the function)');
SELECT t.eq((SELECT s FROM counts), 'Adult clinic=2,Empty clinic=0,U12 tryout=2',
  'the player gets the whole count of every listed event, and not the hidden one');
SELECT t.reset();

-- ---- signed-in stranger ------------------------------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT s FROM counts), 'Adult clinic=2,Empty clinic=0,U12 tryout=2',
  'a signed-in stranger gets counts for listed events, cancelled seats excluded');
SELECT t.reset();

-- ---- anonymous -----------------------------------------------------------------------------------
SELECT t.as_anon();
SELECT t.eq((SELECT s FROM counts), 'Adult clinic=2,Empty clinic=0',
  'an anonymous visitor gets counts only for listed adult-only events');
SELECT t.reset();

-- ---- staff see their unlisted event ---------------------------------------------------------------
SELECT t.as_user(t.id('coach'));
SELECT t.eq((SELECT s FROM counts), 'Adult clinic=2,Empty clinic=0,Hidden tryout=1,U12 tryout=2',
  'team staff also get the count of their own hidden event');
SELECT t.reset();
SELECT t.as_user(t.id('owner'));
SELECT t.eq((SELECT s FROM counts), 'Adult clinic=2,Empty clinic=0,U12 tryout=2',
  'another team''s staff do not get the hidden event');
SELECT t.reset();

-- ---- it returns counts only ------------------------------------------------------------------------
SELECT t.eq((SELECT string_agg(a.attname, ',' ORDER BY a.attnum)
               FROM pg_proc p, unnest(p.proargnames) WITH ORDINALITY AS a(attname, attnum)
              WHERE p.oid = 'public.get_event_registration_counts(uuid[])'::regprocedure),
  '_ids,event_id,registered', 'the function returns an event id and a number, nothing about who');

ROLLBACK;
