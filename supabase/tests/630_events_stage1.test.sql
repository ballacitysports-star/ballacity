-- P2-1 stage 1: the events model (supabase/migrations/20261106220000_events_stage1.sql).
-- Who can create and edit, who sees which event and which venue (D0), the age
-- range (D1), the guardian and waiver rules carried over from tryout_rsvps, and
-- capacity. Nothing here touches team_posts.
BEGIN;

SELECT t.person('owner', 38), t.person('coach', 31), t.person('stranger', 40),
       t.person('adultplayer', 25), t.person('parent', 42), t.person('kid', 12),
       t.person('kidtwo', 11), t.person('kidthree', 13), t.person('teencoach', 16);
-- An account with no birthday on file (t.person always stores one).
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('nobirthday'), 'nobirthday@example.test', now(),
        jsonb_build_object('display_name', 'Nobirthday', 'account_type', 'player'));
SELECT t.guardian('parent', 'kid');

SELECT t.team('hawks', 'owner');
SELECT t.member('hawks', 'coach', 'coach');
SELECT t.member('hawks', 'kid', 'player');
SELECT t.member('hawks', 'teencoach', 'coach');

-- ---- creating --------------------------------------------------------------
SELECT t.as_anon();
SELECT t.throws($$SELECT public.create_event('hawks', '{"kind":"tryout","title":"x","min_age":10,"max_age":14}')$$,
  'permission denied', 'an anonymous visitor cannot call create_event');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.throws($$SELECT public.create_event('hawks', '{"kind":"tryout","title":"x","min_age":10,"max_age":14}')$$,
  'NOT_TEAM_STAFF', 'someone who is not host staff cannot create an event');
SELECT t.reset();

SELECT t.as_user(t.id('teencoach'));
SELECT t.throws($$SELECT public.create_event('hawks', '{"kind":"tryout","title":"x","min_age":10,"max_age":14}')$$,
  'ADULT_HOST_REQUIRED', 'a minor on the staff cannot host an event');
SELECT t.reset();

SELECT t.as_user(t.id('coach'));
SELECT t.throws($$SELECT public.create_event('hawks', '{"kind":"tryout","title":"x","max_age":14}')$$,
  'AGE_RANGE_REQUIRED', 'an event without a minimum age is refused (D1)');
SELECT t.throws($$SELECT public.create_event('hawks', '{"kind":"tryout","title":"x","min_age":10}')$$,
  'AGE_RANGE_REQUIRED', 'an event without a maximum age is refused (D1)');
SELECT t.throws($$SELECT public.create_event('hawks', '{"kind":"tryout","title":"x","min_age":10,"max_age":14,"moderation_status":"approved"}')$$,
  'UNKNOWN_FIELD', 'a client cannot set its own moderation status');
SELECT t.throws($$SELECT public.create_event('hawks', '{"kind":"tryout","title":"x","min_age":15,"max_age":12}')$$,
  'events_age_range', 'an inverted age range is refused');
SELECT t.throws($$INSERT INTO public.events (host_kind, host_ref, team_id, kind, title, min_age, max_age, author_id)
                  VALUES ('team', 'hawks', 'hawks', 'tryout', 'direct', 18, 99, auth.uid())$$,
  'permission denied', 'host staff cannot insert into events directly');

CREATE TEMP TABLE ev (name text PRIMARY KEY, id uuid) ON COMMIT DROP;
GRANT ALL ON ev TO authenticated, anon;
INSERT INTO ev VALUES ('youth', public.create_event('hawks', jsonb_build_object(
  'kind', 'tryout', 'title', 'U14 tryout', 'min_age', 10, 'max_age', 14, 'capacity', 2,
  'starts_at', now() + interval '7 days', 'venue_label', 'Riverside Park',
  'location', jsonb_build_object('place_id', 'p-youth', 'formatted_address', '1 Kid Lane', 'lat', 40.1, 'lng', -73.9))));
SELECT t.reset();

SELECT t.as_user(t.id('owner'));
INSERT INTO ev VALUES ('adult', public.create_event('hawks', jsonb_build_object(
  'kind', 'clinic', 'title', 'Adult clinic', 'min_age', 18, 'max_age', 99,
  'starts_at', now() + interval '7 days',
  'location', jsonb_build_object('place_id', 'p-adult', 'formatted_address', '9 Gym Road', 'lat', 40.2, 'lng', -73.8))));
