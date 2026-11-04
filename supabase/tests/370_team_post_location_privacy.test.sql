-- G1: the exact venue of a youth team's post is private; a verified public venue is the explicit exception.
--   * posts of youth teams (age group youth/teen, or any member who is not a confirmed adult) keep their exact venue in
--     team_post_private; with the shared switch ON the public columns hold the team's city and 2-decimal coordinates;
--   * anonymous visitors and signed-in strangers of every age see the coarse form only; the author, managers, members,
--     verified guardians of members, a registered family and moderators see the exact venue; a cancelled registration does not;
--   * adult teams and posts without a location are untouched;
--   * only a moderator can make a venue public, a manager's attempt is reverted, moving a verified venue clears it, revoking re-coarsens;
--   * text of a private youth post cannot carry the address; the private table is not in realtime.
BEGIN;
SELECT t.person('mgr', 40), t.person('coach', 38), t.person('adultmem', 30), t.person('teenmem', 15), t.person('kidmem', 10),
       t.person('kidguardian', 41), t.person('stranger', 33), t.person('teenstranger', 16), t.person('modone', 39),
       t.person('regparent', 42), t.person('regkid', 9), t.person('adminone', 45), t.person('adultmgr', 37), t.person('adultplayer', 29);
SELECT t.guardian('kidguardian', 'kidmem');
SELECT t.guardian('regparent', 'regkid');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('adminone'), 'admin');
SELECT t.team('kids', 'mgr');
SELECT t.team('adults', 'adultmgr');
UPDATE public.teams SET city = 'Atlanta', age_groups = ARRAY['youth'] WHERE id = 'kids';
UPDATE public.teams SET city = 'Decatur', age_groups = ARRAY['adult'] WHERE id = 'adults';
SELECT t.member('kids', 'coach', 'coach'); SELECT t.member('kids', 'teenmem'); SELECT t.member('kids', 'kidmem');
SELECT t.member('adults', 'adultplayer');

SELECT t.ok(private_sec.team_is_youth('kids'), 'a team with the youth age group is a youth team');
SELECT t.ok(NOT private_sec.team_is_youth('adults'), 'an adult team is not');
SELECT t.ok(private_sec.team_is_youth('no-such-team'), 'a team that cannot be found fails closed');
SELECT t.member('adults', 'teenmem');
SELECT t.ok(private_sec.team_is_youth('adults'), 'an adult-age-group team with a minor member counts as youth');
DELETE FROM public.team_members WHERE team_id = 'adults' AND user_id = t.id('teenmem');
SELECT t.ok(NOT private_sec.team_is_youth('adults'), 'and stops counting when the minor leaves');

-- ---- switch OFF: nothing visible changes, the private copy exists
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, event_date, location, formatted_address, lat, lng, place_id) VALUES
 (t.id('p-try'),   'kids',   t.id('mgr'),       'tryout',       'U12 tryouts', 'Bring water.',        now()+interval '5 days', 'Lincoln Elementary Gym', 'Lincoln Elementary Gym, 12 Oak St, Atlanta', 33.77712, -84.38812, 'place-1'),
 (t.id('p-news'),  'kids',   t.id('mgr'),       'announcement', 'Season starts', 'Practice Tuesdays.',  NULL, NULL, NULL, NULL, NULL, NULL),
 (t.id('p-adult'), 'adults', t.id('adultmgr'),  'tryout',       'Adult tryouts', 'Come play.',         now()+interval '5 days', 'Rec Center', 'Rec Center, 1 Main St, Decatur', 33.8, -84.3, 'place-2');
UPDATE public.team_posts SET moderation_status = 'approved';
SELECT t.eq((SELECT count(*)::int FROM public.team_post_private), 1, 'switch OFF: only the youth team''s post with a venue has a private copy');
SELECT t.eq((SELECT location FROM public.team_posts WHERE id = t.id('p-try')), 'Lincoln Elementary Gym', 'switch OFF: the public column is unchanged, so this step alone closes nothing');
SELECT t.eq((SELECT lat FROM public.team_post_private WHERE post_id = t.id('p-try')), 33.77712::numeric, 'the private copy is exact');
SELECT t.eq((SELECT count(*)::int FROM public.team_post_private WHERE post_id = t.id('p-news')), 0, 'an announcement without a location has none');

-- ---- activation is refused while a post lacks a private copy, then allowed
SET LOCAL session_replication_role = replica;
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, location, lat, lng) VALUES
 (t.id('p-old'), 'kids', t.id('mgr'), 'clinic', 'Skills clinic', 'Open to all.', 'School Gym, 9 Pine St', 33.9, -84.5);
