-- P2-1 stage 3 (supabase/migrations/20261107140000_events_stage3_read_flag.sql).
-- It covers:
--   * the events_v2 switch exists, is off and is publicly readable;
--   * tryout evaluations are copied onto registrations and kept in step, in either order;
--   * only team staff read the copies;
--   * get_event_locations applies the venue rule (D0) per event, for signed-in callers only.
BEGIN;

-- ---- the switch -----------------------------------------------------------------
SELECT t.eq((SELECT value->>'enabled' FROM public.app_settings WHERE key = 'events_v2'), 'false',
  'the events_v2 switch exists and is off');
SELECT t.as_anon();
SELECT t.eq(t.count($$SELECT 1 FROM public.app_settings WHERE key = 'events_v2'$$), 1,
  'anyone can read the switch (the app checks it before signing in)');
SELECT t.reset();

-- ---- setup ------------------------------------------------------------------------
SELECT t.person('coach', 35), t.person('kid', 11), t.person('adult', 28), t.person('stranger', 40), t.person('owner', 45);
INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups)
VALUES ('cubs', t.id('coach'), 'team', 'Cubs', 'cubs', ARRAY['youth']),
       ('grown', t.id('owner'), 'team', 'Grown', 'grown', ARRAY['adult']);
SELECT t.member('cubs', 'kid', 'player');
SELECT t.member('grown', 'adult', 'player');

INSERT INTO public.team_posts (id, team_id, author_id, kind, title, event_date, location, moderation_status)
VALUES (t.id('p-youth'), 'cubs', t.id('coach'), 'tryout', 'U12 tryout', now() + interval '5 days', 'School Field', 'approved'),
       (t.id('p-adult'), 'grown', t.id('owner'), 'clinic', 'Adult clinic', now() + interval '6 days', 'City Gym', 'approved');
INSERT INTO public.tryout_rsvps (id, post_id, team_id, user_id, registered_by, status)
VALUES (t.id('rsvp-kid'), t.id('p-youth'), 'cubs', t.id('kid'), t.id('coach'), 'registered');

-- ---- evaluations follow ------------------------------------------------------------------
INSERT INTO public.tryout_evaluations (rsvp_id, post_id, team_id, attended, score, notes, updated_by)
VALUES (t.id('rsvp-kid'), t.id('p-youth'), 'cubs', true, 7, 'Good first touch', t.id('coach'));
SELECT t.eq((SELECT v.attended || '|' || v.score || '|' || v.notes
               FROM public.event_evaluations v JOIN public.event_registrations g ON g.id = v.registration_id
              WHERE g.user_id = t.id('kid')),
  'true|7|Good first touch', 'an evaluation is copied onto the matching registration');
UPDATE public.tryout_evaluations SET score = 9 WHERE rsvp_id = t.id('rsvp-kid');
SELECT t.eq((SELECT v.score::int FROM public.event_evaluations v JOIN public.event_registrations g ON g.id = v.registration_id
              WHERE g.user_id = t.id('kid')), 9, 'an edited score follows');

-- ---- who reads them --------------------------------------------------------------------------
SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.count('SELECT 1 FROM public.event_evaluations'), 1, 'team staff read the evaluation');
SELECT t.throws($$UPDATE public.event_evaluations SET score = 1$$, 'permission denied',
  'staff cannot write the copy directly (writes move in stage 4)');
SELECT t.reset();
SELECT t.as_user(t.id('kid'));
SELECT t.eq(t.count('SELECT 1 FROM public.event_evaluations'), 0, 'the player does not read staff evaluations, as today');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.event_evaluations'), 0, 'a stranger reads none');
SELECT t.reset();

DELETE FROM public.tryout_evaluations WHERE rsvp_id = t.id('rsvp-kid');
SELECT t.eq((SELECT count(*)::int FROM public.event_evaluations), 0, 'a deleted evaluation removes the copy');

-- ---- an evaluation written before its registration was copied ------------------------------------
INSERT INTO public.tryout_rsvps (id, post_id, team_id, user_id, registered_by, status)
VALUES (t.id('rsvp-adult'), t.id('p-adult'), 'grown', t.id('adult'), t.id('adult'), 'registered');
DELETE FROM public.event_registrations WHERE user_id = t.id('adult');  -- as if the copy had not happened yet
INSERT INTO public.tryout_evaluations (rsvp_id, post_id, team_id, attended, updated_by)
VALUES (t.id('rsvp-adult'), t.id('p-adult'), 'grown', true, t.id('owner'));
SELECT t.eq((SELECT count(*)::int FROM public.event_evaluations), 0, 'with no registration yet, there is nothing to copy onto');
SELECT private_sec.mirror_tryout_rsvp(t.id('p-adult'), t.id('adult'));
SELECT t.eq((SELECT v.attended FROM public.event_evaluations v JOIN public.event_registrations g ON g.id = v.registration_id
              WHERE g.user_id = t.id('adult')), true,
  'when the registration is copied, its evaluation follows');

-- ---- venues in one call (D0) ----------------------------------------------------------------------
CREATE TEMP TABLE ids ON COMMIT DROP AS
  SELECT array_agg(id ORDER BY title) AS a FROM public.events WHERE legacy_post_id IN (t.id('p-youth'), t.id('p-adult'));
GRANT SELECT ON ids TO anon, authenticated;

SELECT t.as_anon();
SELECT t.throws('SELECT * FROM public.get_event_locations((SELECT a FROM ids))', 'permission denied',
  'anonymous visitors cannot call get_event_locations');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT string_agg(formatted_address, ',') FROM public.get_event_locations((SELECT a FROM ids))), 'City Gym',
  'a stranger gets the adult-only venue and not the youth one');
SELECT t.reset();
SELECT t.as_user(t.id('coach'));
SELECT t.eq((SELECT count(*)::int FROM public.get_event_locations((SELECT a FROM ids))), 2,
  'the youth team''s coach gets their venue too (and the adult-only one)');
SELECT t.reset();
SELECT t.as_user(t.id('kid'));
SELECT t.eq((SELECT count(*)::int FROM public.get_event_locations((SELECT a FROM ids))), 2,
  'a registrant gets the venue of the youth event they are registered for');
SELECT t.reset();

ROLLBACK;
