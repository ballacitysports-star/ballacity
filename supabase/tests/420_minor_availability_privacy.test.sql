-- R2: availability posts by people who are not confirmed adults are visible only to people with a reason; contact requests follow the
-- messaging rules; writes by minors never hold coordinates or an address.
BEGIN;
SELECT t.person('teen17', 17), t.person('teen15', 15), t.person('kid11', 11), t.person('adultpost', 30), t.person('stranger', 33),
       t.person('teenstranger', 16), t.person('mate', 28), t.person('mgr', 38), t.person('guardian', 40), t.person('modone', 39),
       t.person('adminone', 45), t.person('follower', 26), t.person('unk', 30), t.person('teenfree', 17);
SELECT t.guardian('guardian', 'teen17');
SELECT t.team('squad', 'mgr');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('adminone'), 'admin');
SET LOCAL session_replication_role = replica;
INSERT INTO public.team_members (team_id, user_id) VALUES ('squad', t.id('teen17')), ('squad', t.id('mate'));
-- both joined through accepted invitations, the teen's approved by their guardian (R7: what counts as a messaging context)
INSERT INTO public.team_invites (team_id, invitee_id, invited_by, status, guardian_approved_at, guardian_approved_by) VALUES
  ('squad', t.id('teen17'), t.id('mgr'), 'accepted', now(), t.id('guardian')), ('squad', t.id('mate'), t.id('mgr'), 'accepted', NULL, NULL);
INSERT INTO public.follows (follower_id, followee_id) VALUES (t.id('follower'), t.id('teen17'));
UPDATE public.profiles SET age_cohort = 'unknown' WHERE id = t.id('unk');
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, recurring_days, city, travel_radius_km, note, status, time_slots, lat, lng, formatted_address, place_id) VALUES
  ('00000000-0000-0000-0000-0000000000a1', t.id('adultpost'), ARRAY['Basketball'], 'All Levels', ARRAY['Mon'], 'Atlanta', 10, 'Pickup runs', 'open', '[]'::jsonb, 33.75, -84.39, 'Atlanta, GA', NULL),
  ('00000000-0000-0000-0000-0000000000a2', t.id('teen17'), ARRAY['Basketball'], 'All Levels', ARRAY['Tue','Thu'], 'Atlanta', 10, 'After school', 'open', '[]'::jsonb, 33.7512, -84.3912, '12 Oak St, Atlanta', 'pid'),
  ('00000000-0000-0000-0000-0000000000a3', t.id('teen17'), ARRAY['Soccer'], 'All Levels', ARRAY['Sat'], 'Atlanta', 10, 'Old closed post', 'closed', '[]'::jsonb, NULL, NULL, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a4', t.id('kid11'), ARRAY['Soccer'], 'All Levels', ARRAY['Sat'], 'Atlanta', 10, 'Kid post', 'open', '[]'::jsonb, NULL, NULL, NULL, NULL),
  ('00000000-0000-0000-0000-0000000000a5', t.id('unk'), ARRAY['Tennis'], 'All Levels', ARRAY['Sun'], 'Atlanta', 10, 'Unknown age', 'open', '[]'::jsonb, NULL, NULL, NULL, NULL);
SET LOCAL session_replication_role = origin;

CREATE FUNCTION t.posts() RETURNS text LANGUAGE sql AS $f$
  SELECT COALESCE(string_agg(right(id::text, 2), ',' ORDER BY id), '-') FROM public.player_availabilities $f$;
GRANT EXECUTE ON FUNCTION t.posts() TO anon, authenticated;

-- ================= 1. reads =================
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.player_availabilities'), 0, 'anonymous: nothing');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.posts(), 'a1', 'adult stranger: only the adult''s post (not the teen, not the child, not the unknown age)');
SELECT t.as_user(t.id('teenstranger'));
SELECT t.eq(t.posts(), 'a1', 'teen stranger: only the adult''s post');
SELECT t.as_user(t.id('teen15'));
SELECT t.eq(t.posts(), 'a1', 'another minor: only the adult''s post');
SELECT t.as_user(t.id('adultpost'));
SELECT t.eq(t.posts(), 'a1', 'an adult author sees their own post as before');
SELECT t.as_user(t.id('teen17'));
SELECT t.eq(t.posts(), 'a1,a2,a3', 'the teen sees their own posts (open and closed) and the adult''s');
SELECT t.as_user(t.id('kid11'));
SELECT t.eq(t.posts(), 'a1,a4', 'the child sees their own post');
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.posts(), 'a1,a2,a3', 'the verified guardian sees the child''s posts, open and closed');
SELECT t.as_user(t.id('mate'));
SELECT t.eq(t.posts(), 'a1,a2', 'a teammate sees the teen''s open post only');
SELECT t.as_user(t.id('mgr'));
SELECT t.eq(t.posts(), 'a1,a2', 'the team manager sees the teen''s open post');
SELECT t.as_user(t.id('follower'));
SELECT t.eq(t.posts(), 'a1,a2', 'an accepted follower sees the teen''s open post');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.posts(), 'a1,a2,a4,a5', 'a moderator sees open posts of minors and unknown ages');
SELECT t.as_user(t.id('adminone'));
SELECT t.eq(t.posts(), 'a1,a2,a4,a5', 'an administrator too');
SELECT t.as_user(t.id('unk'));
SELECT t.eq(t.posts(), 'a1,a5', 'a person of unknown age sees the adult post and their own');
SELECT t.reset();

