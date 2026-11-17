-- WP 1.1 (20261114110000_availability_intent_and_lifecycle): a 'pickup' intent; the author can pause and resume a post; posts stop being
-- listed when their last dated slot ends or, for weekly posts, 14 days after the author last confirmed them; moderation and guardian
-- states stay locked; a malformed legacy row never breaks the listing.
BEGIN;
SELECT t.person('author', 30), t.person('viewer', 31), t.person('other', 32);

CREATE FUNCTION t.vis(_id text) RETURNS boolean LANGUAGE sql AS $f$
  SELECT EXISTS (SELECT 1 FROM public.player_availabilities WHERE id = ('00000000-0000-0000-0000-0000000000' || _id)::uuid) $f$;
GRANT EXECUTE ON FUNCTION t.vis(text) TO authenticated;

-- ================= 1. intent =================
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, city, looking_for, time_slots)
  VALUES ('00000000-0000-0000-0000-0000000000b1', t.id('author'), ARRAY['Basketball'], 'All Levels', 'Buford', ARRAY['pickup','guest'], '[{"weekday":2,"start":"18:00","end":"20:00"}]'::jsonb)$q$,
  'a post can say pickup (with guest)');
SELECT t.throws($q$INSERT INTO public.player_availabilities (user_id, sports, skill_level, looking_for, time_slots)
  VALUES (t.id('author'), ARRAY['Basketball'], 'All Levels', ARRAY['pickups'], '[]'::jsonb)$q$, 'looking_for_check', 'an unknown intent is refused');
SELECT t.as_user(t.id('viewer'));
SELECT t.ok(t.vis('b1'), 'a fresh weekly post is listed to others');

-- ================= 2. pause and resume =================
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$UPDATE public.player_availabilities SET status = 'paused' WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$, 'the author can pause');
SELECT t.ok(t.vis('b1'), 'and still sees the paused post');
SELECT t.as_user(t.id('viewer'));
SELECT t.ok(NOT t.vis('b1'), 'a paused post is listed to nobody else');
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('viewer'), t.id('author'), '00000000-0000-0000-0000-0000000000b1', 'contact', 'hi')$q$, 'recipient_restricted:other', 'and takes no requests');
SELECT t.reset();
UPDATE public.player_availabilities SET last_confirmed_at = now() - interval '30 days' WHERE id = '00000000-0000-0000-0000-0000000000b1';
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$UPDATE public.player_availabilities SET status = 'open' WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$, 'the author can resume');
SELECT t.reset();
SELECT t.ok((SELECT last_confirmed_at > now() - interval '1 minute' FROM public.player_availabilities WHERE id = '00000000-0000-0000-0000-0000000000b1'), 'resuming counts as confirming');
SELECT t.as_user(t.id('viewer'));
SELECT t.ok(t.vis('b1'), 'the resumed post is listed again');

-- ================= 3. states the author cannot set =================
SELECT t.as_user(t.id('author'));
SELECT t.throws($q$UPDATE public.player_availabilities SET status = 'closed' WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$, 'AVAILABILITY_FIELD_FORBIDDEN', 'not closed');
SELECT t.throws($q$UPDATE public.player_availabilities SET status = 'expired' WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$, 'AVAILABILITY_FIELD_FORBIDDEN', 'not expired');
SELECT t.throws($q$UPDATE public.player_availabilities SET status = 'inactive' WHERE id = '00000000-0000-0000-0000-0000000000b1'$q$, 'AVAILABILITY_FIELD_FORBIDDEN', 'not inactive');
SELECT t.throws($q$INSERT INTO public.player_availabilities (user_id, sports, skill_level, status, time_slots) VALUES (t.id('author'), ARRAY['Soccer'], 'All Levels', 'closed', '[]'::jsonb)$q$, 'AVAILABILITY_FIELD_FORBIDDEN', 'a new post cannot start closed');
SELECT t.throws($q$INSERT INTO public.player_availabilities (user_id, sports, skill_level, hidden_at, time_slots) VALUES (t.id('author'), ARRAY['Soccer'], 'All Levels', now(), '[]'::jsonb)$q$, 'AVAILABILITY_FIELD_FORBIDDEN', 'or hidden');
SELECT t.lives($q$INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, status, time_slots, last_confirmed_at) VALUES ('00000000-0000-0000-0000-0000000000b2', t.id('author'), ARRAY['Soccer'], 'All Levels', 'paused', '[]'::jsonb, '2000-01-01')$q$, 'a new post can start paused');
SELECT t.reset();
SELECT t.ok((SELECT last_confirmed_at > now() - interval '1 minute' FROM public.player_availabilities WHERE id = '00000000-0000-0000-0000-0000000000b2'), 'and its last_confirmed_at is set by the server, not the client');
SELECT t.as_service();
SELECT t.lives($q$UPDATE public.player_availabilities SET status = 'closed' WHERE id = '00000000-0000-0000-0000-0000000000b2'$q$, 'server code can close');
SELECT t.reset();
SELECT t.as_user(t.id('author'));
SELECT t.throws($q$UPDATE public.player_availabilities SET status = 'open' WHERE id = '00000000-0000-0000-0000-0000000000b2'$q$, 'AVAILABILITY_FIELD_FORBIDDEN', 'and the author cannot reopen a closed post');
SELECT t.reset();

