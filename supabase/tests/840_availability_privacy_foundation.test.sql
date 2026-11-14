-- WP 1.0 (20261114100000_availability_privacy_foundation): availability posts by people who are not confirmed adults are visible only to
-- people with a reason (R2); hidden posts, blocks and suspended authors are respected; contact requests and invitations need a post the
-- sender can read and follow the messaging rules; writes by minors never hold coordinates or an address; consent revocation works for a
-- child with a post; authors cannot change moderation fields; a player can change their own position in a game.
-- Sections 1-4 are R2's test 420 (#265), with the refusal codes of SEC-2b.
BEGIN;
SELECT t.person('teen17', 17), t.person('teen15', 15), t.person('kid11', 11), t.person('adultpost', 30), t.person('stranger', 33),
       t.person('teenstranger', 16), t.person('mate', 28), t.person('mgr', 38), t.person('guardian', 40), t.person('modone', 39),
       t.person('adminone', 45), t.person('follower', 26), t.person('unk', 30), t.person('teenfree', 17);
SELECT t.guardian('guardian', 'teen17');
SELECT t.team('squad', 'mgr');
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('modone'), 'moderator'), (t.id('adminone'), 'admin');
SET LOCAL session_replication_role = replica;
INSERT INTO public.team_members (team_id, user_id) VALUES ('squad', t.id('teen17')), ('squad', t.id('mate'));
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
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.can_see_minor_name(uuid,uuid)', 'EXECUTE'), false, 'the relationship helper is not callable by clients');
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
-- Every refusal about the recipient or the post is the one SEC-2b code; refusals about the sender keep their ':self' code.
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a2', 'contact', 'hi')$q$, 'recipient_restricted:other', 'an adult stranger cannot contact a teen through a post');
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('kid11'), '00000000-0000-0000-0000-0000000000a4', 'contact', 'hi')$q$, 'recipient_restricted:other', 'nor a child');
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('unk'), '00000000-0000-0000-0000-0000000000a5', 'contact', 'hi')$q$, 'recipient_restricted:other', 'nor a person of unknown age');
SELECT t.lives($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('adultpost'), '00000000-0000-0000-0000-0000000000a1', 'contact', 'hi')$q$, 'adult to adult is unchanged');
SELECT t.as_user(t.id('teen15'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('teen15'), t.id('adultpost'), '00000000-0000-0000-0000-0000000000a1', 'contact', 'hi')$q$, ':self', 'a 15-year-old cannot contact an adult stranger (existing shared-context rule now applies to requests), and is told it is about their own account');
SELECT t.as_user(t.id('mate'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('mate'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a2', 'contact', 'practice?')$q$, 'recipient_restricted:other', 'a teammate is still stopped by the guardian''s "guardian only" control, without being told which control');
SELECT t.reset();
UPDATE public.child_controls SET messaging = 'teammates' WHERE child_user_id = t.id('teen17');
SELECT t.as_user(t.id('mate'));
SELECT t.lives($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('mate'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a2', 'contact', 'practice?')$q$, 'a teammate can contact the teen once the guardian allows teammates');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a2', 'contact', 'hi')$q$, 'recipient_restricted:other', 'a stranger is refused whatever the controls say');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('guardian'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a2', 'contact', 'dinner?')$q$, 'a guardian can contact their own child');
SELECT t.as_user(t.id('teenfree'));
SELECT t.lives($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('teenfree'), t.id('adultpost'), '00000000-0000-0000-0000-0000000000a1', 'contact', 'hi')$q$, 'a 17-year-old without guardian controls can still contact an adult through the adult''s post (unchanged; see the R7 note)');
-- New in WP 1.0: the post must be one the sender can read, addressed to its author; the identity check comes first.
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('mate'), t.id('adultpost'), '00000000-0000-0000-0000-0000000000a1', 'contact', 'hi')$q$, 'from_user_id must match', 'a request in someone else''s name is refused before any other check');
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('teenfree'), '00000000-0000-0000-0000-0000000000a1', 'contact', 'hi')$q$, 'recipient_restricted:other', 'a recipient who is not the post''s author is refused with the same answer');
SELECT t.as_user(t.id('mate'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('mate'), t.id('teen17'), '00000000-0000-0000-0000-0000000000a3', 'contact', 'hi')$q$, 'recipient_restricted:other', 'a closed post takes no requests, even from someone who knows the author');
SELECT t.as_user(t.id('stranger'));
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('adultpost'), '00000000-0000-0000-0000-0000000000ff', 'contact', 'hi')$q$, 'recipient_restricted:other', 'a post that does not exist gets the same answer');
SELECT t.reset();