SELECT t.reset();

SELECT t.eq((SELECT moderation_status FROM public.events WHERE id = (SELECT id FROM ev WHERE name = 'youth')),
  'pending', 'a new event waits for moderation');

-- ---- before approval: staff only -------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.events'), 0, 'nobody outside the staff sees an unmoderated event');
SELECT t.reset();
SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.count('SELECT 1 FROM public.events'), 2, 'host staff see their unmoderated events');
SELECT t.reset();

UPDATE public.events SET moderation_status = 'approved';  -- server moderation

-- ---- who sees which event ----------------------------------------------------
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.events'), 1, 'an anonymous visitor sees the adult-only event only');
SELECT t.eq(t.count(format('SELECT 1 FROM public.events WHERE id = %L', (SELECT id FROM ev WHERE name = 'youth'))), 0,
  'and never the youth event');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.events'), 2, 'a signed-in member sees both listed events');
SELECT t.reset();

-- ---- who sees the exact venue (D0) ---------------------------------------------
SELECT t.as_anon();
SELECT t.eq((SELECT formatted_address FROM public.get_event_location((SELECT id FROM ev WHERE name = 'adult'))),
  '9 Gym Road', 'anyone sees the venue of an adult-only event');
SELECT t.eq((SELECT count(*)::int FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youth'))), 0,
  'an anonymous visitor gets no venue for a youth event');
SELECT t.eq(t.count('SELECT 1 FROM public.event_locations'), 0, 'and cannot read event_locations directly');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT count(*)::int FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youth'))), 0,
  'a stranger gets no venue for a youth event');
SELECT t.eq(t.count('SELECT 1 FROM public.event_locations'), 0, 'a stranger cannot read event_locations directly');
SELECT t.reset();

SELECT t.as_user(t.id('coach'));
SELECT t.eq((SELECT formatted_address FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youth'))),
  '1 Kid Lane', 'host staff see the youth venue');
SELECT t.reset();

SELECT t.as_user(t.id('parent'));
SELECT t.eq((SELECT count(*)::int FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youth'))), 0,
  'a parent whose child is not registered gets no youth venue yet');
SELECT t.reset();

-- ---- registering --------------------------------------------------------------
INSERT INTO public.team_waivers (team_id, version, title, content, published, published_at, created_by)
VALUES ('hawks', 'v1', 'Hawks waiver', 'Terms', true, now(), t.id('owner'));
CREATE TEMP TABLE w (id uuid) ON COMMIT DROP;
GRANT ALL ON w TO authenticated, anon;
INSERT INTO w SELECT id FROM public.team_waivers WHERE team_id = 'hawks';

SELECT t.as_user(t.id('adultplayer'));
SELECT t.throws(format('SELECT public.register_for_event(%L)', (SELECT id FROM ev WHERE name = 'youth')),
  'OUTSIDE_AGE_RANGE', 'an adult cannot register for a youth event');
SELECT t.reset();

SELECT t.as_user(t.id('kid'));
SELECT t.throws(format('SELECT public.register_for_event(%L)', (SELECT id FROM ev WHERE name = 'adult')),
  'OUTSIDE_AGE_RANGE', 'a child cannot register for an adult-only event');
SELECT t.throws(format('SELECT public.register_for_event(%L)', (SELECT id FROM ev WHERE name = 'youth')),
  'WAIVER_REQUIRED', 'registration needs the team waiver signed');
SELECT t.reset();

SELECT t.as_user(t.id('nobirthday'));
SELECT t.throws(format('SELECT public.register_for_event(%L)', (SELECT id FROM ev WHERE name = 'adult')),
  'AGE_UNKNOWN', 'someone with no birthday on file cannot register, even for an adult event');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.register_for_event(%L, %L, %L, true)',
    (SELECT id FROM ev WHERE name = 'youth'), t.id('kid'), (SELECT id FROM w)),
  'NOT_YOUR_GUARDIAN_LINK', 'a stranger cannot register someone else''s child');
SELECT t.reset();