-- ================= 4. expiry =================
SET LOCAL session_replication_role = replica;
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, status, time_slots, timezone, starts_on, ends_on, last_confirmed_at) VALUES
  -- dated: last slot two days ago / two days ahead
  ('00000000-0000-0000-0000-0000000000c1', t.id('other'), ARRAY['Basketball'], 'All Levels', 'open', jsonb_build_array(jsonb_build_object('date', (current_date - 2)::text, 'start', '18:00', 'end', '20:00')), 'America/New_York', NULL, NULL, now()),
  ('00000000-0000-0000-0000-0000000000c2', t.id('other'), ARRAY['Basketball'], 'All Levels', 'open', jsonb_build_array(jsonb_build_object('date', (current_date - 9)::text, 'start', '18:00', 'end', '20:00'), jsonb_build_object('date', (current_date + 2)::text, 'start', '18:00', 'end', '24:00')), 'America/New_York', NULL, NULL, now() - interval '60 days'),
  -- weekly: confirmed 20 days ago / 3 days ago
  ('00000000-0000-0000-0000-0000000000c3', t.id('other'), ARRAY['Basketball'], 'All Levels', 'open', '[{"weekday":4,"start":"19:00","end":"21:00"}]'::jsonb, 'America/New_York', NULL, NULL, now() - interval '20 days'),
  ('00000000-0000-0000-0000-0000000000c4', t.id('other'), ARRAY['Basketball'], 'All Levels', 'open', '[{"weekday":4,"start":"19:00","end":"21:00"}]'::jsonb, 'America/New_York', NULL, NULL, now() - interval '3 days'),
  -- legacy, no slots: ends_on in the past / no dates at all
  ('00000000-0000-0000-0000-0000000000c5', t.id('other'), ARRAY['Basketball'], 'All Levels', 'open', '[]'::jsonb, NULL, current_date - 10, current_date - 3, now()),
  ('00000000-0000-0000-0000-0000000000c6', t.id('other'), ARRAY['Basketball'], 'All Levels', 'open', '[]'::jsonb, NULL, NULL, NULL, now()),
  -- an unknown timezone, and a malformed legacy date: neither may break the listing
  ('00000000-0000-0000-0000-0000000000c7', t.id('other'), ARRAY['Basketball'], 'All Levels', 'open', jsonb_build_array(jsonb_build_object('date', (current_date + 2)::text, 'start', '18:00', 'end', '20:00')), 'Mars/Olympus_Mons', NULL, NULL, now()),
  ('00000000-0000-0000-0000-0000000000c8', t.id('other'), ARRAY['Basketball'], 'All Levels', 'open', '[{"date":"2026-02-30","start":"18:00","end":"20:00"}]'::jsonb, 'America/New_York', NULL, NULL, now());
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('viewer'));
SELECT t.ok(NOT t.vis('c1'), 'a post whose only date has passed is not listed');
SELECT t.ok(t.vis('c2'), 'a post with a date still ahead is listed, however long ago it was confirmed');
SELECT t.ok(NOT t.vis('c3'), 'a weekly post unconfirmed for over 14 days is not listed');
SELECT t.ok(t.vis('c4'), 'a weekly post confirmed recently is listed');
SELECT t.ok(NOT t.vis('c5'), 'a legacy post whose end date has passed is not listed');
SELECT t.ok(t.vis('c6'), 'a legacy post with no dates is listed for 14 days from confirmation');
SELECT t.ok(t.vis('c7'), 'an unknown timezone falls back to the market''s and does not break the listing');
SELECT t.ok(t.vis('c8'), 'a malformed legacy date is listed as before rather than breaking the listing');
SELECT t.eq(t.count('SELECT 1 FROM public.player_availabilities WHERE user_id = t.id(''other'')'), 5, 'the listing itself runs');
SELECT t.throws($q$INSERT INTO public.availability_contact_requests (from_user_id, to_user_id, availability_id, kind, message) VALUES (t.id('viewer'), t.id('other'), '00000000-0000-0000-0000-0000000000c3', 'contact', 'hi')$q$, 'recipient_restricted:other', 'an expired post takes no requests');
SELECT t.as_user(t.id('other'));
SELECT t.ok(t.vis('c1') AND t.vis('c3'), 'the author still sees their own expired posts');
SELECT t.lives($q$UPDATE public.player_availabilities SET last_confirmed_at = '2000-01-01' WHERE id = '00000000-0000-0000-0000-0000000000c3'$q$, 'the author reconfirms a weekly post');
SELECT t.as_user(t.id('viewer'));
SELECT t.ok(t.vis('c3'), 'and it is listed again (the server moved last_confirmed_at to now, not to the value sent)');
SELECT t.reset();
SELECT t.as_service();
SELECT t.lives($q$UPDATE public.player_availabilities SET status = 'expired' WHERE id = '00000000-0000-0000-0000-0000000000c4'$q$, 'server code can mark a post expired');
SELECT t.reset();
SELECT t.as_user(t.id('other'));
SELECT t.lives($q$UPDATE public.player_availabilities SET status = 'open' WHERE id = '00000000-0000-0000-0000-0000000000c4'$q$, 'the author can reopen an expired post');
SELECT t.as_user(t.id('viewer'));
SELECT t.ok(t.vis('c4'), 'which is then listed');
SELECT t.as_user(t.id('other'));
SELECT t.lives($q$UPDATE public.player_availabilities SET time_slots = jsonb_build_array(jsonb_build_object('date', (current_date + 1)::text, 'start', '18:00', 'end', '20:00')) WHERE id = '00000000-0000-0000-0000-0000000000c1'$q$, 'the author moves a past post to tomorrow');
SELECT t.as_user(t.id('viewer'));
SELECT t.ok(t.vis('c1'), 'and it is listed again');
SELECT t.reset();

