-- WP 1.2 (20261118100000_availability_expiry_job): the hourly sweep reminds the author of a recurring post once per confirmation
-- before it runs out, marks run-out posts expired, leaves every other state alone, never stops on a bad legacy row, and is not
-- callable or readable by clients.
BEGIN;
SELECT t.person('author', 30), t.person('viewer', 31), t.person('kid', 15);

CREATE FUNCTION t.pid(_id text) RETURNS uuid LANGUAGE sql IMMUTABLE AS $f$ SELECT ('00000000-0000-0000-0000-0000000000' || _id)::uuid $f$;
GRANT EXECUTE ON FUNCTION t.pid(text) TO authenticated;
CREATE FUNCTION t.st(_id text) RETURNS text LANGUAGE sql AS $f$ SELECT status FROM public.player_availabilities WHERE id = t.pid(_id) $f$;
CREATE FUNCTION t.nudges(_who text) RETURNS int LANGUAGE sql AS $f$
  SELECT count(*)::int FROM public.notifications WHERE user_id = t.id(_who) AND type = 'availability_reconfirm' $f$;

SET LOCAL session_replication_role = replica;
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, status, hidden_at, time_slots, timezone, starts_on, ends_on, last_confirmed_at) VALUES
  -- weekly: runs out in 2 days / in 9 days / ran out 6 days ago
  (t.pid('d1'), t.id('author'), ARRAY['Basketball'], 'All Levels', 'open', NULL, '[{"weekday":2,"start":"18:00","end":"20:00"}]', 'America/New_York', NULL, NULL, now() - interval '12 days'),
  (t.pid('d2'), t.id('author'), ARRAY['Basketball'], 'All Levels', 'open', NULL, '[{"weekday":2,"start":"18:00","end":"20:00"}]', 'America/New_York', NULL, NULL, now() - interval '5 days'),
  (t.pid('d3'), t.id('author'), ARRAY['Basketball'], 'All Levels', 'open', NULL, '[{"weekday":2,"start":"18:00","end":"20:00"}]', 'America/New_York', NULL, NULL, now() - interval '20 days'),
  -- dated: last slot tomorrow / two days ago
  (t.pid('d4'), t.id('author'), ARRAY['Soccer'], 'All Levels', 'open', NULL, jsonb_build_array(jsonb_build_object('date', (current_date + 1)::text, 'start', '18:00', 'end', '20:00')), 'America/New_York', NULL, NULL, now() - interval '12 days'),
  (t.pid('d5'), t.id('author'), ARRAY['Soccer'], 'All Levels', 'open', NULL, jsonb_build_array(jsonb_build_object('date', (current_date - 2)::text, 'start', '18:00', 'end', '20:00')), 'America/New_York', NULL, NULL, now()),
  -- legacy open-ended (no slots, no end date), runs out in 2 days, unknown timezone
  (t.pid('d6'), t.id('author'), ARRAY['Tennis'], 'All Levels', 'open', NULL, '[]', 'Mars/Olympus_Mons', NULL, NULL, now() - interval '12 days'),
  -- paused and long unconfirmed; closed and long unconfirmed; hidden and about to run out
  (t.pid('d7'), t.id('author'), ARRAY['Basketball'], 'All Levels', 'paused', NULL, '[{"weekday":2,"start":"18:00","end":"20:00"}]', NULL, NULL, NULL, now() - interval '30 days'),
  (t.pid('d8'), t.id('author'), ARRAY['Basketball'], 'All Levels', 'closed', NULL, '[{"weekday":2,"start":"18:00","end":"20:00"}]', NULL, NULL, NULL, now() - interval '30 days'),
  (t.pid('d9'), t.id('author'), ARRAY['Basketball'], 'All Levels', 'open', now(), '[{"weekday":2,"start":"18:00","end":"20:00"}]', NULL, NULL, NULL, now() - interval '12 days'),
  -- a malformed legacy date (run-out time unknown), and a legacy sport the validation trigger refuses, run out
  (t.pid('da'), t.id('author'), ARRAY['Basketball'], 'All Levels', 'open', NULL, '[{"date":"2026-02-30","start":"18:00","end":"20:00"}]', NULL, NULL, NULL, now() - interval '30 days'),
  (t.pid('db'), t.id('author'), ARRAY['Curling'], 'All Levels', 'open', NULL, '[{"weekday":2,"start":"18:00","end":"20:00"}]', NULL, NULL, NULL, now() - interval '30 days'),
  -- a 15-year-old's weekly post about to run out
  (t.pid('dc'), t.id('kid'), ARRAY['Basketball'], 'All Levels', 'open', NULL, '[{"weekday":5,"start":"16:00","end":"18:00"}]', NULL, NULL, NULL, now() - interval '13 days');
SET LOCAL session_replication_role = origin;

-- ================= 1. clients cannot run it or read its log =================
SELECT t.as_user(t.id('author'));
SELECT t.throws($q$SELECT private_sec.sweep_availability_lifecycle()$q$, 'permission denied', 'a signed-in client cannot run the sweep');
SELECT t.throws($q$SELECT * FROM private_sec.availability_reminders$q$, 'permission denied', 'or read the reminders log');
SELECT t.as_anon();
SELECT t.throws($q$SELECT private_sec.sweep_availability_lifecycle()$q$, 'permission denied', 'nor can a visitor');
SELECT t.as_service();
SELECT t.throws($q$SELECT private_sec.sweep_availability_lifecycle()$q$, 'permission denied', 'nor server code: the scheduler runs it');
SELECT t.reset();