SELECT t.as_user(t.id('parent'));
SELECT t.lives(format('SELECT public.register_for_event(%L, %L, %L, true)',
    (SELECT id FROM ev WHERE name = 'youth'), t.id('kid'), (SELECT id FROM w)),
  'a guardian registers their child and signs the waiver for them');
SELECT t.reset();
SELECT t.eq((SELECT s.signed_by FROM public.team_waiver_signatures s WHERE s.signer_user_id = t.id('kid')),
  t.id('parent'), 'the waiver records the guardian who signed it');

SELECT t.as_user(t.id('kid'));
SELECT t.throws(format('SELECT public.register_for_event(%L)', (SELECT id FROM ev WHERE name = 'youth')),
  'ALREADY_REGISTERED', 'nobody is registered twice');
SELECT t.eq((SELECT formatted_address FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youth'))),
  '1 Kid Lane', 'a registrant sees the youth venue');
SELECT t.reset();

SELECT t.as_user(t.id('parent'));
SELECT t.eq((SELECT formatted_address FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youth'))),
  '1 Kid Lane', 'a registrant''s guardian sees the youth venue');
SELECT t.eq(t.count('SELECT 1 FROM public.event_registrations'), 1, 'a guardian sees their child''s registration');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT count(*)::int FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youth'))), 0,
  'a stranger still gets no youth venue');
SELECT t.eq(t.count('SELECT 1 FROM public.event_registrations'), 0, 'a stranger sees no registrations');
SELECT t.reset();

-- ---- capacity (2) ----------------------------------------------------------------
INSERT INTO public.team_waiver_signatures (waiver_id, team_id, signer_user_id)
SELECT (SELECT id FROM w), 'hawks', t.id(h) FROM unnest(ARRAY['kidtwo', 'kidthree']) h;

SELECT t.as_user(t.id('kidthree'));
SELECT t.lives(format('SELECT public.register_for_event(%L)', (SELECT id FROM ev WHERE name = 'youth')),
  'a second child takes the last place');
SELECT t.reset();
SELECT t.as_user(t.id('kidtwo'));
SELECT t.throws(format('SELECT public.register_for_event(%L)', (SELECT id FROM ev WHERE name = 'youth')),
  'EVENT_FULL', 'a third child is refused once capacity is reached');
SELECT t.reset();
SELECT t.as_user(t.id('kidthree'));
SELECT t.lives(format('SELECT public.cancel_event_registration(%L)', (SELECT id FROM ev WHERE name = 'youth')),
  'a registrant cancels');
SELECT t.reset();
SELECT t.as_user(t.id('kidtwo'));
SELECT t.lives(format('SELECT public.register_for_event(%L)', (SELECT id FROM ev WHERE name = 'youth')),
  'and the freed place can be taken: capacity is counted from registrations');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format('SELECT public.cancel_event_registration(%L, %L)', (SELECT id FROM ev WHERE name = 'youth'), t.id('kid')),
  'NOT_ALLOWED', 'a stranger cannot cancel someone else''s registration');
SELECT t.reset();

SELECT t.as_user(t.id('coach'));
SELECT t.eq(t.count('SELECT 1 FROM public.event_registrations'), 3, 'host staff see every registration, cancelled ones included');
SELECT t.reset();

-- ---- editing ---------------------------------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($$SELECT public.update_event(%L, '{"title":"mine now"}')$$, (SELECT id FROM ev WHERE name = 'youth')),
  'EVENT_NOT_FOUND', 'someone who is not host staff cannot edit an event');
SELECT t.reset();

SELECT t.as_user(t.id('coach'));
SELECT t.throws(format($$SELECT public.update_event(%L, '{"min_age":18,"max_age":99}')$$, (SELECT id FROM ev WHERE name = 'youth')),
  'AGE_RANGE_LOCKED', 'the age range is fixed once anyone is registered (it would make the youth venue public)');
SELECT t.throws(format($$SELECT public.update_event(%L, '{"capacity":1}')$$, (SELECT id FROM ev WHERE name = 'youth')),
  'CAPACITY_BELOW_REGISTERED', 'capacity cannot drop below the people already registered');
SELECT t.throws(format($$SELECT public.update_event(%L, '{"author_id":"00000000-0000-0000-0000-000000000000"}')$$, (SELECT id FROM ev WHERE name = 'youth')),
  'UNKNOWN_FIELD', 'the author cannot be changed');
