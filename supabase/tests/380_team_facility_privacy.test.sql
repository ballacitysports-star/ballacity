-- G2: a youth team's practice and facility details are readable only by its managers, members, verified guardians and
-- moderators; trainers, gyms and facilities (kind 'coach') stay public; a moderator-verified public facility is the exception.
BEGIN;
SELECT t.person('mgr', 40), t.person('coach', 38), t.person('teenmem', 15), t.person('kidmem', 10), t.person('kidguardian', 41),
       t.person('stranger', 33), t.person('teenstranger', 16), t.person('modone', 39), t.person('adminone', 45),
       t.person('adultmgr', 37), t.person('trainer', 36), t.person('othermem', 29);
SELECT t.guardian('kidguardian', 'kidmem');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('adminone'), 'admin');
SELECT t.team('kidsfc', 'mgr'); SELECT t.team('adultfc', 'adultmgr'); SELECT t.team('otherfc', 'adultmgr');
UPDATE public.teams SET city = 'Atlanta', age_groups = ARRAY['youth'],
  home_court = 'Lincoln Elementary Gym', venues = ARRAY['Lincoln Elementary Gym'],
  venue_addresses = '["12 Oak St, Atlanta"]'::jsonb, venue_geo = '[{"address":"12 Oak St","lat":33.7,"lng":-84.3}]'::jsonb WHERE id = 'kidsfc';
UPDATE public.teams SET city = 'Decatur', age_groups = ARRAY['adult'], home_court = 'Rec Center', venues = ARRAY['Rec Center'] WHERE id = 'adultfc';
SELECT t.member('kidsfc', 'coach', 'coach'); SELECT t.member('kidsfc', 'teenmem'); SELECT t.member('kidsfc', 'kidmem');
SELECT t.member('otherfc', 'othermem');
-- a trainer / facility listing (kind coach) that lists youth as an age group: a public business
INSERT INTO public.teams (id, owner_id, kind, name, handle, city, age_groups, primary_venue, venues, venue_addresses)
  VALUES ('trainerx', t.id('trainer'), 'coach', 'Trainer X', 'trainerx', 'Atlanta', ARRAY['youth'], 'Peachtree Training Center', ARRAY['Peachtree Training Center'], '["100 Peachtree St"]'::jsonb);

-- ---- switch OFF: nothing visible changes
SELECT t.eq((SELECT count(*)::int FROM public.team_facility_private), 1, 'switch OFF: only the youth team has a private copy (not the adult team, not the trainer listing)');
SELECT t.eq((SELECT home_court FROM public.teams WHERE id = 'kidsfc'), 'Lincoln Elementary Gym', 'switch OFF: public columns unchanged, so this step alone closes nothing');
SELECT t.eq((SELECT primary_venue FROM public.teams WHERE id = 'trainerx'), 'Peachtree Training Center', 'a trainer listing keeps its public venue');

-- ---- activation is refused while an affected team lacks a copy
SET LOCAL session_replication_role = replica;
INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups, home_court) VALUES ('legacyfc', t.id('mgr'), 'team', 'Legacy', 'legacyfc', ARRAY['teen'], 'School Gym');
SET LOCAL session_replication_role = origin;
SET LOCAL app.confirm_activate_youth_coarsening = 'yes';
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}'::jsonb WHERE key = 'youth_location_privacy'$q$,
  'youth team', 'activation is refused while a youth team has no private copy');
INSERT INTO public.team_facility_private (team_id, home_court) VALUES ('legacyfc', 'School Gym');
UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}'::jsonb WHERE key = 'youth_location_privacy';
SELECT t.eq(public.coarsen_existing_youth_team_facilities(100), 2, 'the batch function empties the two youth teams');
SELECT t.eq(public.coarsen_existing_youth_team_facilities(100), 0, 'and is idempotent');
SELECT t.ok((SELECT home_court IS NULL AND venues = '{}' AND venue_addresses = '[]'::jsonb AND venue_geo = '[]'::jsonb AND city = 'Atlanta' FROM public.teams WHERE id = 'kidsfc'), 'public facility columns are empty; the city stays');
SELECT t.eq((SELECT home_court FROM public.team_facility_private WHERE team_id = 'kidsfc'), 'Lincoln Elementary Gym', 'the exact details stay in the private table');
SELECT t.eq((SELECT home_court FROM public.teams WHERE id = 'adultfc'), 'Rec Center', 'an adult team is untouched');
SELECT t.eq((SELECT primary_venue FROM public.teams WHERE id = 'trainerx'), 'Peachtree Training Center', 'a public business listing is untouched');