-- ================= 2. the first run =================
SELECT t.eq(private_sec.sweep_availability_lifecycle(), '{"reminded": 3, "expired": 2, "skipped": 1}'::jsonb, 'first run: three reminders, two expired, one skipped');
SELECT t.eq(t.count($q$SELECT 1 FROM private_sec.availability_reminders WHERE availability_id IN (t.pid('d1'), t.pid('d6'), t.pid('dc'))$q$), 3,
  'reminded: the weekly post and the open-ended post running out within three days, and the minor''s');
SELECT t.eq(t.nudges('author'), 2, 'the author gets one notification per post');
SELECT t.eq(t.nudges('kid'), 1, 'the minor author gets theirs');
SELECT t.eq(t.count($q$SELECT 1 FROM public.notifications WHERE type = 'availability_reconfirm' AND user_id NOT IN (t.id('author'), t.id('kid'))$q$), 0,
  'nobody else is notified');
SELECT t.ok((SELECT bool_and(link = '/players?tab=mine' AND title = 'Still available to play?') FROM public.notifications WHERE type = 'availability_reconfirm'),
  'the reminder links to My availability');
SELECT t.eq(t.count(format($q$SELECT 1 FROM public.notifications WHERE user_id = t.id('author') AND body = %L$q$,
  'Your weekly basketball availability stops being listed on '
    || to_char((now() + interval '2 days') AT TIME ZONE 'America/New_York', 'Dy, Mon FMDD') || '. Tap "Still available" to keep it up.')), 1,
  'it names the sport and the day it stops being listed, in the post''s timezone');
SELECT t.eq(t.count($q$SELECT 1 FROM public.notifications WHERE body LIKE 'Your weekly tennis availability stops being listed on %'$q$), 1,
  'an unknown timezone falls back to the market''s instead of failing');
SELECT t.eq(t.st('d2'), 'open', 'a weekly post with nine days left: no reminder yet, still open');
SELECT t.eq(t.st('d3'), 'expired', 'a weekly post unconfirmed for 20 days is marked expired');
SELECT t.eq(t.st('d4'), 'open', 'a dated post ending tomorrow is left open');
SELECT t.eq(t.count($q$SELECT 1 FROM private_sec.availability_reminders WHERE availability_id IN (t.pid('d3'), t.pid('d4'), t.pid('d5'))$q$), 0,
  'dated posts and posts that already ran out get no reminder');
SELECT t.eq(t.st('d5'), 'expired', 'a dated post whose last slot has passed is marked expired');
SELECT t.eq(t.st('d7'), 'paused', 'a paused post is left paused');
SELECT t.eq(t.st('d8'), 'closed', 'a closed post is left closed');
SELECT t.eq(t.st('d9'), 'open', 'a hidden post is not reminded about');
SELECT t.eq(t.st('da'), 'open', 'a post whose run-out time cannot be computed is left alone');
SELECT t.eq(t.st('db'), 'open', 'a legacy row the validation trigger refuses is skipped');

-- ================= 3. a second run, and a new confirmation =================
SELECT t.eq(private_sec.sweep_availability_lifecycle(), '{"reminded": 0, "expired": 0, "skipped": 1}'::jsonb, 'a second run reminds nobody again');
SELECT t.eq(t.nudges('author'), 2, 'still one notification per post');
SELECT t.as_user(t.id('author'));
SELECT t.lives($q$UPDATE public.player_availabilities SET last_confirmed_at = now() WHERE id = t.pid('d1')$q$, 'the author taps "Still available"');
SELECT t.lives($q$UPDATE public.player_availabilities SET status = 'open' WHERE id = t.pid('d3')$q$, 'and reopens the expired weekly post');
SELECT t.as_user(t.id('viewer'));
SELECT t.ok(EXISTS (SELECT 1 FROM public.player_availabilities WHERE id = t.pid('d3')), 'which is listed again');
SELECT t.reset();
SELECT t.eq(t.st('d3'), 'open', 'and open');
SELECT t.eq((private_sec.sweep_availability_lifecycle(now() + interval '12 days', 500)) -> 'reminded', '2'::jsonb,
  'twelve days on: the reconfirmed post and the reopened one are reminded for their new confirmation');
SELECT t.eq(t.count($q$SELECT 1 FROM private_sec.availability_reminders WHERE availability_id = t.pid('d1')$q$), 2, 'one reminder per confirmation');

-- ================= 4. the cap, and cleanup =================
SELECT t.eq((private_sec.sweep_availability_lifecycle(now() + interval '60 days', 1)) -> 'expired', '1'::jsonb, 'a run handles at most _limit posts of each kind');
DELETE FROM public.player_availabilities WHERE id = t.pid('d1');
SELECT t.eq(t.count($q$SELECT 1 FROM private_sec.availability_reminders WHERE availability_id = t.pid('d1')$q$), 0, 'a deleted post takes its reminders with it');
SELECT t.eq((SELECT count(*)::int FROM pg_policies WHERE schemaname = 'public' AND tablename = 'player_availabilities' AND cmd IN ('SELECT', 'ALL')), 1,
  'still exactly one read policy');

ROLLBACK;