SELECT t.lives(format($$SELECT public.update_event(%L, '{"title":"U14 tryout (moved)"}')$$, (SELECT id FROM ev WHERE name = 'youth')),
  'host staff edit the title');
SELECT t.reset();
SELECT t.eq((SELECT moderation_status FROM public.events WHERE id = (SELECT id FROM ev WHERE name = 'youth')),
  'pending', 'new text goes back to moderation');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count(format('SELECT 1 FROM public.events WHERE id = %L', (SELECT id FROM ev WHERE name = 'youth'))), 0,
  'and the event leaves the public list until it is approved again');
SELECT t.reset();
SELECT t.as_user(t.id('kid'));
SELECT t.eq((SELECT count(*)::int FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youth'))), 0,
  'while unlisted, even a registrant gets no venue');
SELECT t.reset();
UPDATE public.events SET moderation_status = 'approved' WHERE id = (SELECT id FROM ev WHERE name = 'youth');

-- ---- hiding ----------------------------------------------------------------------
SELECT t.as_user(t.id('owner'));
SELECT t.lives(format('SELECT public.set_event_hidden(%L, true)', (SELECT id FROM ev WHERE name = 'adult')),
  'host staff hide their event');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.events'), 0, 'a hidden event leaves the public list');
SELECT t.eq((SELECT count(*)::int FROM public.get_event_location((SELECT id FROM ev WHERE name = 'adult'))), 0,
  'and its venue is no longer public');
SELECT t.reset();
SELECT t.as_user(t.id('adultplayer'));
SELECT t.throws(format('SELECT public.register_for_event(%L)', (SELECT id FROM ev WHERE name = 'adult')),
  'EVENT_NOT_FOUND', 'nobody can register for a hidden event');
SELECT t.reset();
UPDATE public.teams SET hidden_at = now() WHERE id = 'hawks';
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.events'), 0, 'a hidden team''s events leave the public list');
SELECT t.reset();
UPDATE public.teams SET hidden_at = NULL WHERE id = 'hawks';

-- ---- availability ----------------------------------------------------------------
SELECT t.as_user(t.id('kid'));
SELECT t.lives(format($$SELECT public.set_event_availability(%L, %L, 'available')$$, (SELECT id FROM ev WHERE name = 'youth'), t.id('kid')),
  'a team member sets their availability');
SELECT t.reset();
SELECT t.as_user(t.id('parent'));
SELECT t.lives(format($$SELECT public.set_event_availability(%L, %L, 'maybe', 'Late from school')$$, (SELECT id FROM ev WHERE name = 'youth'), t.id('kid')),
  'a guardian sets their child''s availability');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($$SELECT public.set_event_availability(%L, %L, 'unavailable')$$, (SELECT id FROM ev WHERE name = 'youth'), t.id('kid')),
  'NOT_ALLOWED', 'a stranger cannot set a child''s availability');
SELECT t.throws(format($$SELECT public.set_event_availability(%L, %L, 'available')$$, (SELECT id FROM ev WHERE name = 'youth'), t.id('stranger')),
  'NOT_ON_TEAM', 'only team members have availability');
SELECT t.eq(t.count('SELECT 1 FROM public.event_availability'), 0, 'a stranger reads nobody''s availability');
SELECT t.reset();
SELECT t.as_user(t.id('coach'));
SELECT t.eq((SELECT note FROM public.event_availability WHERE user_id = t.id('kid')), 'Late from school',
  'host staff read the team''s availability');
SELECT t.reset();

-- ---- an event that has started ----------------------------------------------------
UPDATE public.events SET starts_at = now() - interval '1 hour' WHERE id = (SELECT id FROM ev WHERE name = 'youth');
SELECT t.as_user(t.id('kidthree'));
SELECT t.throws(format('SELECT public.register_for_event(%L)', (SELECT id FROM ev WHERE name = 'youth')),
  'EVENT_STARTED', 'registration closes when the event starts');
SELECT t.reset();

-- ---- nothing else is touched ----------------------------------------------------------
SELECT t.eq((SELECT count(*)::int FROM public.team_posts WHERE team_id = 'hawks'), 0,
  'stage 1 writes nothing to team_posts');

ROLLBACK;