SET LOCAL session_replication_role = origin;
SET LOCAL app.confirm_activate_youth_coarsening = 'yes';
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}'::jsonb WHERE key = 'youth_location_privacy'$q$,
  'youth-team post', 'activation is refused while a youth-team post has no private copy');
INSERT INTO public.team_post_private (post_id, location, lat, lng) VALUES (t.id('p-old'), 'School Gym, 9 Pine St', 33.9, -84.5);
UPDATE public.app_settings SET value = '{"coarsen": true, "app_adoption_confirmed": "2c-verified"}'::jsonb WHERE key = 'youth_location_privacy';
UPDATE public.team_posts SET moderation_status = 'approved';
SELECT t.eq(public.coarsen_existing_youth_team_posts(100), 2, 'the batch function coarsens the two existing youth posts');
SELECT t.eq(public.coarsen_existing_youth_team_posts(100), 0, 'and is idempotent');

SELECT t.eq((SELECT location FROM public.team_posts WHERE id = t.id('p-try')), 'Atlanta', 'public location is the team''s city');
SELECT t.ok((SELECT formatted_address IS NULL AND place_id IS NULL AND lat = 33.78 AND lng = -84.39 FROM public.team_posts WHERE id = t.id('p-try')), 'address and place id removed, coordinates to 2 decimals');
SELECT t.ok((SELECT title = 'U12 tryouts' AND body = 'Bring water.' AND event_date IS NOT NULL FROM public.team_posts WHERE id = t.id('p-try')), 'title, text and date are preserved');
SELECT t.ok((SELECT title = 'Season starts' AND location IS NULL FROM public.team_posts WHERE id = t.id('p-news')), 'a team announcement is untouched');
SELECT t.eq((SELECT location FROM public.team_posts WHERE id = t.id('p-adult')), 'Rec Center', 'an adult team''s post is untouched');
SELECT t.eq((SELECT location FROM public.team_post_private WHERE post_id = t.id('p-try')), 'Lincoln Elementary Gym', 'the exact venue stays in the private table');

-- ---- who can read what (the public table and the private one)
CREATE FUNCTION t.pub(p text) RETURNS text LANGUAGE sql AS $f$ SELECT location FROM public.team_posts WHERE id = t.id(p) $f$;
CREATE FUNCTION t.priv(p text) RETURNS int LANGUAGE sql AS $f$ SELECT count(*)::int FROM public.team_post_private WHERE post_id = t.id(p) $f$;
GRANT EXECUTE ON FUNCTION t.pub(text), t.priv(text) TO anon, authenticated;
SELECT t.as_anon();
SELECT t.eq(t.pub('p-try'), 'Atlanta', 'anonymous visitor: coarse');
SELECT t.eq(t.count('SELECT 1 FROM public.team_post_private'), 0, 'anonymous visitor: no access to the private table');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.pub('p-try'), 'Atlanta', 'signed-in adult stranger: coarse');
SELECT t.eq(t.priv('p-try'), 0, 'and no exact venue');
SELECT t.as_user(t.id('teenstranger'));
SELECT t.eq(t.priv('p-try') + t.priv('p-old'), 0, 'signed-in teen stranger: no exact venue');
SELECT t.as_user(t.id('mgr'));       SELECT t.eq(t.priv('p-try'), 1, 'author and manager: exact venue');
SELECT t.as_user(t.id('coach'));     SELECT t.eq(t.priv('p-try'), 1, 'coach on the team: exact venue');
SELECT t.as_user(t.id('teenmem'));   SELECT t.eq(t.priv('p-try'), 1, 'teen member: exact venue');
SELECT t.as_user(t.id('kidmem'));    SELECT t.eq(t.priv('p-try'), 1, 'under-13 member: exact venue');
SELECT t.as_user(t.id('kidguardian')); SELECT t.eq(t.priv('p-try'), 1, 'verified guardian of a member: exact venue');
SELECT t.as_user(t.id('modone'));    SELECT t.eq(t.priv('p-try'), 1, 'moderator: exact venue');
SELECT t.as_user(t.id('adminone'));  SELECT t.eq(t.priv('p-try'), 1, 'administrator: exact venue');
SELECT t.as_user(t.id('adultplayer')); SELECT t.eq(t.priv('p-try'), 0, 'a member of a different team: no');
SELECT t.reset();

-- ---- tryout registration
SET LOCAL session_replication_role = replica;
INSERT INTO public.tryout_rsvps (post_id, team_id, user_id, registered_by, status) VALUES
  (t.id('p-try'), 'kids', t.id('regkid'), t.id('regparent'), 'registered');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('regparent')); SELECT t.eq(t.priv('p-try'), 1, 'the parent who registered a child: exact venue');