-- ---- who sees what
CREATE FUNCTION t.pf(tm text) RETURNS int LANGUAGE sql AS $f$ SELECT count(*)::int FROM public.team_facility_private WHERE team_id = tm $f$;
CREATE FUNCTION t.pubvenue(tm text) RETURNS text LANGUAGE sql AS $f$ SELECT coalesce(home_court, '') FROM public.teams WHERE id = tm $f$;
GRANT EXECUTE ON FUNCTION t.pf(text), t.pubvenue(text) TO anon, authenticated;
SELECT t.as_anon();
SELECT t.eq(has_column_privilege('anon', 'public.teams', 'home_court', 'SELECT'), false, 'anonymous visitors cannot read the facility columns at all');
SELECT t.eq(t.count('SELECT 1 FROM public.team_facility_private'), 0, 'nor the private table');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.pubvenue('kidsfc'), '', 'signed-in adult stranger: nothing');
SELECT t.eq(t.pf('kidsfc'), 0, 'and no private access');
SELECT t.eq(t.pubvenue('trainerx') <> '' OR (SELECT primary_venue FROM public.teams WHERE id = 'trainerx') IS NOT NULL, true, 'the trainer listing is still readable');
SELECT t.as_user(t.id('teenstranger')); SELECT t.eq(t.pf('kidsfc'), 0, 'signed-in teen stranger: no');
SELECT t.as_user(t.id('othermem'));     SELECT t.eq(t.pf('kidsfc'), 0, 'a member of another team: no');
SELECT t.as_user(t.id('mgr'));          SELECT t.eq(t.pf('kidsfc'), 1, 'owner and manager: yes');
SELECT t.as_user(t.id('coach'));        SELECT t.eq(t.pf('kidsfc'), 1, 'coach: yes');
SELECT t.as_user(t.id('teenmem'));      SELECT t.eq(t.pf('kidsfc'), 1, 'teen member: yes');
SELECT t.as_user(t.id('kidmem'));       SELECT t.eq(t.pf('kidsfc'), 1, 'under-13 member: yes');
SELECT t.as_user(t.id('kidguardian'));  SELECT t.eq(t.pf('kidsfc'), 1, 'verified guardian of a member: yes');
SELECT t.as_user(t.id('modone'));       SELECT t.eq(t.pf('kidsfc'), 1, 'moderator: yes');
SELECT t.as_user(t.id('adminone'));     SELECT t.eq(t.pf('kidsfc'), 1, 'administrator: yes');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'revoked' WHERE parent_user_id = t.id('kidguardian');
SELECT t.as_user(t.id('kidguardian')); SELECT t.eq(t.pf('kidsfc'), 0, 'a guardian whose link is revoked: no');
SELECT t.reset();

-- ---- edits round-trip and partial edits
SELECT t.as_user(t.id('mgr'));
SELECT t.lives($q$UPDATE public.teams SET home_court = 'New Field' WHERE id = 'kidsfc'$q$, 'a manager can edit the home court');
SELECT t.reset();
SELECT t.ok((SELECT home_court = 'New Field' AND venues = ARRAY['Lincoln Elementary Gym'] FROM public.team_facility_private WHERE team_id = 'kidsfc'), 'only that column changed privately; the other private values were kept');
SELECT t.eq((SELECT home_court IS NULL FROM public.teams WHERE id = 'kidsfc'), true, 'and the public column is still empty');
SELECT t.as_user(t.id('mgr'));
SELECT t.lives($q$UPDATE public.teams SET tagline = 'We play hard' WHERE id = 'kidsfc'$q$, 'an unrelated edit does not disturb it');
SELECT t.lives($q$UPDATE public.teams SET home_court = NULL WHERE id = 'kidsfc'$q$, 'writing NULL while the public column is empty is a no-op (it cannot be told from a round trip) ...');
SELECT t.throws($q$SELECT public.clear_team_facility_details('kidsfc', ARRAY['bogus'])$q$, 'Unknown facility field', 'an unknown field is refused');
SELECT t.lives($q$SELECT public.clear_team_facility_details('kidsfc', ARRAY['home_court'])$q$, '... so a manager removes a detail with clear_team_facility_details');
SELECT t.reset();
SELECT t.eq((SELECT home_court IS NULL FROM public.team_facility_private WHERE team_id = 'kidsfc'), true, 'the private value is cleared');
SELECT t.eq((SELECT venues FROM public.team_facility_private WHERE team_id = 'kidsfc'), ARRAY['Lincoln Elementary Gym'], 'and the other details are kept');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT public.clear_team_facility_details('kidsfc', ARRAY['venues'])$q$, 'owner, managers and coaches', 'a stranger cannot clear anything');
SELECT t.as_user(t.id('teenmem'));
SELECT t.throws($q$SELECT public.clear_team_facility_details('kidsfc', ARRAY['venues'])$q$, 'owner, managers and coaches', 'nor can an ordinary member');
SELECT t.as_anon();
SELECT t.throws($q$SELECT public.clear_team_facility_details('kidsfc', ARRAY['venues'])$q$, 'permission denied', 'nor an anonymous caller');
SELECT t.reset();

