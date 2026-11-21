-- WP 1.3 (20261114120000_players_available_near): server-side "players available near me". One page, one row per person; the read policy
-- decides who can be seen (minors, blocks, hidden, run out); sport, intent, skill, the time window (in each post's timezone) and reach
-- both ways (the caller's radius and the poster's travel radius) filter; distances are whole miles, rounded up.
BEGIN;
SELECT t.person('me', 30), t.person('other', 31), t.person('near', 32), t.person('dated', 33), t.person('aau', 34), t.person('two', 35),
       t.person('bad', 36), t.person('flex', 37), t.person('far', 38), t.person('soccer', 39), t.person('past', 40), t.person('teen', 16),
       t.person('blocker', 41), t.person('paused', 42), t.person('shortreach', 43), t.person('unloc', 44), t.person('outside', 45);

-- Buford, GA is about 34.12, -84.00; 0.01 degree of latitude is about 0.69 miles. Window used below: 2026-12-07 00:00 to 2026-12-14
-- 00:00, New York time. Weekday numbers are computed from the dates so the test does not depend on a calendar.
CREATE TEMP TABLE lbl (id uuid PRIMARY KEY, label text);
CREATE FUNCTION pg_temp.wk(_d date, _s text, _e text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('weekday', extract(dow FROM _d)::int, 'start', _s, 'end', _e) $f$;
CREATE FUNCTION pg_temp.dt(_d date, _s text, _e text) RETURNS jsonb LANGUAGE sql AS $f$
  SELECT jsonb_build_object('date', _d::text, 'start', _s, 'end', _e) $f$;
CREATE FUNCTION pg_temp.post(_label text, _who text, _sport text, _slots jsonb, _lat numeric, _lng numeric,
                             _intent text[] DEFAULT '{}', _skill jsonb DEFAULT '{}', _status text DEFAULT 'open',
                             _radius int DEFAULT 25, _tz text DEFAULT 'America/New_York') RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, skill_levels, looking_for, time_slots, timezone, city,
                                            lat, lng, travel_radius_km, status)
  VALUES (t.id('post-' || _label), t.id(_who), ARRAY[_sport], 'All Levels', _skill, _intent, _slots, _tz, 'Buford',
          _lat, _lng, _radius, _status);
  INSERT INTO lbl VALUES (t.id('post-' || _label), _label);
END $f$;

SET LOCAL session_replication_role = replica;
SELECT pg_temp.post('near',  'near',  'Basketball', jsonb_build_array(pg_temp.wk('2026-12-08', '18:00', '20:00')), 34.13, -84.00,
                    ARRAY['pickup'], '{"Basketball": "Rec League"}');
SELECT pg_temp.post('dated', 'dated', 'Basketball', jsonb_build_array(pg_temp.dt('2026-12-09', '10:00', '12:00')), 34.14, -84.00, ARRAY['pickup']);
SELECT pg_temp.post('aau',   'aau',   'Basketball', jsonb_build_array(pg_temp.wk('2026-12-10', '19:00', '21:00')), 34.15, -84.00,
                    '{}', '{"Basketball": "AAU / Travel"}');
SELECT pg_temp.post('two-a', 'two',   'Basketball', jsonb_build_array(pg_temp.wk('2026-12-11', '18:00', '20:00')), 34.16, -84.00);
SELECT pg_temp.post('two-b', 'two',   'Basketball', jsonb_build_array(pg_temp.dt('2026-12-08', '08:00', '09:00')), 34.16, -84.00);
SELECT pg_temp.post('bad',   'bad',   'Basketball',
                    '[{"date":"2026-02-30","start":"18:00","end":"20:00"}]'::jsonb || jsonb_build_array(pg_temp.wk('2026-12-12', '09:00', '11:00')),
                    34.17, -84.00, '{}', '{}', 'open', 25, 'Mars/Olympus_Mons');
SELECT pg_temp.post('flex',  'flex',  'Basketball', '[]'::jsonb, 34.18, -84.00);
SELECT pg_temp.post('far',   'far',   'Basketball', jsonb_build_array(pg_temp.wk('2026-12-08', '18:00', '20:00')), 35.12, -84.00,
                    '{}', '{}', 'open', 500);
SELECT pg_temp.post('soccer', 'soccer', 'Soccer', jsonb_build_array(pg_temp.wk('2026-12-08', '18:00', '20:00')), 34.13, -84.00);
SELECT pg_temp.post('past',  'past',  'Basketball', jsonb_build_array(pg_temp.dt('2026-11-01', '18:00', '20:00')), 34.13, -84.00);
SELECT pg_temp.post('teen',  'teen',  'Basketball', jsonb_build_array(pg_temp.wk('2026-12-08', '18:00', '20:00')), 34.13, -84.00);
SELECT pg_temp.post('blocker', 'blocker', 'Basketball', jsonb_build_array(pg_temp.wk('2026-12-08', '18:00', '20:00')), 34.13, -84.00);
SELECT pg_temp.post('paused', 'paused', 'Basketball', jsonb_build_array(pg_temp.wk('2026-12-08', '18:00', '20:00')), 34.13, -84.00,
                    '{}', '{}', 'paused');
SELECT pg_temp.post('shortreach', 'shortreach', 'Basketball', jsonb_build_array(pg_temp.wk('2026-12-08', '18:00', '20:00')), 34.19, -84.00,
                    '{}', '{}', 'open', 2);
SELECT pg_temp.post('unloc', 'unloc', 'Basketball', jsonb_build_array(pg_temp.wk('2026-12-08', '18:00', '20:00')), NULL, NULL);
SELECT pg_temp.post('outside', 'outside', 'Basketball', jsonb_build_array(pg_temp.dt('2026-12-20', '18:00', '20:00')), 34.13, -84.00);
SELECT pg_temp.post('mine',  'me',    'Basketball', jsonb_build_array(pg_temp.wk('2026-12-08', '18:00', '20:00')), 34.12, -84.00);
SET LOCAL session_replication_role = origin;
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('blocker'), t.id('me'));

