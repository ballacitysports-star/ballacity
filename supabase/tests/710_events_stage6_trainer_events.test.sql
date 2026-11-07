-- P2-1 stage 6 / Home feed slice F (supabase/migrations/20261108140000_events_stage6_trainer_events.sql).
-- It covers:
--   * a trainer's staff create clinics and camps; no tryouts, tournaments or open gym; a team is not a trainer;
--   * strangers, minors and hidden trainers are refused; the age range is required;
--   * pending until approved; a hidden trainer hides its events; staff rules (registrations, venue) cover them;
--   * sign-ups ask for the trainer's own waiver and the age range;
--   * trainer events never show on a team page (team_id stays NULL); team events are unchanged.
BEGIN;

SELECT t.person('coachowner', 40), t.person('assistant', 30), t.person('stranger', 35), t.person('adultplayer', 28),
       t.person('kid', 12), t.person('parent', 44), t.person('teentrainer', 16);
SELECT t.guardian('parent', 'kid');
INSERT INTO public.teams (id, owner_id, kind, name, handle) VALUES
  ('coachsam', t.id('coachowner'), 'coach', 'Coach Sam', 'coachsam'),
  ('teencoach', t.id('teentrainer'), 'coach', 'Teen Coach', 'teencoach');
SELECT t.team('hawks', 'coachowner');
SELECT t.member('coachsam', 'assistant', 'coach');

CREATE TEMP TABLE ev (name text PRIMARY KEY, id uuid);
GRANT ALL ON ev TO anon, authenticated;

-- ---- creating -------------------------------------------------------------------------------
SELECT t.as_user(t.id('coachowner'));
INSERT INTO ev VALUES ('adult', public.create_trainer_event('coachsam', jsonb_build_object(
  'kind', 'clinic', 'title', 'Shooting clinic', 'min_age', 18, 'max_age', 99,
  'starts_at', now() + interval '3 days', 'capacity', 2,
  'location', jsonb_build_object('formatted_address', '5 Hoop Ave'))));
SELECT t.reset();
SELECT t.as_user(t.id('assistant'));
INSERT INTO ev VALUES ('youth', public.create_trainer_event('coachsam', jsonb_build_object(
  'kind', 'camp', 'title', 'Youth camp', 'min_age', 8, 'max_age', 14,
  'starts_at', now() + interval '10 days',
  'location', jsonb_build_object('formatted_address', '5 Hoop Ave'))));
SELECT t.ok((SELECT count(*) FROM ev) = 2, 'the trainer''s owner and a coach on its staff create a clinic and a camp');
SELECT t.throws($$SELECT public.create_trainer_event('coachsam', '{"kind":"tryout","title":"x","min_age":10,"max_age":14}')$$,
  'KIND_NOT_ALLOWED', 'a trainer cannot create a tryout');
SELECT t.throws($$SELECT public.create_trainer_event('coachsam', '{"kind":"open_gym","title":"x","min_age":18,"max_age":99}')$$,
  'KIND_NOT_ALLOWED', 'or an open gym');
SELECT t.throws($$SELECT public.create_trainer_event('coachsam', '{"kind":"clinic","title":"x","min_age":10}')$$,
  'AGE_RANGE_REQUIRED', 'the age range is required');
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE id IN (SELECT id FROM ev)'), 2, 'staff see their pending events');
SELECT t.reset();
SELECT t.ok((SELECT bool_and(team_id IS NULL AND host_kind = 'trainer' AND host_ref = 'coachsam'
                             AND moderation_status = 'pending') FROM public.events WHERE id IN (SELECT id FROM ev)),
  'they are stored as trainer events, pending, with no team');

SELECT t.as_user(t.id('coachowner'));
SELECT t.throws($$SELECT public.create_trainer_event('hawks', '{"kind":"clinic","title":"x","min_age":18,"max_age":99}')$$,
  'TRAINER_NOT_FOUND', 'a team is not a trainer');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($$SELECT public.create_trainer_event('coachsam', '{"kind":"clinic","title":"x","min_age":18,"max_age":99}')$$,
  'NOT_TRAINER_STAFF', 'someone not on the trainer''s staff cannot');
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE id IN (SELECT id FROM ev)'), 0, 'and pending events are not shown to others');
SELECT t.reset();
SELECT t.as_user(t.id('teentrainer'));
SELECT t.throws($$SELECT public.create_trainer_event('teencoach', '{"kind":"clinic","title":"x","min_age":18,"max_age":99}')$$,
  'ADULT_HOST_REQUIRED', 'a minor cannot host an event');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws($$SELECT public.create_trainer_event('coachsam', '{"kind":"clinic","title":"x","min_age":18,"max_age":99}')$$,
  'permission denied', 'signed-out visitors cannot call it');
SELECT t.reset();