SELECT t.as_user(t.id('regkid'));    SELECT t.eq(t.priv('p-try'), 1, 'the registered child: exact venue');
SELECT t.as_user(t.id('stranger'));  SELECT t.eq(t.priv('p-try'), 0, 'an unregistered stranger: still no');
SELECT t.reset();
UPDATE public.tryout_rsvps SET status = 'cancelled' WHERE post_id = t.id('p-try') AND user_id = t.id('regkid');
SELECT t.as_user(t.id('regparent')); SELECT t.eq(t.priv('p-try'), 0, 'registration cancelled: access ends for the parent');
SELECT t.as_user(t.id('regkid'));    SELECT t.eq(t.priv('p-try'), 0, 'and for the child');
SELECT t.reset();

-- ---- new posts and edits with the switch ON
SELECT t.as_user(t.id('mgr'));
SELECT t.lives(format($q$INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body, event_date, location, formatted_address, lat, lng, place_id)
  VALUES (%L, 'kids', %L, 'tryout', 'Fall tryouts', 'All welcome.', now()+interval '9 days', 'Riverside Park Field 2', 'Riverside Park, 5 Elm Rd, Atlanta', 33.55511, -84.22222, 'place-9')$q$, t.id('p-new'), t.id('mgr')),
  'a manager can post a tryout with a venue (the app is unchanged)');
SELECT t.eq(t.pub('p-new'), 'Atlanta', 'it is published with the coarse form');
SELECT t.eq((SELECT location FROM public.team_post_private WHERE post_id = t.id('p-new')), 'Riverside Park Field 2', 'and its exact venue is kept privately');
SELECT t.lives(format($q$UPDATE public.team_posts SET title = 'Fall tryouts (updated)' WHERE id = %L$q$, t.id('p-new')), 'editing the title round-trips');
SELECT t.eq((SELECT location FROM public.team_post_private WHERE post_id = t.id('p-new')), 'Riverside Park Field 2', 'the exact venue is not overwritten by the coarse one');
SELECT t.lives(format($q$UPDATE public.team_posts SET location = 'New Gym', lat = 33.1, lng = -84.1 WHERE id = %L$q$, t.id('p-new')), 'changing the venue works');
SELECT t.eq((SELECT location FROM public.team_post_private WHERE post_id = t.id('p-new')), 'New Gym', 'the private copy follows');
SELECT t.eq(t.pub('p-new'), 'Atlanta', 'and the public column stays coarse');
SELECT t.lives(format($q$UPDATE public.team_posts SET spots_taken = 3, pinned = true WHERE id = %L$q$, t.id('p-new')), 'unrelated updates (spots, pin) do not disturb it');
SELECT t.reset();

-- ---- text of a private youth post
SELECT t.as_user(t.id('mgr'));
SELECT t.throws(format($q$INSERT INTO public.team_posts (team_id, author_id, kind, title, body) VALUES ('kids', %L, 'announcement', 'Practice at 12 Oak St', 'See you.')$q$, t.id('mgr')),
  'LOCATION_IN_PUBLIC_TEXT', 'a title with the street address is refused');
SELECT t.throws(format($q$INSERT INTO public.team_posts (team_id, author_id, kind, title, body) VALUES ('kids', %L, 'announcement', 'Practice', 'Directions: https://maps.google.com/?q=33.7,-84.3')$q$, t.id('mgr')),
  'LOCATION_IN_PUBLIC_TEXT', 'a body with a map link is refused');
SELECT t.throws(format($q$UPDATE public.team_posts SET body = 'We meet at Lincoln Elementary' WHERE id = %L$q$, t.id('p-try')),
  'LOCATION_IN_PUBLIC_TEXT', 'an edit that names the venue is refused');
SELECT t.lives(format($q$INSERT INTO public.team_posts (team_id, author_id, kind, title, body) VALUES ('kids', %L, 'announcement', 'Great weekend', 'Thanks to every family in Atlanta for coming out. Next game Saturday 10am.')$q$, t.id('mgr')), 'ordinary announcements and area names pass');
SELECT t.reset();
SELECT t.lives(format($q$INSERT INTO public.team_posts (team_id, author_id, kind, title, body) VALUES ('adults', %L, 'announcement', 'Meet at 1 Main St', 'Adult team: addresses are fine.')$q$, t.id('adultmgr')), 'an adult team''s text is not restricted');

