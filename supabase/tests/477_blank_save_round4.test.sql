-- SEC-1, review round 4 (F1): blank saves from older clients never wipe the only exact copy of a private team or post location.
BEGIN;
SELECT t.person('stranger', 33), t.person('author', 34), t.person('teamboss', 41);
SELECT t.team('postteam', 'teamboss'); SELECT t.member('postteam', 'author', 'player');
UPDATE public.teams SET age_groups = ARRAY['youth'] WHERE id = 'postteam';

-- ===================================================================================================== F1: blank saves and deliberate clearing
SET LOCAL session_replication_role = replica;
INSERT INTO public.app_settings (key, value) VALUES ('youth_location_privacy', '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}'::jsonb)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, location, formatted_address, lat, lng, place_id) VALUES
  (t.id('pven'), 'postteam', t.id('author'), 'clinic', 'Clinic', 'Saturday', 'Postteam area', NULL, 33.75, -84.39, NULL),
  (t.id('pmove'), 'postteam', t.id('author'), 'clinic', 'Clinic two', 'Sunday', 'Postteam area', NULL, 33.75, -84.39, NULL);
INSERT INTO public.team_post_private (post_id, location, formatted_address, lat, lng, place_id) VALUES
  (t.id('pven'), 'Lincoln Gym', '12 Oak St', 33.7488, -84.3877, 'place-1'),
  (t.id('pmove'), 'Lincoln Gym', '12 Oak St', 33.7488, -84.3877, 'place-1');
SET LOCAL session_replication_role = origin;
-- F1-1
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$SELECT public.clear_team_post_venue(%L)$q$, t.id('pven')), 'author', 'F1-1: a stranger cannot clear a post''s venue');
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$UPDATE public.team_posts SET location = NULL WHERE id = md5('t:pven')::uuid$q$, 'an older client blanks the venue');
SELECT t.reset();
SELECT t.eq((SELECT location FROM public.team_post_private WHERE post_id = t.id('pven')), 'Lincoln Gym', 'which does not wipe the exact copy');
SELECT t.as_user(t.id('author'));
SELECT t.throws(format($q$SELECT public.clear_team_post_venue(%L, ARRAY['title'])$q$, t.id('pven')), 'Unknown venue field', 'only venue fields can be cleared');
SELECT t.lives(format($q$SELECT public.clear_team_post_venue(%L)$q$, t.id('pven')), 'F1-1: the author removes the venue deliberately');
SELECT t.reset();
SELECT t.ok((SELECT location IS NULL AND formatted_address IS NULL AND lat IS NULL AND lng IS NULL AND place_id IS NULL FROM public.team_post_private WHERE post_id = t.id('pven')),
  'the exact copy is cleared');
SELECT t.ok((SELECT location IS NULL AND lat IS NULL AND lng IS NULL FROM public.team_posts WHERE id = t.id('pven')), 'and the public columns too');
SELECT t.as_user(t.id('teamboss'));
SELECT t.lives(format($q$SELECT public.clear_team_post_venue(%L, ARRAY['place_id'])$q$, t.id('pmove')), 'the team''s owner may clear a field too');
SELECT t.reset();
SELECT t.ok((SELECT place_id IS NULL AND location = 'Lincoln Gym' FROM public.team_post_private WHERE post_id = t.id('pmove')), 'only that field');
-- F1-2
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$UPDATE public.team_posts SET lat = 33.70, lng = -84.40 WHERE id = md5('t:pmove')::uuid$q$, 'the author moves the venue to a two-decimal point');
SELECT t.reset();
SELECT t.ok((SELECT lat = 33.70 AND lng = -84.40 FROM public.team_post_private WHERE post_id = t.id('pmove')), 'F1-2: the move is stored, the old exact point is not kept');
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$UPDATE public.team_posts SET lat = 33.7, lng = -84.4, title = 'Clinic two!' WHERE id = md5('t:pmove')::uuid$q$, 'a client sending the coarse point back');
SELECT t.reset();
SELECT t.ok((SELECT lat = 33.70 AND lng = -84.40 FROM public.team_post_private WHERE post_id = t.id('pmove')), 'changes nothing');
-- F1-3
SELECT t.team('facteam', 'teamboss');
UPDATE public.teams SET age_groups = ARRAY['youth'] WHERE id = 'facteam';
SET LOCAL session_replication_role = replica;
INSERT INTO public.team_facility_private (team_id, home_court, venues, venue_addresses, primary_venue, venue_geo)
VALUES ('facteam', 'Lincoln Gym, 12 Oak St', ARRAY['Lincoln Gym'], '["12 Oak St"]'::jsonb, 'Lincoln Gym', '[{"lat":33.7488,"lng":-84.3877}]'::jsonb)
ON CONFLICT (team_id) DO UPDATE SET home_court = EXCLUDED.home_court, venues = EXCLUDED.venues, venue_addresses = EXCLUDED.venue_addresses,
  primary_venue = EXCLUDED.primary_venue, venue_geo = EXCLUDED.venue_geo;
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('teamboss'));
SELECT t.lives($q$UPDATE public.teams SET venues = ARRAY[''], venue_addresses = '[""]'::jsonb, venue_geo = '[null]'::jsonb WHERE id = 'facteam'$q$,
  'an older build saves blank list elements');
SELECT t.reset();
SELECT t.ok((SELECT venues = ARRAY['Lincoln Gym'] AND venue_addresses = '["12 Oak St"]'::jsonb AND venue_geo <> '[]'::jsonb FROM public.team_facility_private WHERE team_id = 'facteam'),
  'F1-3: blank elements never replace the exact lists');
SELECT t.as_user(t.id('teamboss'));
SELECT t.lives($q$UPDATE public.teams SET venues = ARRAY['', 'New Hall'] WHERE id = 'facteam'$q$, 'a real new list');
SELECT t.reset();
SELECT t.eq((SELECT venues FROM public.team_facility_private WHERE team_id = 'facteam'), ARRAY['', 'New Hall'], 'is still stored');

ROLLBACK;