-- ---- explicit public-facility policy
SELECT t.as_user(t.id('mgr'));
SELECT t.lives($q$UPDATE public.teams SET facility_public_requested = true WHERE id = 'kidsfc'$q$, 'the manager can request a public-facility review');
SELECT t.lives($q$UPDATE public.teams SET facility_public = true WHERE id = 'kidsfc'$q$, 'setting facility_public directly is not an error ...');
SELECT t.reset();
SELECT t.eq((SELECT facility_public FROM public.teams WHERE id = 'kidsfc'), false, '... but is reverted');
UPDATE public.team_facility_private SET home_court = 'Riverside Park Courts' WHERE team_id = 'kidsfc';
SELECT t.as_user(t.id('mgr'));
SELECT t.throws($q$SELECT public.verify_team_facility_public('kidsfc')$q$, 'Moderators only', 'a manager cannot verify');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT * FROM public.list_team_facility_requests()$q$, 'Moderators only', 'a stranger cannot list requests');
SELECT t.as_anon();
SELECT t.throws($q$SELECT public.verify_team_facility_public('kidsfc')$q$, 'permission denied', 'anonymous cannot call it');
SELECT t.as_user(t.id('modone'));
SELECT t.eq((SELECT count(*)::int FROM public.list_team_facility_requests() WHERE team_id = 'kidsfc'), 1, 'a moderator sees the request');
SELECT t.lives($q$SELECT public.verify_team_facility_public('kidsfc', 'Public park courts')$q$, 'a moderator can verify it');
SELECT t.reset();
SELECT t.ok((SELECT facility_public AND home_court = 'Riverside Park Courts' FROM public.teams WHERE id = 'kidsfc'), 'the verified facility is public');
SELECT t.eq((SELECT verified_by FROM public.team_public_facilities WHERE team_id = 'kidsfc'), t.id('modone'), 'who verified it is recorded');
SELECT t.as_user(t.id('stranger')); SELECT t.eq(t.pubvenue('kidsfc'), 'Riverside Park Courts', 'a stranger now sees the public facility');
SELECT t.as_user(t.id('mgr'));
SELECT t.lives($q$UPDATE public.teams SET home_court = 'Different Courts' WHERE id = 'kidsfc'$q$, 'moving it');
SELECT t.reset();
SELECT t.ok((SELECT NOT facility_public AND home_court IS NULL FROM public.teams WHERE id = 'kidsfc'), 'clears the verification and re-hides it');
SELECT t.eq((SELECT home_court FROM public.team_facility_private WHERE team_id = 'kidsfc'), 'Different Courts', 'the new details are private');
SELECT t.as_user(t.id('modone'));
SELECT t.lives($q$SELECT public.verify_team_facility_public('kidsfc')$q$, 'verified again');
SELECT t.lives($q$SELECT public.revoke_team_facility_public('kidsfc')$q$, 'revoked by a moderator');
SELECT t.reset();
SELECT t.ok((SELECT NOT facility_public AND home_court IS NULL FROM public.teams WHERE id = 'kidsfc'), 'revoking re-hides the public columns');

-- ---- new youth team created while the switch is ON
SELECT t.as_user(t.id('adultmgr'));
SELECT t.lives(format($q$INSERT INTO public.teams (id, owner_id, kind, name, handle, age_groups, home_court, venues) VALUES ('newkids', %L, 'team', 'New Kids', 'newkids', ARRAY['youth'], 'Oak Park Gym', ARRAY['Oak Park Gym'])$q$, t.id('adultmgr')), 'a new youth team can be created');
SELECT t.reset();
SELECT t.ok((SELECT home_court IS NULL AND venues = '{}' FROM public.teams WHERE id = 'newkids'), 'and is published without facility details');
SELECT t.eq((SELECT home_court FROM public.team_facility_private WHERE team_id = 'newkids'), 'Oak Park Gym', 'which are kept privately');

-- ---- exposure paths
SELECT t.eq((SELECT count(*)::int FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('team_facility_private', 'team_public_facilities')), 0, 'neither new table is in realtime');
SELECT t.eq(has_table_privilege('authenticated', 'public.team_facility_private', 'INSERT,UPDATE,DELETE'), false, 'no client can write the private table');
SELECT t.eq(has_table_privilege('authenticated', 'public.team_public_facilities', 'SELECT'), false, 'nor read the verification record');
SELECT t.eq(has_function_privilege('anon', 'public.sync_team_facility_private()', 'EXECUTE'), false, 'trigger functions are not callable by API roles');
ROLLBACK;