-- ================= 5. the expiry rule, directly =================
SELECT t.eq(private_sec.availability_expires_at('[{"weekday":1,"start":"18:00","end":"20:00"}]'::jsonb, NULL, NULL, NULL, '2026-11-01 12:00+00'), '2026-11-15 12:00+00'::timestamptz, 'weekly: 14 days after confirmation');
SELECT t.eq(private_sec.availability_expires_at('[{"date":"2026-11-20","start":"18:00","end":"20:00"},{"date":"2026-11-21","start":"09:00","end":"11:00"}]'::jsonb, 'America/New_York', NULL, NULL, now()), '2026-11-21 16:00+00'::timestamptz, 'dated: the end of the last slot, in the post''s timezone');
SELECT t.eq(private_sec.availability_expires_at('[{"date":"2026-11-20","start":"18:00","end":"24:00"}]'::jsonb, 'America/Los_Angeles', NULL, NULL, now()), '2026-11-21 08:00+00'::timestamptz, 'a slot ending at 24:00 ends at midnight local time');
SELECT t.eq(private_sec.availability_expires_at('[{"date":"2026-11-20","start":"18:00","end":"20:00"}]'::jsonb, NULL, NULL, NULL, now()), '2026-11-21 01:00+00'::timestamptz, 'no timezone: the first market''s (America/New_York)');
SELECT t.eq(private_sec.availability_expires_at('[]'::jsonb, NULL, '2026-11-01', '2026-11-03', now()), '2026-11-04 05:00+00'::timestamptz, 'legacy dates: the end of the last day');
SELECT t.eq(has_function_privilege('anon', 'private_sec.availability_expires_at(jsonb,text,date,date,timestamptz)', 'EXECUTE'), false, 'not callable anonymously');
SELECT t.eq((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'player_availabilities' AND cmd IN ('SELECT', 'ALL')), 1, 'still exactly one read policy');

ROLLBACK;