-- ---- explicit public-venue policy
SELECT t.as_user(t.id('mgr'));
SELECT t.lives(format($q$UPDATE public.team_posts SET public_venue_requested = true WHERE id = %L$q$, t.id('p-try')), 'the author can request a public-venue review');
SELECT t.lives(format($q$UPDATE public.team_posts SET public_venue = true WHERE id = %L$q$, t.id('p-try')), 'a manager trying to set public_venue is not an error ...');
SELECT t.reset();
SELECT t.eq((SELECT public_venue FROM public.team_posts WHERE id = t.id('p-try')), false, '... but the value is reverted: only a moderator can verify');
SELECT t.as_user(t.id('mgr'));
SELECT t.throws(format($q$SELECT public.verify_team_post_public_venue(%L)$q$, t.id('p-try')), 'Moderators only', 'a manager cannot call the verification');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$SELECT public.verify_team_post_public_venue(%L)$q$, t.id('p-try')), 'Moderators only', 'nor a stranger');
SELECT t.as_anon();
SELECT t.throws(format($q$SELECT public.verify_team_post_public_venue(%L)$q$, t.id('p-try')), 'permission denied', 'nor an anonymous caller');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT * FROM public.list_team_post_venue_requests()$q$, 'Moderators only', 'only moderators list the requests');
SELECT t.as_user(t.id('modone'));
SELECT t.eq((SELECT count(*)::int FROM public.list_team_post_venue_requests() WHERE post_id = t.id('p-try')), 1, 'a moderator sees the request');
SELECT t.lives(format($q$SELECT public.verify_team_post_public_venue(%L, 'School open day; venue is the public school gym')$q$, t.id('p-try')), 'a moderator can verify it');
SELECT t.reset();
SELECT t.ok((SELECT public_venue AND location = 'Lincoln Elementary Gym' AND lat = 33.77712 AND place_id = 'place-1' FROM public.team_posts WHERE id = t.id('p-try')), 'the verified venue is shown publicly in full');
SELECT t.eq((SELECT verified_by FROM public.team_post_public_venues WHERE post_id = t.id('p-try')), t.id('modone'), 'who verified it is recorded');
UPDATE public.team_posts SET moderation_status = 'approved' WHERE id = t.id('p-try');   -- the post-text moderation queue is a separate gate
SELECT t.as_anon();
SELECT t.eq(t.pub('p-try'), 'Lincoln Elementary Gym', 'anonymous visitors now see the public venue');
SELECT t.reset();
SELECT t.as_user(t.id('mgr'));
SELECT t.lives(format($q$UPDATE public.team_posts SET location = 'Different Gym', lat = 33.2, lng = -84.2 WHERE id = %L$q$, t.id('p-try')), 'the manager moves the event');
SELECT t.reset();
SELECT t.ok((SELECT NOT public_venue AND location = 'Atlanta' FROM public.team_posts WHERE id = t.id('p-try')), 'moving a verified venue clears the verification and re-coarsens');
SELECT t.eq((SELECT location FROM public.team_post_private WHERE post_id = t.id('p-try')), 'Different Gym', 'the new venue is private');
SELECT t.as_user(t.id('modone'));
SELECT t.lives(format($q$SELECT public.verify_team_post_public_venue(%L)$q$, t.id('p-try')), 'verified again');
SELECT t.lives(format($q$SELECT public.revoke_team_post_public_venue(%L)$q$, t.id('p-try')), 'a moderator can revoke it');
SELECT t.reset();
SELECT t.ok((SELECT NOT public_venue AND location = 'Atlanta' FROM public.team_posts WHERE id = t.id('p-try')), 'revoking re-coarsens the public columns');
SELECT t.eq((SELECT count(*)::int FROM public.team_post_public_venues WHERE post_id = t.id('p-try')), 0, 'and removes the record');

-- ---- exposure paths
SELECT t.eq((SELECT count(*)::int FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename IN ('team_post_private', 'team_post_public_venues')), 0, 'neither new table is in the realtime publication');
SELECT t.eq(has_table_privilege('anon', 'public.team_post_private', 'SELECT'), false, 'anon has no privilege on the private table');
SELECT t.eq(has_table_privilege('authenticated', 'public.team_post_private', 'INSERT,UPDATE,DELETE'), false, 'no client can write it');
SELECT t.eq(has_table_privilege('authenticated', 'public.team_post_public_venues', 'SELECT'), false, 'nor read the verification record');
SELECT t.eq(has_function_privilege('anon', 'public.sync_team_post_private()', 'EXECUTE'), false, 'trigger functions are not callable by API roles');
SELECT t.throws($q$UPDATE public.app_settings SET value = '{"coarsen": false}'::jsonb WHERE key = 'youth_location_privacy'$q$, 'COARSENING_IRREVERSIBLE', 'the shared switch stays one-way');
ROLLBACK;