-- ---- once approved ------------------------------------------------------------------------------
UPDATE public.events SET moderation_status = 'approved' WHERE id IN (SELECT id FROM ev);
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE id IN (SELECT id FROM ev)'), 1,
  'a signed-out visitor sees the adult clinic, not the youth camp');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE id IN (SELECT id FROM ev)'), 2, 'a signed-in member sees both');
SELECT t.eq((SELECT count(*)::int FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youth'))), 0,
  'but not the youth camp''s venue (D0)');
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE team_id = ''coachsam'''), 0,
  'trainer events are not team events (nothing on a team page)');
SELECT t.reset();
SELECT t.as_user(t.id('assistant'));
SELECT t.eq((SELECT formatted_address FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youth'))), '5 Hoop Ave',
  'the trainer''s staff see their youth camp''s venue');
SELECT t.reset();

-- ---- sign-ups and the trainer's waiver ------------------------------------------------------------------
INSERT INTO public.team_waivers (team_id, version, title, content, published, published_at, created_by)
VALUES ('coachsam', 'v1', 'Coach Sam waiver', 'Terms', true, now(), t.id('coachowner'));
CREATE TEMP TABLE w (id uuid);
GRANT ALL ON w TO authenticated, anon;
INSERT INTO w SELECT id FROM public.team_waivers WHERE team_id = 'coachsam';

SELECT t.as_user(t.id('adultplayer'));
SELECT t.eq((SELECT title || ':' || signed FROM public.get_event_waiver((SELECT id FROM ev WHERE name = 'adult'))),
  'Coach Sam waiver:false', 'a member who is not on the trainer''s team can read the waiver an event needs');
SELECT t.throws('SELECT public.register_for_event((SELECT id FROM ev WHERE name = ''adult''))', 'WAIVER_REQUIRED',
  'signing up asks for the trainer''s waiver');
SELECT t.ok((SELECT public.register_for_event((SELECT id FROM ev WHERE name = 'adult'), NULL, (SELECT id FROM w), true))
  IS NOT NULL, 'and works once it is signed');
SELECT t.throws('SELECT public.register_for_event((SELECT id FROM ev WHERE name = ''youth''))', 'OUTSIDE_AGE_RANGE',
  'the age range applies');
SELECT t.reset();
SELECT t.eq((SELECT team_id FROM public.team_waiver_signatures WHERE signer_user_id = t.id('adultplayer')), 'coachsam',
  'the signature is recorded against the trainer');

SELECT t.as_user(t.id('adultplayer'));
SELECT t.eq((SELECT signed FROM public.get_event_waiver((SELECT id FROM ev WHERE name = 'adult'))), true,
  'and it shows as signed afterwards');
SELECT t.throws(format('SELECT * FROM public.get_event_waiver((SELECT id FROM ev WHERE name = ''youth''), %L)', t.id('kid')),
  'NOT_YOUR_GUARDIAN_LINK', 'nobody but a guardian can ask about someone else''s signature');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws('SELECT * FROM public.get_event_waiver((SELECT id FROM ev WHERE name = ''adult''))', 'permission denied',
  'signed-out visitors cannot read waivers');
SELECT t.reset();

SELECT t.as_user(t.id('parent'));
SELECT t.eq((SELECT signed FROM public.get_event_waiver((SELECT id FROM ev WHERE name = 'youth'), t.id('kid'))), false,
  'a guardian sees their child has not signed yet');
SELECT t.ok((SELECT public.register_for_event((SELECT id FROM ev WHERE name = 'youth'), t.id('kid'), (SELECT id FROM w), true))
  IS NOT NULL, 'a guardian signs their child up for the youth camp, signing the waiver for them');
SELECT t.reset();

SELECT t.as_user(t.id('assistant'));
SELECT t.eq(t.count('SELECT 1 FROM public.event_registrations WHERE event_id IN (SELECT id FROM ev)'), 2,
  'the trainer''s staff read their events'' sign-ups');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.event_registrations WHERE event_id IN (SELECT id FROM ev)'), 0, 'others do not');
SELECT t.reset();

-- ---- a hidden trainer hides its events -----------------------------------------------------------------
UPDATE public.teams SET owner_hidden_at = now() WHERE id = 'coachsam';
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE id IN (SELECT id FROM ev)'), 0, 'a hidden trainer''s events are not listed');
SELECT t.eq((SELECT count(*)::int FROM public.get_event_waiver((SELECT id FROM ev WHERE name = 'adult'))), 0,
  'nor their waivers');
SELECT t.reset();
SELECT t.as_user(t.id('coachowner'));
SELECT t.throws($$SELECT public.create_trainer_event('coachsam', '{"kind":"clinic","title":"x","min_age":18,"max_age":99}')$$,
  'TRAINER_NOT_FOUND', 'and it cannot create new ones while hidden');
SELECT t.reset();

-- ---- the switch -----------------------------------------------------------------------------------------
SELECT t.eq((SELECT value->>'enabled' FROM public.app_settings WHERE key = 'trainer_events'), 'false',
  'the trainer_events switch ships off');

ROLLBACK;