CREATE FUNCTION pg_temp.found(_q text) RETURNS text LANGUAGE plpgsql AS $f$
DECLARE r text;
BEGIN
  EXECUTE format('SELECT string_agg(coalesce(l.label, ''?''), '','' ORDER BY q.ord)
                    FROM (SELECT availability_id, row_number() OVER () AS ord FROM (%s) s) q LEFT JOIN lbl l ON l.id = q.availability_id', _q)
    INTO r;
  RETURN coalesce(r, '-');
END $f$;
GRANT SELECT ON lbl TO authenticated;

-- Shorthand for the usual call: Buford, 15 miles, basketball, the week of 7 December.
CREATE FUNCTION pg_temp.q(_extra text DEFAULT '') RETURNS text LANGUAGE sql AS $f$
  SELECT 'SELECT * FROM public.players_available_near(34.12, -84.00, 15, ''Basketball'', ''2026-12-07 00:00 America/New_York'', '
         || '''2026-12-14 00:00 America/New_York''' || _extra || ')' $f$;

-- ================= 1. who is found =================
SELECT t.as_user(t.id('me'));
SELECT t.eq(pg_temp.found(pg_temp.q()), 'near,dated,aau,two-b,bad,flex',
  'nearest first; not: far, soccer, past, teen (not a confirmed adult), blocker, paused, poster out of reach, unlocated, outside the window, own');
SELECT t.eq((SELECT string_agg(distance_mi::text, ',' ORDER BY distance_mi) FROM public.players_available_near(34.12, -84.00, 15, 'Basketball',
             '2026-12-07 00:00 America/New_York', '2026-12-14 00:00 America/New_York') WHERE availability_id IN (t.id('post-near'), t.id('post-dated'))),
  '1,2', 'distances are whole miles, rounded up');
SELECT t.eq((SELECT window_start FROM public.players_available_near(34.12, -84.00, 15, 'Basketball', '2026-12-07 00:00 America/New_York',
             '2026-12-14 00:00 America/New_York') WHERE availability_id = t.id('post-near')), '2026-12-08 23:00+00'::timestamptz,
  'a weekly 18:00 slot is 18:00 in the post''s timezone (New York), 23:00 UTC');
SELECT t.ok((SELECT window_start IS NULL AND window_end IS NULL FROM public.players_available_near(34.12, -84.00, 15, 'Basketball',
             '2026-12-07 00:00 America/New_York', '2026-12-14 00:00 America/New_York') WHERE availability_id = t.id('post-flex')),
  'a post with no times is flexible: it matches, with no window');
SELECT t.eq((SELECT count(*)::int FROM public.players_available_near(34.12, -84.00, 15, 'Basketball', '2026-12-07 00:00 America/New_York',
             '2026-12-14 00:00 America/New_York') WHERE user_id = t.id('two')), 1, 'one row per person');

-- ================= 2. order, filters, window, paging =================
SELECT t.eq(pg_temp.found(pg_temp.q(', NULL, NULL, false, ''soonest''')), 'two-b,near,dated,aau,bad,flex',
  'soonest first; the person with two posts is shown by their earliest window');
SELECT t.eq(pg_temp.found(pg_temp.q(', ''pickup''')), 'near,dated', 'intent: pickup only');
SELECT t.eq(pg_temp.found(pg_temp.q(', NULL, ARRAY[''Rec League'']')), 'near,dated,two-b,bad,flex',
  'skill: a matching tier or no tier at all; AAU-only is left out');
SELECT t.eq(pg_temp.found(pg_temp.q(', NULL, NULL, true')), 'near,dated,aau,two-b,bad,flex,unloc', 'unlocated posts only when asked, last');
SELECT t.eq(pg_temp.found('SELECT * FROM public.players_available_near(34.12, -84.00, 1, ''Basketball'', ''2026-12-07 00:00 America/New_York'', ''2026-12-14 00:00 America/New_York'')'),
  'near', 'a 1-mile radius');
SELECT t.eq(pg_temp.found('SELECT * FROM public.players_available_near(34.12, -84.00, 15, ''Basketball'', ''2026-12-09 12:00 America/New_York'', ''2026-12-10 23:00 America/New_York'')'),
  'aau,flex', 'a narrow window: only posts free in it (a slot ending exactly at the start does not count)');
SELECT t.eq(pg_temp.found(pg_temp.q(', NULL, NULL, false, ''nearest'', 2, 2')), 'aau,two-b', 'paging: limit 2, offset 2');
SELECT t.ok(position('far' IN pg_temp.found('SELECT * FROM public.players_available_near(NULL, NULL, 15, ''Basketball'', ''2026-12-07 00:00 America/New_York'', ''2026-12-14 00:00 America/New_York'', NULL, NULL, false, ''nearest'', 50)')) > 0
        AND position('unloc' IN pg_temp.found('SELECT * FROM public.players_available_near(NULL, NULL, 15, ''Basketball'', ''2026-12-07 00:00 America/New_York'', ''2026-12-14 00:00 America/New_York'', NULL, NULL, false, ''nearest'', 50)')) > 0,
  'without a location: no distance filter');

-- ================= 3. the read policy still decides =================
SELECT t.as_user(t.id('other'));
SELECT t.ok(position('blocker' IN pg_temp.found(pg_temp.q())) > 0, 'the blocker''s post is found by someone they did not block (so the block is what hid it)');
SELECT t.ok(position('teen' IN pg_temp.found(pg_temp.q())) = 0, 'a teen''s post is not found by an unrelated adult');
SELECT t.as_user(t.id('paused'));
SELECT t.ok(position('paused' IN pg_temp.found(pg_temp.q())) = 0, 'not even its author finds a paused post here (own posts are never listed)');
SELECT t.reset();
SELECT t.eq(has_function_privilege('anon', 'public.players_available_near(double precision,double precision,double precision,text,timestamptz,timestamptz,text,text[],boolean,text,integer,integer)', 'EXECUTE'),
  false, 'signed-out visitors cannot call it');
SELECT t.eq(has_function_privilege('authenticated', 'public.players_available_near(double precision,double precision,double precision,text,timestamptz,timestamptz,text,text[],boolean,text,integer,integer)', 'EXECUTE'),
  true, 'signed-in accounts can');
SELECT t.eq((SELECT prosecdef FROM pg_proc WHERE oid = 'public.players_available_near(double precision,double precision,double precision,text,timestamptz,timestamptz,text,text[],boolean,text,integer,integer)'::regprocedure),
  false, 'it runs as the caller, so the read policy applies');

-- ================= 4. helpers =================
SELECT t.eq(private_sec.safe_timezone('Mars/Olympus_Mons'), 'America/New_York', 'an unknown timezone falls back to the market''s');
SELECT t.eq(private_sec.safe_timezone('America/Los_Angeles'), 'America/Los_Angeles', 'a known one is kept');
SELECT t.eq(private_sec.availability_tiers('{"Basketball": "Rec League · High School"}', 'All Levels', ARRAY['Basketball'], 'Basketball'),
  ARRAY['Rec League', 'High School'], 'tiers are read from the post''s per-sport levels');
SELECT t.eq(private_sec.availability_tiers('{}', 'All Levels', ARRAY['Basketball'], 'Basketball'), ARRAY[]::text[], 'All Levels means no tier');
SELECT t.eq(private_sec.availability_tiers('{}', '3.5', ARRAY['Tennis', 'Pickleball'], 'Tennis'), ARRAY['3.5'], 'legacy skill_level counts for the primary sport');
SELECT t.eq(private_sec.availability_tiers('{}', '3.5', ARRAY['Tennis', 'Pickleball'], 'Pickleball'), ARRAY[]::text[], 'but not for the others');
SELECT t.eq((SELECT count(*)::int FROM private_sec.availability_windows('[{"date":"2026-02-30","start":"18:00","end":"20:00"}]', NULL, NULL, NULL,
             '2026-02-01', '2026-04-01')), 0, 'a malformed date is skipped, not an error');

ROLLBACK;