-- ================= 4. legacy data procedure (defined, never run by the migration) =================
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

-- ================= 5. hidden posts, blocks and suspended authors (new in WP 1.0) =================
SELECT t.person('adult2', 31), t.person('adult3', 32), t.person('blocker', 34);
SET LOCAL session_replication_role = replica;
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, city, travel_radius_km, status, time_slots, hidden_at) VALUES
  ('00000000-0000-0000-0000-0000000000d1', t.id('adult2'), ARRAY['Basketball'], 'All Levels', 'Buford', 10, 'open', '[]'::jsonb, now()),
  ('00000000-0000-0000-0000-0000000000d2', t.id('adult3'), ARRAY['Basketball'], 'All Levels', 'Buford', 10, 'open', '[]'::jsonb, NULL),
  ('00000000-0000-0000-0000-0000000000d3', t.id('blocker'), ARRAY['Basketball'], 'All Levels', 'Buford', 10, 'open', '[]'::jsonb, NULL),
  ('00000000-0000-0000-0000-0000000000d4', t.id('stranger'), ARRAY['Basketball'], 'All Levels', 'Buford', 10, 'open', '[]'::jsonb, NULL);
SET LOCAL session_replication_role = origin;
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blocker'), t.id('stranger'));
CREATE FUNCTION t.dposts() RETURNS text LANGUAGE sql AS $f$
  SELECT COALESCE(string_agg(right(id::text, 2), ',' ORDER BY id), '-') FROM public.player_availabilities
   WHERE id IN ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2',
                '00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000d4') $f$;
GRANT EXECUTE ON FUNCTION t.dposts() TO authenticated;
SELECT t.as_user(t.id('adult3'));
SELECT t.eq(t.dposts(), 'd2,d3,d4', 'a post BallaCity hid is not listed to others');
SELECT t.as_user(t.id('adult2'));
SELECT t.eq(t.dposts(), 'd1,d2,d3,d4', 'its author still sees it');
SELECT t.throws($q$UPDATE public.player_availabilities SET hidden_at = NULL WHERE id = '00000000-0000-0000-0000-0000000000d1'$q$, 'AVAILABILITY_FIELD_FORBIDDEN', 'and cannot unhide it');
SELECT t.lives($q$UPDATE public.player_availabilities SET note = 'Still around' WHERE id = '00000000-0000-0000-0000-0000000000d1'$q$, 'but can still edit the post');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.dposts(), 'd2,d4', 'a person someone blocked does not see the blocker''s post');
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('stranger'), t.id('blocker'), '00000000-0000-0000-0000-0000000000d3', 'contact', 'hi')$q$, 'recipient_restricted:other', 'and cannot reach them through it; the answer does not name the block');
SELECT t.as_user(t.id('blocker'));
SELECT t.eq(t.dposts(), 'd2,d3', 'and the blocker does not see the blocked person''s post either');
SELECT t.reset();
UPDATE public.profiles SET suspended_at = now() WHERE id = t.id('adult3');
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.dposts(), 'd4', 'a suspended author''s post is not listed');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.dposts(), 'd2,d3,d4', 'a moderator still sees it (and every unhidden open post)');
SELECT t.reset();
UPDATE public.profiles SET suspended_at = NULL, moderation_state = 'banned' WHERE id = t.id('adult3');
SELECT t.as_user(t.id('adult2'));
SELECT t.eq(t.dposts(), 'd1,d3,d4', 'a banned author''s post is not listed either');
SELECT t.reset();

