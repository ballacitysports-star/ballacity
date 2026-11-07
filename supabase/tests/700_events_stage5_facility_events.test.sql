-- P2-1 stage 5 / Home feed slice E (supabase/migrations/20261108130000_events_stage5_facility_events.sql).
-- It covers:
--   * venue staff create clinics, camps, tournaments and open gym; tryouts stay a team thing;
--   * strangers, minors and hidden venues are refused; the age range is required;
--   * a new event is pending (staff see it, the public does not) until moderation approves it;
--   * a hidden venue hides its events; staff rules (registrations, venue) cover venue events;
--   * sign-ups follow the stage 1 rules (age range); team events are unchanged.
BEGIN;

SELECT t.person('gymowner', 42), t.person('stranger', 35), t.person('adultplayer', 28), t.person('kid', 12),
       t.person('teenowner', 16);
INSERT INTO public.trainer_orgs (id, owner_id, name, handle) VALUES
  (t.id('gym'), t.id('gymowner'), 'City Gym', 'city-gym-5'),
  (t.id('teengym'), t.id('teenowner'), 'Teen Gym', 'teen-gym-5');

CREATE TEMP TABLE ev (name text PRIMARY KEY, id uuid);
GRANT ALL ON ev TO anon, authenticated;

-- ---- creating -------------------------------------------------------------------------------
SELECT t.as_user(t.id('gymowner'));
INSERT INTO ev VALUES ('open', public.create_facility_event(t.id('gym'), jsonb_build_object(
  'kind', 'open_gym', 'title', 'Friday open gym', 'min_age', 18, 'max_age', 99,
  'starts_at', now() + interval '3 days', 'capacity', 2,
  'location', jsonb_build_object('formatted_address', '1 Court St'))));
INSERT INTO ev VALUES ('youthcamp', public.create_facility_event(t.id('gym'), jsonb_build_object(
  'kind', 'camp', 'title', 'Youth camp', 'min_age', 8, 'max_age', 14,
  'starts_at', now() + interval '10 days',
  'location', jsonb_build_object('formatted_address', '1 Court St'))));
SELECT t.ok((SELECT count(*) FROM ev) = 2, 'the venue owner creates an open gym and a camp');
SELECT t.throws(format($$SELECT public.create_facility_event(%L, '{"kind":"tryout","title":"x","min_age":10,"max_age":14}')$$, t.id('gym')),
  'KIND_NOT_ALLOWED', 'a venue cannot create a tryout');
SELECT t.throws(format($$SELECT public.create_facility_event(%L, '{"kind":"clinic","title":"x","min_age":10}')$$, t.id('gym')),
  'AGE_RANGE_REQUIRED', 'the age range is required');
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE id IN (SELECT id FROM ev)'), 2, 'staff see their pending events');
SELECT t.reset();

SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($$SELECT public.create_facility_event(%L, '{"kind":"clinic","title":"x","min_age":18,"max_age":99}')$$, t.id('gym')),
  'NOT_FACILITY_STAFF', 'someone who does not run the venue cannot');
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE id IN (SELECT id FROM ev)'), 0, 'and pending events are not shown to others');
SELECT t.reset();
SELECT t.as_user(t.id('teenowner'));
SELECT t.throws(format($$SELECT public.create_facility_event(%L, '{"kind":"clinic","title":"x","min_age":18,"max_age":99}')$$, t.id('teengym')),
  'ADULT_HOST_REQUIRED', 'a minor cannot host an event');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws(format($$SELECT public.create_facility_event(%L, '{"kind":"clinic","title":"x","min_age":18,"max_age":99}')$$, t.id('gym')),
  'permission denied', 'signed-out visitors cannot call it');
SELECT t.reset();

-- ---- once approved ------------------------------------------------------------------------------
UPDATE public.events SET moderation_status = 'approved' WHERE id IN (SELECT id FROM ev);
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE id IN (SELECT id FROM ev)'), 1,
  'a signed-out visitor sees the adult-only open gym, not the youth camp');
SELECT t.eq((SELECT formatted_address FROM public.get_event_location((SELECT id FROM ev WHERE name = 'open'))), '1 Court St',
  'and the open gym''s venue (adult-only, D0)');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE id IN (SELECT id FROM ev)'), 2, 'a signed-in member sees both');
SELECT t.eq((SELECT count(*)::int FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youthcamp'))), 0,
  'but not the youth camp''s venue (D0)');
SELECT t.reset();
SELECT t.as_user(t.id('gymowner'));
SELECT t.eq((SELECT formatted_address FROM public.get_event_location((SELECT id FROM ev WHERE name = 'youthcamp'))), '1 Court St',
  'venue staff see their youth camp''s venue');
SELECT t.reset();

-- ---- sign-ups ----------------------------------------------------------------------------------------
SELECT t.as_user(t.id('adultplayer'));
SELECT t.ok((SELECT public.register_for_event((SELECT id FROM ev WHERE name = 'open'))) IS NOT NULL, 'an adult signs up for the open gym');
SELECT t.throws('SELECT public.register_for_event((SELECT id FROM ev WHERE name = ''youthcamp''))', 'OUTSIDE_AGE_RANGE',
  'the age range applies');
SELECT t.reset();
SELECT t.as_user(t.id('gymowner'));
SELECT t.eq(t.count('SELECT 1 FROM public.event_registrations WHERE event_id = (SELECT id FROM ev WHERE name = ''open'')'), 1,
  'venue staff read their event''s registrations');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.event_registrations WHERE event_id = (SELECT id FROM ev WHERE name = ''open'')'), 0,
  'others do not');
SELECT t.reset();

-- ---- a hidden venue hides its events -----------------------------------------------------------------
UPDATE public.trainer_orgs SET owner_hidden_at = now() WHERE id = t.id('gym');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.events WHERE id IN (SELECT id FROM ev)'), 0, 'a hidden venue''s events are not listed');
SELECT t.reset();
SELECT t.as_user(t.id('gymowner'));
SELECT t.throws(format($$SELECT public.create_facility_event(%L, '{"kind":"clinic","title":"x","min_age":18,"max_age":99}')$$, t.id('gym')),
  'FACILITY_NOT_FOUND', 'and it cannot create new ones while hidden');
SELECT t.reset();

-- ---- the switch -----------------------------------------------------------------------------------------
SELECT t.eq((SELECT value->>'enabled' FROM public.app_settings WHERE key = 'venue_events'), 'false',
  'the venue_events switch ships off');

ROLLBACK;