-- Realtime and other read paths use the same policy: one SELECT policy, none for anonymous.
SELECT t.eq((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'player_availabilities' AND cmd IN ('SELECT', 'ALL')), 1, 'exactly one read policy decides every read, including Realtime');
SELECT t.eq(has_table_privilege('anon', 'public.player_availabilities', 'SELECT'), false, 'anonymous has no table privilege');
SELECT t.eq(has_function_privilege('anon', 'private_sec.availability_post_visible(uuid)', 'EXECUTE'), false, 'the visibility helper is not callable anonymously');
SELECT t.eq(has_function_privilege('authenticated', 'public.guard_minor_availability_write()', 'EXECUTE'), false, 'the trigger function is not callable by clients');
SELECT t.ok(EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'player_availabilities'), 'the table is in the Realtime publication (so the policy above is what gates it)');

-- ================= 2. writes =================
SELECT t.as_user(t.id('teenfree'));
SELECT t.lives($q$INSERT INTO public.player_availabilities (user_id, sports, skill_level, recurring_days, city, note, lat, lng, formatted_address, place_id) VALUES (t.id('teenfree'), ARRAY['Tennis'], 'All Levels', ARRAY['Mon'], 'Atlanta', 'Looking for a hitting partner', 33.7512, -84.3912, '55 Pine Rd, Atlanta, GA', 'pid2')$q$, 'a teen can post');
SELECT t.reset();
SELECT t.ok((SELECT lat IS NULL AND lng IS NULL AND formatted_address IS NULL AND place_id IS NULL AND city = 'Atlanta' FROM public.player_availabilities WHERE user_id = t.id('teenfree')), 'the stored post has the city only: no coordinates, address or place id');
SELECT t.as_user(t.id('teenfree'));
SELECT t.throws($q$UPDATE public.player_availabilities SET note = 'meet at 55 Pine Rd' WHERE user_id = t.id('teenfree')$q$, 'LOCATION_IN_PUBLIC_TEXT', 'a note with an address is refused');
SELECT t.throws($q$UPDATE public.player_availabilities SET note = 'https://maps.google.com/?q=33.75,-84.39' WHERE user_id = t.id('teenfree')$q$, 'LOCATION_IN_PUBLIC_TEXT', 'a map link is refused');
SELECT t.lives($q$UPDATE public.player_availabilities SET note = 'Weekday evenings, any court', lat = 33.9, lng = -84.1 WHERE user_id = t.id('teenfree')$q$, 'a plain note is accepted (coordinates in the request are dropped)');
SELECT t.reset();
SELECT t.ok((SELECT lat IS NULL AND lng IS NULL FROM public.player_availabilities WHERE user_id = t.id('teenfree')), 'an update cannot add coordinates');
SELECT t.as_user(t.id('adultpost'));
SELECT t.lives($q$UPDATE public.player_availabilities SET lat = 33.76, lng = -84.40, note = 'Court at 5 Elm St' WHERE user_id = t.id('adultpost')$q$, 'an adult''s post is unaffected');
SELECT t.reset();
SELECT t.ok((SELECT lat IS NOT NULL AND note = 'Court at 5 Elm St' FROM public.player_availabilities WHERE user_id = t.id('adultpost')), 'adult coordinates and note are kept');