-- ================= 6. status: closed and revoked posts (new in WP 1.0) =================
SELECT t.as_user(t.id('teen17'));
SELECT t.throws($q$UPDATE public.player_availabilities SET status = 'open' WHERE id = '00000000-0000-0000-0000-0000000000a3'$q$, 'AVAILABILITY_FIELD_FORBIDDEN', 'an author cannot reopen a closed post');
SELECT t.as_user(t.id('adultpost'));
SELECT t.throws($q$UPDATE public.player_availabilities SET status = 'closed' WHERE id = '00000000-0000-0000-0000-0000000000a1'$q$, 'AVAILABILITY_FIELD_FORBIDDEN', 'or change the status of an open one');
SELECT t.reset();
SELECT t.as_service();
SELECT t.lives($q$UPDATE public.player_availabilities SET status = 'closed' WHERE id = '00000000-0000-0000-0000-0000000000a1'$q$, 'server code (the moderators'' close action) can close a post');
SELECT t.lives($q$UPDATE public.player_availabilities SET status = 'open' WHERE id = '00000000-0000-0000-0000-0000000000a1'$q$, 'and reopen it');
SELECT t.reset();
-- A guardian withdraws consent for a child who has a post. Before WP 1.0 the whole revocation failed with "Invalid status: inactive".
SELECT t.person('kidpost', 10), t.person('kidparent', 42);
SELECT t.guardian('kidparent', 'kidpost');
SELECT t.as_user(t.id('kidpost'));
SELECT t.lives($q$INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, city, status, time_slots) VALUES ('00000000-0000-0000-0000-0000000000e1', t.id('kidpost'), ARRAY['Soccer'], 'All Levels', 'Buford', 'open', '[]'::jsonb)$q$, 'a child with consent can post');
SELECT t.as_user(t.id('kidparent'));
SELECT t.lives(format($q$SELECT public.revoke_parental_consent(%L, 'parent decided')$q$, t.id('kidpost')), 'the guardian can withdraw consent while the child has a post');
SELECT t.reset();
SELECT t.ok((SELECT status = 'inactive' AND hidden_at IS NOT NULL FROM public.player_availabilities WHERE id = '00000000-0000-0000-0000-0000000000e1'), 'the post is set inactive and hidden');
SELECT t.eq((SELECT status FROM public.parental_consents WHERE child_user_id = t.id('kidpost')), 'revoked', 'and the consent is revoked');
SELECT t.as_user(t.id('kidpost'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.player_availabilities WHERE id = '00000000-0000-0000-0000-0000000000e1'$q$), 1, 'the child still sees their own post');
SELECT t.throws($q$UPDATE public.player_availabilities SET status = 'open', hidden_at = NULL WHERE id = '00000000-0000-0000-0000-0000000000e1'$q$, 'AVAILABILITY_FIELD_FORBIDDEN', 'but cannot reopen it');
SELECT t.as_user(t.id('kidparent'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.player_availabilities WHERE id = '00000000-0000-0000-0000-0000000000e1'$q$), 1, 'the guardian sees it');
SELECT t.as_user(t.id('modone'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.player_availabilities WHERE id = '00000000-0000-0000-0000-0000000000e1'$q$), 0, 'nobody else does, staff included');
SELECT t.reset();
SELECT t.throws($q$INSERT INTO public.player_availabilities (user_id, sports, skill_level, status, time_slots) VALUES (t.id('adultpost'), ARRAY['Soccer'], 'All Levels', 'paused', '[]'::jsonb)$q$, 'Invalid status', 'statuses outside open, closed and inactive are still refused');

-- ================= 7. a player can change their own position in a game (new in WP 1.0) =================
SELECT t.person('ghost', 40), t.person('gplayer', 29);
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players)
VALUES ('wp10-run', t.id('ghost'), 'Thursday run', 'Basketball', now() + interval '2 days', 'Gym', 10);
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_participants (game_id, user_id, position) VALUES ('wp10-run', t.id('gplayer'), 'Guard');
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('gplayer'));
SELECT t.eq(t.changed($q$UPDATE public.game_participants SET position = 'Forward' WHERE game_id = 'wp10-run' AND user_id = t.id('gplayer')$q$), 1,
  'a player can change their own position (it failed with "relation public.games does not exist")');
SELECT t.throws($q$UPDATE public.game_participants SET created_at = now() - interval '1 day' WHERE game_id = 'wp10-run' AND user_id = t.id('gplayer')$q$, 'PARTICIPANT_FIELD_FORBIDDEN', 'but nothing else about their place');
SELECT t.reset();
SELECT t.eq((SELECT position FROM public.game_participants WHERE game_id = 'wp10-run' AND user_id = t.id('gplayer')), 'Forward', 'the new position is stored');

ROLLBACK;