-- ================= 3. contact requests =================
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a2', 'contact', 'hi')$q$, 'MINOR_MESSAGING_BLOCKED', 'an adult stranger cannot contact a teen through a post');
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('kid11'), '00000000-0000-0000-0000-0000000000a4', 'contact', 'hi')$q$, 'MINOR_MESSAGING_BLOCKED', 'nor a child');
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('unk'), '00000000-0000-0000-0000-0000000000a5', 'contact', 'hi')$q$, 'MINOR_MESSAGING_BLOCKED', 'nor a person of unknown age');
SELECT t.lives($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('adultpost'), '00000000-0000-0000-0000-0000000000a1', 'contact', 'hi')$q$, 'adult to adult is unchanged');
SELECT t.as_user(t.id('teen15'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('teen15'), t.id('adultpost'), '00000000-0000-0000-0000-0000000000a1', 'contact', 'hi')$q$, 'MINOR_MESSAGING_BLOCKED', 'a 15-year-old cannot contact an adult stranger (existing shared-context rule now applies to requests)');
SELECT t.as_user(t.id('mate'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('mate'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a2', 'contact', 'practice?')$q$, 'guardian_only', 'a teammate is still stopped by the guardian''s "guardian only" control');
SELECT t.reset();
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('teen17');
SELECT t.as_user(t.id('mate'));
SELECT t.lives($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('mate'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a2', 'contact', 'practice?')$q$, 'a teammate can contact the teen once the guardian allows teammates');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a2', 'contact', 'hi')$q$, 'MINOR_MESSAGING_BLOCKED', 'a stranger is refused whatever the controls say');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('guardian'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a2', 'contact', 'dinner?')$q$, 'a guardian can contact their own child');
SELECT t.as_user(t.id('teenfree'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('teenfree'), t.id('adultpost'), '00000000-0000-0000-0000-0000000000a1', 'contact', 'hi')$q$, 'needs_guardian_link', 'a 17-year-old with no linked guardian cannot contact an adult through a post (R7: link a guardian first)');
SELECT t.reset();
-- ================= 4. legacy data procedure (defined, never run by the migration)
SET LOCAL session_replication_role = replica;
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, recurring_days, city, travel_radius_km, note, status, time_slots, lat, lng, formatted_address, place_id) VALUES
  ('00000000-0000-0000-0000-0000000000c1', t.id('teen17'), ARRAY['Tennis'], 'All Levels', ARRAY['Mon'], 'Atlanta', 10, 'Meet at 77 Birch Ave', 'closed', '[]'::jsonb, 33.77, -84.37, '77 Birch Ave', 'p9'),
  ('00000000-0000-0000-0000-0000000000c2', t.id('kid11'), ARRAY['Tennis'], 'All Levels', ARRAY['Mon'], 'Atlanta', 10, 'ok', 'closed', '[]'::jsonb, 33.78, -84.38, '1 Pine St', 'p8'),
  ('00000000-0000-0000-0000-0000000000c3', t.id('adultpost'), ARRAY['Tennis'], 'All Levels', ARRAY['Mon'], 'Atlanta', 10, 'adult note', 'closed', '[]'::jsonb, 33.79, -84.39, '5 Oak Rd', 'p7');
SET LOCAL session_replication_role = origin;
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.blank_minor_availability_location(integer)', 'EXECUTE'), false, 'clients cannot run the blanking procedure');
SELECT t.eq((SELECT count(*)::int FROM public.player_availabilities WHERE user_id IN (t.id('teen17'), t.id('kid11')) AND (lat IS NOT NULL OR formatted_address IS NOT NULL OR place_id IS NOT NULL)), 3, 'before: legacy rows by minors hold precise values (a2 from the fixture, c1, c2)');
SELECT t.eq(private_sec.blank_minor_availability_location(1), 1, 'a batch of one blanks one row');
SELECT t.eq(private_sec.blank_minor_availability_location(500), 2, 'the rest in the next batch');
SELECT t.eq(private_sec.blank_minor_availability_location(500), 0, 'then it returns 0 and is idempotent');
SELECT t.eq((SELECT count(*)::int FROM public.player_availabilities WHERE user_id IN (t.id('teen17'), t.id('kid11')) AND (lat IS NOT NULL OR lng IS NOT NULL OR formatted_address IS NOT NULL OR place_id IS NOT NULL)), 0, 'after: no minor row holds a coordinate, address or place id');
SELECT t.eq((SELECT city FROM public.player_availabilities WHERE id = '00000000-0000-0000-0000-0000000000c1'), 'Atlanta', 'the city is kept');
SELECT t.ok((SELECT lat IS NOT NULL AND formatted_address = '5 Oak Rd' FROM public.player_availabilities WHERE id = '00000000-0000-0000-0000-0000000000c3'), 'an adult''s row is untouched');
SELECT t.eq((SELECT sum((metadata ->> 'rows')::int)::int FROM public.admin_audit_log WHERE action = 'minor_availability_location_blanked'), 3, 'the run is audited with counts only');
SELECT t.as_user(t.id('teen17'));
SELECT t.lives($q$UPDATE public.player_availabilities SET lat = 33.1, lng = -84.1, formatted_address = '9 New St' WHERE id = '00000000-0000-0000-0000-0000000000c1'$q$, 'the owner can edit the post');
SELECT t.reset();
SELECT t.ok((SELECT lat IS NULL AND formatted_address IS NULL FROM public.player_availabilities WHERE id = '00000000-0000-0000-0000-0000000000c1'), 'but a precise value never returns to a minor''s row');
SELECT t.as_user(t.id('modone'));
SELECT t.ok((SELECT count(*) FROM public.list_minor_availability_notes_with_location_text() WHERE post_id = '00000000-0000-0000-0000-0000000000c1') = 1, 'a moderator finds the note that names a place');
SELECT t.ok((SELECT count(*) FROM public.list_minor_availability_notes_with_location_text() WHERE post_id = '00000000-0000-0000-0000-0000000000c3') = 0, 'but not an adult''s');
SELECT t.lives($q$SELECT public.moderator_scrub_availability_note('00000000-0000-0000-0000-0000000000c1', 'names a place')$q$, 'and scrubs it');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$SELECT * FROM public.list_minor_availability_notes_with_location_text()$q$, 'Moderators only', 'a member cannot list');
SELECT t.throws($q$SELECT public.moderator_scrub_availability_note('00000000-0000-0000-0000-0000000000c1')$q$, 'Moderators only', 'or scrub');
SELECT t.reset();
SELECT t.ok((SELECT note IS NULL FROM public.player_availabilities WHERE id = '00000000-0000-0000-0000-0000000000c1'), 'the note is removed');
SELECT t.eq((SELECT count(*)::int FROM public.admin_audit_log WHERE action = 'availability_note_scrubbed' AND actor_id = t.id('modone') AND reason = 'names a place'), 1, 'audited with the moderator and without a copy of the text');

ROLLBACK;
