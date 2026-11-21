-- 20261128110000_age_cohort_at_18 (docs/age-cohort-at-18.md): the stored cohort ages to 'adult' at 18, only upward, only
-- for a known adult who is not a managed account, without widening anything the person had stored or posted.
-- Checked in order: the shape (who may call what), the rule (boundary day, leap day, unknown, managed, under-13, review
-- pending, a real 16 and 17-year-old), what an ordinary adult has versus a stale teen BEFORE the sweep (so the comparison
-- discriminates), the sweep (capped, idempotent, notices once, one savepoint per person), that nothing the person stored
-- or posted becomes wider (privacy row, follow approval, DMs, reels, availability, profile as a stranger or a visitor),
-- that the flipped adult then behaves as an ordinary adult everywhere the cohort is read, a failing person left exactly
-- as they were, a person who chooses otherwise, and a support-approved correction back to a minor.
--
-- People: host, stranger, ordinary (30: the comparison). Stale adults, each carrying a cohort that never aged:
-- stalea (19, teen_13_15, messages everyone), staleb (20, teen_13_15, messages nobody), stalec (19, teen_16_17, reels,
-- an open availability post), norow (21, teen_16_17, no stored privacy row), legacy (22, teen_16_17, a stored row the minor
-- floor never clamped), turned (exactly 18 today, teen_16_17), leapday (born 29 Feb 2008, teen_16_17). Left alone: teen
-- (16), dayb (17, the day before 18), leapyoung (14, born 29 Feb 2012), nobday (teen cohort, no birthday), mgd (19, managed),
-- kid (19, child_under_13), held (19, an age review pending). broken (19, a reel the sweep cannot update) comes later.
-- Engagement and exposure: teammates (host, a real 16-year-old) comment and react on stalec's reel, game and team post, and
-- a stranger does not; stalea (13-15) sits on a roster. The flip must not open what was said, the person's age or the roster row.
-- The 18th-birthday boundary (28 Feb / 1 March of a leap-day birthday) is covered by arithmetic on age() and calculate_age
-- below: the rule itself reads the session date, which a test cannot move, so one person cannot be tested on both days.
BEGIN;

SELECT t.person('host', 40), t.person('stranger', 33), t.person('ordinary', 30),
       t.person('stalea', 19), t.person('staleb', 20), t.person('stalec', 19), t.person('norow', 21), t.person('legacy', 22),
       t.person('teen', 16), t.person('mgd', 19), t.person('kid', 19), t.person('held', 19);
CREATE FUNCTION pg_temp.person_bd(h text, bd date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
  VALUES (t.id(h), h || '@example.test', now(), jsonb_build_object('display_name', initcap(h), 'account_type', 'player'));
  INSERT INTO public.profile_birthdays (user_id, birthday) VALUES (t.id(h), bd);
END $$;
SELECT pg_temp.person_bd('turned', (current_date - interval '18 years')::date);
SELECT pg_temp.person_bd('dayb', (current_date - interval '18 years' + interval '1 day')::date);
SELECT pg_temp.person_bd('leapday', date '2008-02-29');
SELECT pg_temp.person_bd('leapyoung', date '2012-02-29');
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('nobday'), 'nobday@example.test', now(), jsonb_build_object('display_name', 'Nobday', 'account_type', 'player'));

-- Content whose audience the cohort alone decides.
SELECT t.reel('stalea', 'a1'), t.reel('stalec', 'c1'), t.reel('stalec', 'c2'), t.reel('turned', 't1'), t.reel('ordinary', 'o1'), t.reel('teen', 'k1');
INSERT INTO public.highlight_reels (id, user_id, video_path, status, is_draft)
VALUES (t.id('reel-c3'), t.id('stalec'), t.id('stalec')::text || '/c3.mp4', 'completed', true);
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, status, time_slots, last_confirmed_at)
VALUES (t.id('post-c'), t.id('stalec'), ARRAY['Basketball'], 'All Levels', 'open', '[]', now()),
       (t.id('post-cp'), t.id('stalec'), ARRAY['Basketball'], 'All Levels', 'paused', '[]', now()),
       (t.id('post-o'), t.id('ordinary'), ARRAY['Basketball'], 'All Levels', 'open', '[]', now());
-- Sign-up stores 'private' while the cohort is still unknown. A person who later chose 'public' as an adult is clamped to
-- 'members' by the reclamp trigger when the stale teen cohort is set below; staleb never chose, so keeps 'private'.
UPDATE public.privacy_preferences SET profile_visibility = 'public'
 WHERE user_id IN (t.id('stalea'), t.id('stalec'), t.id('turned'), t.id('leapday'), t.id('ordinary'), t.id('stranger'), t.id('host'));
-- The stale cohort: written when a birthday is saved, never moved on. Setting it fires the reclamp trigger, so each
-- stored privacy row is clamped to the minor floor exactly as it was when the cohort was first set.
CREATE FUNCTION pg_temp.stale(h text, c text) RETURNS void LANGUAGE sql AS $$
  UPDATE public.profiles SET age_cohort = c,
         age_category = CASE c WHEN 'child_under_13' THEN 'child' ELSE 'teen' END
   WHERE id = t.id(h);
$$;
SELECT pg_temp.stale('stalea', 'teen_13_15'), pg_temp.stale('staleb', 'teen_13_15'), pg_temp.stale('stalec', 'teen_16_17'),
       pg_temp.stale('norow', 'teen_16_17'), pg_temp.stale('legacy', 'teen_16_17'), pg_temp.stale('turned', 'teen_16_17'),
       pg_temp.stale('leapday', 'teen_16_17'), pg_temp.stale('nobday', 'teen_16_17'), pg_temp.stale('mgd', 'teen_16_17'),
       pg_temp.stale('kid', 'child_under_13'), pg_temp.stale('held', 'teen_16_17');
UPDATE public.privacy_preferences SET allow_messages = 'nobody' WHERE user_id = t.id('staleb');
DELETE FROM public.privacy_preferences WHERE user_id = t.id('norow');
-- A stored row the floor never clamped (written before the trigger existed): members, but follow approval off.
ALTER TABLE public.privacy_preferences DISABLE TRIGGER trg_enforce_minor_privacy_floor;
UPDATE public.privacy_preferences SET profile_visibility = 'members', require_follow_approval = false WHERE user_id = t.id('legacy');
ALTER TABLE public.privacy_preferences ENABLE TRIGGER trg_enforce_minor_privacy_floor;
INSERT INTO public.managed_accounts (child_user_id, managed_by) VALUES (t.id('mgd'), t.id('host'));
UPDATE public.profiles SET age_review_required = true WHERE id = t.id('held');

-- A team of two stale teens and an adult, and a shared game for the message rule.
SELECT t.team('squad', 'host');
SELECT t.member('squad', 'stalec'), t.member('squad', 'norow');
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('gdm', t.id('host'), 'Run', 'Basketball', now() + interval '3 days', 'Gym', 10, 0);
DELETE FROM public.notifications;
-- Anything others said on stalec's content, and a 13-15 on a roster. Written a day before the flip (so before the sweep).
SELECT t.person('tmate', 16);
SELECT t.team('sq2', 'host');
SELECT t.member('sq2', 'stalec'), t.member('sq2', 'tmate'), t.member('squad', 'stalea');
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('gsc', t.id('stalec'), 'Their run', 'Basketball', now() + interval '3 days', 'Gym', 10, 0),
       ('gord', t.id('ordinary'), 'Their run', 'Basketball', now() + interval '3 days', 'Gym', 10, 0);
INSERT INTO public.team_posts (id, team_id, author_id, kind, title, body)
VALUES (t.id('tp-c'), 'squad', t.id('stalec'), 'announcement', 'Hello', 'Hello');
CREATE FUNCTION pg_temp.comment_on(_author text, _type text, _subject text, _at timestamptz) RETURNS void LANGUAGE sql AS $$
  INSERT INTO public.post_comments (subject_type, subject_id, author_id, body, moderation_status, created_at)
  VALUES (_type, _subject, t.id(_author), 'comment by ' || _author, 'approved', _at);
  INSERT INTO public.post_reactions (subject_type, subject_id, user_id, emoji, created_at)
  VALUES (_type, _subject, t.id(_author), '👍', _at);
$$;
SELECT pg_temp.comment_on('host', 'highlight_reel', t.id('reel-c1')::text, now() - interval '1 day'),
       pg_temp.comment_on('tmate', 'highlight_reel', t.id('reel-c1')::text, now() - interval '1 day'),
       pg_temp.comment_on('host', 'game', 'gsc', now() - interval '1 day'),
       pg_temp.comment_on('tmate', 'game', 'gsc', now() - interval '1 day'),
       pg_temp.comment_on('host', 'team_post', t.id('tp-c')::text, now() - interval '1 day'),
       pg_temp.comment_on('stalec', 'game', 'gsc', now() - interval '1 day'),
       pg_temp.comment_on('stranger', 'game', 'gord', now() - interval '1 day'),
       pg_temp.comment_on('stranger', 'highlight_reel', t.id('reel-o1')::text, now() - interval '1 day');
DELETE FROM public.notifications;

-- Everything the cohort drives for a person, as one string (as the server would read it: no signed-in user).
CREATE FUNCTION pg_temp.adultvec(h text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE u uuid := t.id(h);
BEGIN
  RETURN concat_ws('|',
    public.age_cohort_of(u), public.is_minor(u), public.child_features_locked(u), public.platform_status(u),
    private_sec.review_author_is_adult(u), private_sec.review_subject_is_public('player', u::text),
    private_sec.review_subject_is_public('host', u::text), private_sec.game_payments_allowed(u),
    private_sec.telemetry_subject_is_adult(u), private_sec.regular_invitable(t.id('host'), u),
    private_sec.can_comment_on_minor_content(t.id('stranger'), u), private_sec.post_audiences_allowed(u)::text,
    public.can_manage_followers(u, u),
    public.minor_messaging_block(t.id('host'), u), public.minor_messaging_block(u, t.id('host')),
    public.public_xp_enabled(u), private_sec.guardian_switches_apply(u), private_sec.child_game_participation_allowed(u),
    public.parental_consent_required(public.age_cohort_of(u)), public.age_cohort_of(u) = 'adult');
END $$;
-- Visibility rank of a reel audience, so "wider" can be compared.
CREATE FUNCTION pg_temp.rank(a text) RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE a WHEN 'public' THEN 2 WHEN 'members' THEN 1 ELSE 0 END
$$;
CREATE FUNCTION pg_temp.as_count(_who text, _q text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF _who = 'anon' THEN PERFORM t.as_anon(); ELSE PERFORM t.as_user(t.id(_who)); END IF;
  n := t.count(_q);
  PERFORM t.reset();
  RETURN n;
END $$;
-- public_user_reel_ids is the server's list (service role only): the same audience rule, read the way the app reads it.
CREATE FUNCTION pg_temp.svc_reels(_who text, _members boolean) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_service();
  n := t.count(format('SELECT 1 FROM public.public_user_reel_ids(%L, 12, %L)', t.id(_who), _members));
  PERFORM t.reset();
  RETURN n;
END $$;
CREATE FUNCTION pg_temp.correct(_who text, _bd date) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM set_config('openrun.birthday_review', 'on', true);
  INSERT INTO public.profile_birthdays (user_id, birthday) VALUES (t.id(_who), _bd)
  ON CONFLICT (user_id) DO UPDATE SET birthday = EXCLUDED.birthday, updated_at = now();
  PERFORM set_config('openrun.birthday_review', 'off', true);
END $$;

-- ---- 1. the shape: who may call what ---------------------------------------------------------------------------
SELECT t.ok(NOT has_function_privilege(r, 'private_sec.age_adult_cohorts(integer)', 'EXECUTE'),
  'the sweep is not callable by ' || r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT t.ok(NOT has_function_privilege(r, 'private_sec.cohort_due_to_age(uuid)', 'EXECUTE'),
  'nor is the rule: ' || r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT t.ok(NOT has_function_privilege(r, 'private_sec.close_age_cohort_flip()', 'EXECUTE'),
  'nor the audit trigger function: ' || r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT t.ok(NOT has_table_privilege(r, 'private_sec.age_cohort_flips', 'SELECT')
        AND NOT has_table_privilege(r, 'private_sec.age_cohort_flips', 'INSERT'),
  'the audit table is closed to ' || r) FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT t.ok((SELECT relrowsecurity FROM pg_class WHERE oid = 'private_sec.age_cohort_flips'::regclass), 'and has row level security on');
SELECT t.as_user(t.id('stalea'));
SELECT t.throws('SELECT private_sec.age_adult_cohorts()', 'permission denied', 'a signed-in person cannot run the sweep, even on themself');
SELECT t.throws('SELECT private_sec.cohort_due_to_age(''' || t.id('stalea') || ''')', 'permission denied', 'or ask the rule');
SELECT t.throws('SELECT * FROM private_sec.age_cohort_flips', 'permission denied', 'or read the audit table');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws('SELECT private_sec.age_adult_cohorts()', 'permission denied', 'a visitor cannot either');
SELECT t.reset();
SELECT t.as_service();
SELECT t.throws('SELECT private_sec.age_adult_cohorts()', 'permission denied', 'nor the service role: it is for the scheduler and a person with database access');
SELECT t.reset();

-- ---- 2. the rule ------------------------------------------------------------------------------------------------
SELECT t.eq(private_sec.cohort_due_to_age(t.id(h)), true, 'due: ' || h)
  FROM unnest(ARRAY['stalea', 'staleb', 'stalec', 'norow', 'legacy', 'turned', 'leapday']) h;
SELECT t.eq(private_sec.cohort_due_to_age(t.id(h)), false, 'not due: ' || h)
  FROM unnest(ARRAY['teen', 'dayb', 'leapyoung', 'nobday', 'mgd', 'kid', 'held', 'ordinary', 'host']) h;
SELECT t.eq(private_sec.cohort_due_to_age(t.id('turned')), true, 'exactly 18 today: due');
SELECT t.eq(private_sec.cohort_due_to_age(t.id('dayb')), false, 'the day before 18: not due');
SELECT t.eq(public.age_cohort_of(t.id('dayb')), 'teen_16_17', 'and still the 16-17 cohort');
-- The leap-day rule is age(): a birthday on 29 Feb turns 18 on 1 March of a common year, for every adult rule alike.
SELECT t.eq(date_part('year', age(date '2026-02-28', date '2008-02-29'))::int, 17, 'a 29 Feb birthday: 17 on 28 Feb 2026 (a common year)');
SELECT t.eq(date_part('year', age(date '2026-03-01', date '2008-02-29'))::int, 18, 'and 18 on 1 March');
SELECT t.eq(private_sec.is_known_adult(t.id('leapday')), public.calculate_age(date '2008-02-29') >= 18,
  'the leap-day person: the adult check and calculate_age agree');
SELECT t.eq(private_sec.is_known_adult(t.id('leapyoung')), false, 'a leap-day 14-year-old is not an adult');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM generate_series(0, 2000) d
                         WHERE (date_part('year', age((date '2008-02-29' + d)::timestamp))::int >= 18)
                            IS DISTINCT FROM (public.calculate_age((date '2008-02-29' + d)::date) >= 18)),
  'age() and calculate_age give the same 18 test across two thousand birthdays');

-- ---- 3. before the sweep: the stale teens do differ from an ordinary adult (so the comparison later means something) ----
SELECT t.ok(pg_temp.adultvec(h) <> pg_temp.adultvec('ordinary'), 'before: ' || h || ' is read as a teen')
  FROM unnest(ARRAY['stalea', 'staleb', 'stalec', 'norow', 'legacy', 'turned', 'leapday']) h;
SELECT t.eq(public.minor_messaging_block(t.id('host'), t.id('stalea')), 'teen_needs_shared_game:other', 'before: an adult cannot message the stale 13-15 without a shared game');
SELECT t.eq(private_sec.direct_message_refusal(t.id('host'), t.id('stalea')), 'recipient_restricted:other', 'and the refusal says so');

-- A snapshot of everything stored or posted, before.
CREATE TEMP TABLE before_priv AS
  SELECT h, private_sec.profile_visibility_of(t.id(h)) AS vis, public.follow_approval_required(t.id(h)) AS follow,
         (SELECT to_jsonb(pp) - 'updated_at' - 'created_at' FROM public.privacy_preferences pp WHERE pp.user_id = t.id(h)) AS stored
    FROM unnest(ARRAY['stalea', 'staleb', 'stalec', 'norow', 'legacy', 'turned', 'leapday']) h;
CREATE TEMP TABLE before_reels AS
  SELECT id, user_id, public.reel_audience(id) AS aud, is_draft FROM public.highlight_reels;
CREATE TEMP TABLE before_other AS
  SELECT h, (SELECT age_cohort FROM public.profiles WHERE id = t.id(h)) AS cohort,
         (SELECT age_category FROM public.profiles WHERE id = t.id(h)) AS category,
         (SELECT to_jsonb(pp) - 'updated_at' FROM public.privacy_preferences pp WHERE pp.user_id = t.id(h)) AS stored
    FROM unnest(ARRAY['teen', 'dayb', 'leapyoung', 'nobday', 'mgd', 'kid', 'held', 'ordinary']) h;
SELECT t.eq(pg_temp.as_count('stranger', format('SELECT 1 FROM public.profiles WHERE id = %L', t.id('stalec'))), 1, 'before: a member sees the stale 16-17 profile (members)');
SELECT t.eq(pg_temp.as_count('anon', format('SELECT 1 FROM public.profiles WHERE id = %L', t.id('stalec'))), 0, 'before: a visitor does not');
SELECT t.eq(pg_temp.as_count('stranger', format('SELECT 1 FROM public.highlight_reels WHERE user_id = %L', t.id('stalec'))), 2, 'before: a member reads the two posted reels (members only)');
SELECT t.eq(pg_temp.as_count('anon', format('SELECT 1 FROM public.highlight_reels WHERE user_id = %L', t.id('stalec'))), 0, 'before: a visitor reads none');
SELECT t.eq(pg_temp.svc_reels('stalec', true), 2, 'before: the server''s member list has the two');
SELECT t.eq(pg_temp.svc_reels('stalec', false), 0, 'and its public list none');
SELECT t.eq(pg_temp.as_count('stranger', format('SELECT 1 FROM public.player_availabilities WHERE user_id = %L', t.id('stalec'))), 0, 'before: the open post is not listed to a stranger');
SELECT t.eq(pg_temp.as_count('stranger', format('SELECT 1 FROM public.player_availabilities WHERE user_id = %L', t.id('ordinary'))), 1, 'while an ordinary adult''s is');
SELECT t.eq(private_sec.team_is_youth('squad'), true, 'before: the squad (two stale teens) is a youth team');

-- What each kind of viewer reads of the others' comments and reactions on stalec's content, of stalec's and stalea's age
-- and roster row, and of an ordinary adult's, before the sweep.
CREATE FUNCTION pg_temp.eng(_who text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r text;
BEGIN
  IF _who = 'anon' THEN PERFORM t.as_anon(); ELSE PERFORM t.as_user(t.id(_who)); END IF;
  SELECT concat_ws(',',
    (SELECT count(*) FROM public.post_comments WHERE subject_id IN (t.id('reel-c1')::text, 'gsc', t.id('tp-c')::text)),
    (SELECT count(*) FROM public.post_reactions WHERE subject_id IN (t.id('reel-c1')::text, 'gsc', t.id('tp-c')::text)),
    (SELECT count(*) FROM public.post_comments WHERE subject_id IN ('gord', t.id('reel-o1')::text)),
    (SELECT count(*) FROM public.post_reactions WHERE subject_id IN ('gord', t.id('reel-o1')::text))) INTO r;
  PERFORM t.reset();
  RETURN r;
END $$;
CREATE FUNCTION pg_temp.age_seen(_who text, _of text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(_who));
  n := (SELECT count(*) FROM public.profile_ages(ARRAY[t.id(_of)]));
  PERFORM t.reset();
  RETURN n;
END $$;
CREATE FUNCTION pg_temp.roster_seen(_who text, _of text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  IF _who = 'anon' THEN PERFORM t.as_anon(); ELSE PERFORM t.as_user(t.id(_who)); END IF;
  -- The row policy asks exactly this. A visitor cannot read team_members itself (no column grant on teams.moderator_hidden_at),
  -- so the rule is read through the function the policy calls, and through the table for signed-in people.
  n := (SELECT CASE WHEN private_sec.roster_row_visible('squad', t.id(_of)) THEN 1 ELSE 0 END);
  IF _who <> 'anon' AND n = 1 THEN
    IF (SELECT count(*) FROM public.team_members WHERE team_id = 'squad' AND user_id = t.id(_of)) <> 1 THEN n := -1; END IF;
  END IF;
  PERFORM t.reset();
  RETURN n;
END $$;
CREATE TEMP TABLE before_eng AS SELECT w, pg_temp.eng(w) AS seen FROM unnest(ARRAY['anon', 'stranger', 'host', 'tmate', 'stalec', 'ordinary']) w;
SELECT t.eq((SELECT seen FROM before_eng WHERE w = 'anon'), '0,0,2,2', 'before: a visitor reads none of the teammates'' words on stalec''s content, but the two comments and two reactions on adults'' content');
SELECT t.eq((SELECT seen FROM before_eng WHERE w = 'stranger'), '0,0,2,2', 'before: nor does a stranger');
SELECT t.eq((SELECT seen FROM before_eng WHERE w = 'host'), '6,6,2,2', 'before: a teammate (the host) reads all six comments and six reactions on it');
SELECT t.eq((SELECT seen FROM before_eng WHERE w = 'tmate'), '6,6,2,2', 'before: the other teammate too');
SELECT t.eq((SELECT seen FROM before_eng WHERE w = 'stalec'), '6,6,2,2', 'before: and stalec reads everything said on their own content');
SELECT t.eq(pg_temp.age_seen('stranger', 'stalec'), 0, 'before: a stranger does not get stalec''s age');
SELECT t.eq(pg_temp.age_seen('stalec', 'stalec'), 1, 'but stalec does');
SELECT t.eq(pg_temp.age_seen('stranger', 'ordinary'), 1, 'while an ordinary adult''s age is shown by their profile visibility');
SELECT t.eq(pg_temp.roster_seen('anon', 'stalea'), 0, 'before: a visitor does not see the 13-15 roster row');
SELECT t.eq(pg_temp.roster_seen('stranger', 'stalea'), 0, 'nor does a stranger');
SELECT t.eq(pg_temp.roster_seen('host', 'stalea'), 1, 'the team''s manager does');
SELECT t.eq(pg_temp.roster_seen('anon', 'stalec'), 0, 'before: a visitor does not see the 16-17 roster row');
SELECT t.eq(pg_temp.roster_seen('stranger', 'stalec'), 1, 'but a signed-in member does');

-- ---- 4. the sweep ---------------------------------------------------------------------------------------------
CREATE TEMP TABLE sweep1 AS SELECT private_sec.age_adult_cohorts(3) AS r;
SELECT t.eq((SELECT (r ->> 'aged')::int FROM sweep1), 3, 'a cap of 3 ages 3');
SELECT t.eq((SELECT (r ->> 'remaining')::int FROM sweep1), 4, 'and reports 4 waiting');
SELECT t.eq((SELECT (r ->> 'failed')::int FROM sweep1), 0, 'none failed');
CREATE TEMP TABLE sweep2 AS SELECT private_sec.age_adult_cohorts() AS r;
SELECT t.eq((SELECT (r ->> 'aged')::int FROM sweep2), 4, 'the next run ages the other 4');
SELECT t.eq((SELECT (r ->> 'remaining')::int FROM sweep2), 0, 'none remain');
SELECT t.eq((SELECT (r ->> 'adults_left_alone')::int FROM sweep2), 2, 'two known adults it leaves alone are reported: under-13 and the pending review (not the managed account)');
CREATE TEMP TABLE sweep3 AS SELECT private_sec.age_adult_cohorts() AS r;
SELECT t.eq((SELECT (r ->> 'aged')::int FROM sweep3), 0, 'idempotent: a third run ages nobody');
SELECT t.eq((SELECT (r ->> 'notified')::int FROM sweep3), 0, 'and tells nobody again');
SELECT t.eq((SELECT array_agg(c ORDER BY c) FROM (SELECT t.id(h)::text c FROM unnest(ARRAY['stalea', 'staleb', 'stalec', 'norow', 'legacy', 'turned', 'leapday']) h) q),
            (SELECT array_agg(id::text ORDER BY id::text) FROM public.profiles WHERE age_cohort = 'adult' AND id IN (SELECT user_id FROM private_sec.age_cohort_flips)),
  'exactly those seven are in the audit table, as adults');
SELECT t.eq((SELECT count(*)::int FROM private_sec.age_cohort_flips), 7, 'seven audit rows');
SELECT t.eq((SELECT count(*)::int FROM public.age_change_events WHERE outcome = 'aged_to_adult' AND to_cohort = 'adult'), 7, 'and seven age history rows');
SELECT t.eq((SELECT from_cohort FROM public.age_change_events WHERE outcome = 'aged_to_adult' AND user_id = t.id('stalea')), 'teen_13_15', 'which say where they came from');
SELECT t.eq((SELECT age_category FROM public.profiles WHERE id = t.id('stalea')), 'adult', 'the stored age category follows');

-- Untouched: a real 16 and 17-year-old, a 14-year-old born on a leap day, an unknown birthday, a managed account, an
-- under-13 cohort, a pending age review, an ordinary adult.
SELECT t.eq((SELECT count(*)::int FROM before_other b
              WHERE b.cohort IS DISTINCT FROM (SELECT age_cohort FROM public.profiles WHERE id = t.id(b.h))
                 OR b.category IS DISTINCT FROM (SELECT age_category FROM public.profiles WHERE id = t.id(b.h))
                 OR b.stored IS DISTINCT FROM (SELECT to_jsonb(pp) - 'updated_at' FROM public.privacy_preferences pp WHERE pp.user_id = t.id(b.h))), 0,
  'a 16, a 17 (the day before 18), a leap-day 14, an unknown age, a managed account, an under-13, a pending review and an adult keep cohort, category and privacy row');
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('dayb')), 'teen_16_17', 'the day before 18 is still 16-17');
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('mgd')), 'teen_16_17', 'the managed adult keeps its cohort (the handover stream owns it)');
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('kid')), 'child_under_13', 'the under-13 cohort is not touched');
SELECT t.eq((SELECT count(*)::int FROM private_sec.age_cohort_flips WHERE user_id IN
             (t.id('teen'), t.id('dayb'), t.id('leapyoung'), t.id('nobday'), t.id('mgd'), t.id('kid'), t.id('held'), t.id('ordinary'))), 0,
  'none of them has an audit row');

-- Notices: once each, kind, no legal claim.
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id(h) AND title = 'Your account now has adult settings'), 1,
  'told once: ' || h) FROM unnest(ARRAY['stalea', 'staleb', 'stalec', 'norow', 'legacy', 'turned', 'leapday']) h;
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE title = 'Your account now has adult settings'), 7, 'and nobody else');
SELECT t.eq((SELECT link FROM public.notifications WHERE user_id = t.id('stalec') AND type = 'age_review'), '/account/privacy', 'the notice points at the privacy settings');
SELECT t.ok((SELECT body FROM public.notifications WHERE user_id = t.id('stalec') AND type = 'age_review') LIKE '%saved as drafts%'
        AND (SELECT body FROM public.notifications WHERE user_id = t.id('stalec') AND type = 'age_review') LIKE '%paused%',
  'it says the reels are drafts and the open post is paused');
SELECT t.ok((SELECT body FROM public.notifications WHERE user_id = t.id('stalec') AND type = 'age_review') LIKE '%age and your team listing stay hidden%'
        AND (SELECT body FROM public.notifications WHERE user_id = t.id('stalec') AND type = 'age_review') LIKE '%comment and react%'
        AND (SELECT body FROM public.notifications WHERE user_id = t.id('stalec') AND type = 'age_review') LIKE '%Privacy settings%',
  'it says what is held (age, team listing), what is now open (comments and reactions) and where to review');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.notifications WHERE title = 'Your account now has adult settings'
                         AND body ~* '(stay as they were|nothing changes|nothing has changed)'),
  'and never claims that nothing changed');
SELECT t.ok((SELECT body FROM public.notifications WHERE user_id = t.id('norow') AND type = 'age_review') NOT LIKE '%draft%'
        AND (SELECT body FROM public.notifications WHERE user_id = t.id('norow') AND type = 'age_review') NOT LIKE '%paused%',
  'and says nothing about reels or posts to someone who has none');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM public.notifications WHERE title = 'Your account now has adult settings'
                         AND (title || ' ' || body) ~* '(legal|\mlaw|consent|required|restrict|revoke|withdraw|approv|permission|guardian|parent)'),
  'the wording makes no legal claim and mentions no parent');

-- ---- 5. aging never widens what the person stored or posted ----------------------------------------------------
SELECT t.eq((SELECT count(*)::int FROM before_priv b
              WHERE b.vis IS DISTINCT FROM private_sec.profile_visibility_of(t.id(b.h))), 0,
  'the profile visibility reads as it did, for all seven (no stored row: members, as the cohort gave)');
SELECT t.eq((SELECT count(*)::int FROM before_priv b WHERE b.follow AND NOT public.follow_approval_required(t.id(b.h))), 0,
  'and follow approval stays on for everyone who had it, including the row the floor never clamped');
SELECT t.eq((SELECT require_follow_approval FROM public.privacy_preferences WHERE user_id = t.id('legacy')), true,
  'legacy: the stored row was put right so the adult default cannot read wider');
SELECT t.eq((SELECT profile_visibility FROM public.privacy_preferences WHERE user_id = t.id('staleb')), 'private', 'staleb: a private profile stays private');
SELECT t.eq((SELECT profile_visibility FROM public.privacy_preferences WHERE user_id = t.id('norow')), 'members', 'norow: a stored row exists now, as the cohort''s default gave it');
SELECT t.eq((SELECT require_follow_approval FROM public.privacy_preferences WHERE user_id = t.id('norow')), true, 'with follow approval on');
SELECT t.eq((SELECT privacy_row_added FROM private_sec.age_cohort_flips WHERE user_id = t.id('norow')), true, 'and the audit row says it added it');
SELECT t.eq((SELECT count(*)::int FROM private_sec.age_cohort_flips WHERE privacy_row_added), 1, 'only that one');
-- Every stored column is as it was, except the two the design changes on purpose (messages for a stale 13-15) and the stored
-- follow-approval of the row that was never clamped.
SELECT t.eq((SELECT count(*)::int FROM before_priv b
              WHERE b.h NOT IN ('norow', 'legacy', 'stalea')
                AND b.stored IS DISTINCT FROM (SELECT to_jsonb(pp) - 'updated_at' - 'created_at' FROM public.privacy_preferences pp WHERE pp.user_id = t.id(b.h))), 0,
  'every other stored privacy value is exactly as it was');
SELECT t.eq((SELECT allow_messages FROM public.privacy_preferences WHERE user_id = t.id('stalea')), 'shared', 'stalea: "everyone" became "shared" (the shared-game rule it had with adults)');
SELECT t.eq((SELECT allow_messages FROM public.privacy_preferences WHERE user_id = t.id('staleb')), 'nobody', 'staleb: "nobody" is left alone');
SELECT t.eq((SELECT allow_messages FROM public.privacy_preferences WHERE user_id = t.id('stalec')), 'everyone', 'stalec (16-17 had no such rule): unchanged');
SELECT t.eq((SELECT messages_tightened FROM private_sec.age_cohort_flips WHERE user_id = t.id('stalea')), true, 'recorded');
-- DMs: the old teen rule is gone, the stored choice carries the protection.
SELECT t.eq(public.minor_messaging_block(t.id('host'), t.id('stalea')), NULL::text, 'after: the teen rule no longer applies to the adult');
SELECT t.eq(private_sec.direct_message_refusal(t.id('host'), t.id('stalea')), 'recipient_restricted:other', 'but a stranger still cannot start a conversation (shared)');
SELECT t.eq(private_sec.direct_message_refusal(t.id('host'), t.id('staleb')), 'recipient_restricted:other', 'nor with "nobody"');
SELECT t.eq(private_sec.direct_message_refusal(t.id('host'), t.id('stalec')), NULL::text, 'a stale 16-17 was open to adults before, and is now');
INSERT INTO public.game_participants (game_id, user_id) VALUES ('gdm', t.id('stalea'));
SELECT t.eq(private_sec.direct_message_refusal(t.id('host'), t.id('stalea')), NULL::text, 'after a shared game they can message, as the rule gave before');

-- Reels: nothing is wider than it was.
SELECT t.eq((SELECT count(*)::int FROM before_reels b JOIN public.highlight_reels r USING (id)
              WHERE pg_temp.rank(public.reel_audience(r.id)) > pg_temp.rank(b.aud)), 0, 'no reel has a wider audience than before');
SELECT t.eq((SELECT count(*)::int FROM public.highlight_reels WHERE user_id IN (t.id('stalea'), t.id('stalec'), t.id('turned')) AND NOT is_draft), 0,
  'their earlier reels are drafts, visible to the owner only');
SELECT t.eq((SELECT is_draft FROM public.highlight_reels WHERE id = t.id('reel-o1')), false, 'an ordinary adult''s reel is not touched');
SELECT t.eq((SELECT is_draft FROM public.highlight_reels WHERE id = t.id('reel-k1')), false, 'nor a real 16-year-old''s');
SELECT t.eq(public.reel_audience(t.id('reel-k1')), 'members', 'whose reel is still members only');
SELECT t.eq((SELECT cardinality(drafted_reel_ids) FROM private_sec.age_cohort_flips WHERE user_id = t.id('stalec')), 2, 'the audit row lists the two reels it put aside (not the draft that already was one)');
SELECT t.eq(pg_temp.as_count('stranger', format('SELECT 1 FROM public.highlight_reels WHERE user_id = %L', t.id('stalec'))), 0, 'a member reads none of them');
SELECT t.eq(pg_temp.as_count('anon', format('SELECT 1 FROM public.highlight_reels WHERE user_id = %L', t.id('stalec'))), 0, 'nor a visitor');
SELECT t.eq(pg_temp.svc_reels('stalec', true), 0, 'and the server''s member list is empty');
SELECT t.eq(pg_temp.as_count('stalec', format('SELECT 1 FROM public.highlight_reels WHERE user_id = %L', t.id('stalec'))), 3, 'the owner still has all three');
-- Availability: the open post is paused, the paused one stays paused, nobody else's moves.
SELECT t.eq((SELECT status FROM public.player_availabilities WHERE id = t.id('post-c')), 'paused', 'the open post is paused');
SELECT t.eq((SELECT status FROM public.player_availabilities WHERE id = t.id('post-o')), 'open', 'an ordinary adult''s stays open');
SELECT t.eq(pg_temp.as_count('stranger', format('SELECT 1 FROM public.player_availabilities WHERE user_id = %L', t.id('stalec'))), 0, 'a stranger still sees no post of theirs');
SELECT t.eq((SELECT paused_availability_ids FROM private_sec.age_cohort_flips WHERE user_id = t.id('stalec')), ARRAY[t.id('post-c')], 'the audit row lists the post it paused');
-- The profile: a member sees it, a visitor does not, as before.
SELECT t.eq(pg_temp.as_count('stranger', format('SELECT 1 FROM public.profiles WHERE id = %L', t.id('stalec'))), 1, 'a member still sees the profile');
SELECT t.eq(pg_temp.as_count('anon', format('SELECT 1 FROM public.profiles WHERE id = %L', t.id('stalec'))), 0, 'a visitor still does not');
SELECT t.eq(pg_temp.as_count('anon', format('SELECT 1 FROM public.profiles WHERE id = %L', t.id('ordinary'))), 1, 'while an ordinary adult''s profile is public by their own setting');

-- ---- 5b. what others said, the person's age and the roster row do not open by themselves --------------------------
SELECT t.eq(pg_temp.eng(w), (SELECT seen FROM before_eng b WHERE b.w = x.w), 'comments and reactions read exactly as before the flip: ' || w)
  FROM (SELECT w, w AS w2 FROM unnest(ARRAY['anon', 'stranger', 'host', 'tmate', 'stalec', 'ordinary']) w) x;
SELECT t.eq(pg_temp.eng('anon'), '0,0,2,2', 'a visitor still reads none of what teammates (a 16-year-old among them) said on the flipped person''s reel, game and post');
-- A comment written after the flip follows the adult rule, as on any adult's content.
SELECT pg_temp.comment_on('ordinary', 'game', 'gsc', now() + interval '1 hour');
SELECT t.eq(pg_temp.eng('anon'), '1,1,2,2', 'one written after the flip is readable by a visitor (the adult rule)');
SELECT t.eq(pg_temp.eng('stranger'), '1,1,2,2', 'and by a stranger; the earlier ones stay closed');
SELECT t.eq((SELECT count(*)::int FROM public.post_comments WHERE subject_id = 'gsc'), 4, 'nothing was deleted (3 earlier and 1 new on the game)');
SELECT t.as_user(t.id('stranger'));
SELECT t.lives('INSERT INTO public.post_comments (subject_type, subject_id, author_id, body) VALUES (''game'', ''gsc'', auth.uid(), ''hi'')', 'a stranger may now comment on their game (adult behaviour, said in the notice)');
SELECT t.reset();
-- The same rule with the audit row closed (a correction back to a minor) is the cohort rule again: tested in section 9.

-- The age and the roster row stay held until the person saves their own Privacy settings.
SELECT t.eq(pg_temp.age_seen('stranger', 'stalec'), 0, 'a stranger still does not get the flipped person''s age');
SELECT t.eq(pg_temp.age_seen('host', 'stalec'), 0, 'nor a teammate who is an adult');
SELECT t.eq(pg_temp.age_seen('stalec', 'stalec'), 1, 'but the person does');
SELECT t.eq(pg_temp.age_seen('stranger', 'ordinary'), 1, 'an ordinary adult''s age is unchanged');
SELECT t.eq(pg_temp.roster_seen('anon', 'stalea'), 0, 'a visitor does not see the flipped 13-15''s roster row');
SELECT t.eq(pg_temp.roster_seen('stranger', 'stalea'), 0, 'nor a stranger');
SELECT t.eq(pg_temp.roster_seen('host', 'stalea'), 1, 'the manager does');
SELECT t.eq(pg_temp.roster_seen('stalea', 'stalea'), 1, 'and the person');
SELECT t.eq(pg_temp.roster_seen('anon', 'stalec'), 0, 'a visitor does not see the flipped 16-17''s roster row');
SELECT t.eq(pg_temp.roster_seen('stranger', 'stalec'), 1, 'a signed-in member does, as before');
SELECT t.eq((SELECT count(*)::int FROM private_sec.age_cohort_flips WHERE hold_released_at IS NOT NULL), 0, 'no hold has been released by anything the server did');
-- The server, support and another person never release it.
SELECT t.as_service();
UPDATE public.privacy_preferences SET marketing_emails = marketing_emails WHERE user_id = t.id('stalea');
SELECT t.reset();
SELECT t.eq((SELECT hold_released_at IS NULL FROM private_sec.age_cohort_flips WHERE user_id = t.id('stalea')), true, 'a service-role write to their row does not release it');
SELECT t.eq(pg_temp.age_seen('stranger', 'stalea'), 0, 'so a stranger still does not get the age');
-- The person saves their Privacy settings (the page upserts the whole row): that is their choice.
SELECT t.as_user(t.id('stalea'));
SELECT t.lives('UPDATE public.privacy_preferences SET marketing_emails = marketing_emails WHERE user_id = auth.uid()', 'stalea saves their Privacy settings');
SELECT t.reset();
SELECT t.eq((SELECT hold_released_at IS NOT NULL FROM private_sec.age_cohort_flips WHERE user_id = t.id('stalea')), true, 'the hold is released');
SELECT t.eq(pg_temp.age_seen('stranger', 'stalea'), 1, 'their age now follows their profile visibility, like any adult''s');
SELECT t.eq(pg_temp.roster_seen('anon', 'stalea'), 1, 'and their roster row is visible like any adult''s');
SELECT t.eq(pg_temp.eng('anon'), '1,1,2,2', 'the earlier comments of others stay closed: that is not released by saving settings');
SELECT t.eq((SELECT hold_released_at IS NULL FROM private_sec.age_cohort_flips WHERE user_id = t.id('stalec')), true, 'and nobody else''s hold moved');
SELECT t.eq(pg_temp.age_seen('stranger', 'stalec'), 0, 'stalec''s age is still held');

-- ---- 6. the flipped adult is read as an ordinary adult everywhere the cohort is read --------------------------------
SELECT t.eq(pg_temp.adultvec(h), pg_temp.adultvec('ordinary'), 'the cohort readers agree with an ordinary adult: ' || h)
  FROM unnest(ARRAY['stalea', 'staleb', 'stalec', 'norow', 'legacy', 'turned', 'leapday']) h;
SELECT t.eq(private_sec.team_is_youth('squad'), false, 'the squad, now all adults, is no longer a youth team (a consequence for the team, in the doc)');
SELECT t.eq(public.age_cohort_of(t.id('stalec')), 'adult', 'the AI gate reads adult (gate.server cohortOf)');
SELECT t.eq(private_sec.ai_analysis_allowed(t.id('stalec')), (SELECT ai_processing FROM public.privacy_preferences WHERE user_id = t.id('stalec')),
  'and AI consent is the stored choice alone: nothing is switched on for them');
SELECT t.eq(public.reel_audience(t.id('reel-o1')), 'public', 'an ordinary adult''s reel is public');
SELECT t.eq(public.platform_status(t.id('stalea')), public.platform_status(t.id('ordinary')), 'the platform status is the ordinary one: no consent hold on an adult');

-- ---- 7. the person chooses otherwise ------------------------------------------------------------------------------
SELECT t.as_user(t.id('stalec'));
SELECT t.lives(format('UPDATE public.highlight_reels SET is_draft = false WHERE id = %L', t.id('reel-c1')), 'they post one reel with the existing Post action');
SELECT t.lives(format('UPDATE public.player_availabilities SET status = ''open'' WHERE id = %L', t.id('post-c')), 'and resume their post with the existing switch');
SELECT t.lives('UPDATE public.privacy_preferences SET profile_visibility = ''public'', require_follow_approval = false WHERE user_id = auth.uid()', 'and make their profile public');
SELECT t.reset();
SELECT t.eq((SELECT hold_released_at IS NOT NULL FROM private_sec.age_cohort_flips WHERE user_id = t.id('stalec')), true, 'saving their Privacy settings released the hold on their age and roster row');
SELECT t.eq(pg_temp.age_seen('stranger', 'stalec'), 1, 'so their age follows their (now public) profile like any adult''s');
SELECT t.eq(public.reel_audience(t.id('reel-c1')), 'public', 'the posted reel is public, as an adult''s is');
SELECT t.eq(pg_temp.svc_reels('stalec', false), 1, 'and in the server''s public list');
SELECT t.eq(public.reel_audience(t.id('reel-c2')), 'none', 'the other is still a draft');
SELECT t.eq(pg_temp.as_count('stranger', format('SELECT 1 FROM public.player_availabilities WHERE user_id = %L', t.id('stalec'))), 1, 'the resumed post is listed to members');
SELECT t.eq(pg_temp.as_count('anon', format('SELECT 1 FROM public.profiles WHERE id = %L', t.id('stalec'))), 1, 'the public profile is public: the adult floor does not clamp it');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('stalec') AND title = 'Your account now has adult settings'), 1, 'and nothing is sent again');
SELECT t.eq((private_sec.age_adult_cohorts() ->> 'aged')::int, 0, 'a later sweep changes nothing for them');
SELECT t.eq((SELECT is_draft FROM public.highlight_reels WHERE id = t.id('reel-c2')), true, 'and does not draft their next reels or touch the ones they posted');

-- ---- 8. a failing person is left exactly as they were --------------------------------------------------------------
SELECT t.person('broken', 19);
DELETE FROM public.privacy_preferences WHERE user_id = t.id('broken');
ALTER TABLE public.highlight_reels DISABLE TRIGGER enforce_reel_media_ownership_trg;
INSERT INTO public.highlight_reels (id, user_id, video_path, status, is_draft)
VALUES (t.id('reel-b1'), t.id('broken'), 'elsewhere/b1.mp4', 'completed', false);
ALTER TABLE public.highlight_reels ENABLE TRIGGER enforce_reel_media_ownership_trg;
INSERT INTO public.player_availabilities (id, user_id, sports, skill_level, status, time_slots, last_confirmed_at)
VALUES (t.id('post-b'), t.id('broken'), ARRAY['Basketball'], 'All Levels', 'open', '[]', now());
SELECT pg_temp.stale('broken', 'teen_16_17');
CREATE TEMP TABLE sweep4 AS SELECT private_sec.age_adult_cohorts() AS r;
SELECT t.eq((SELECT (r ->> 'failed')::int FROM sweep4), 1, 'the person whose reel cannot be updated is counted as failed');
SELECT t.eq((SELECT (r ->> 'aged')::int FROM sweep4), 0, 'and not aged');
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('broken')), 'teen_16_17', 'still the stricter cohort');
SELECT t.eq((SELECT count(*)::int FROM public.privacy_preferences WHERE user_id = t.id('broken')), 0, 'no privacy row was left behind');
SELECT t.eq((SELECT status FROM public.player_availabilities WHERE id = t.id('post-b')), 'open', 'the post was not paused');
SELECT t.eq((SELECT count(*)::int FROM private_sec.age_cohort_flips WHERE user_id = t.id('broken')), 0, 'no audit row');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('broken')), 0, 'and nobody was told');
SELECT t.eq((SELECT count(*)::int FROM public.age_change_events WHERE user_id = t.id('broken') AND outcome = 'aged_to_adult'), 0, 'no age history row');
SELECT t.eq((r ->> 'remaining')::int, 1, 'it is still waiting') FROM sweep4;
ALTER TABLE public.highlight_reels DISABLE TRIGGER enforce_reel_media_ownership_trg;
UPDATE public.highlight_reels SET video_path = t.id('broken')::text || '/b1.mp4' WHERE id = t.id('reel-b1');
ALTER TABLE public.highlight_reels ENABLE TRIGGER enforce_reel_media_ownership_trg;
SELECT t.eq((private_sec.age_adult_cohorts() ->> 'aged')::int, 1, 'once the row is put right the next run ages them');
SELECT t.eq((SELECT is_draft FROM public.highlight_reels WHERE id = t.id('reel-b1')), true, 'with their reel put aside');

-- ---- 9. a support-approved correction back to a minor -----------------------------------------------------------------
-- review_birthday_correction writes profile_birthdays under openrun.birthday_review = 'on' (an upsert). The birthday
-- sync lowers the cohort when the new one ranks lower; the reclamp trigger re-applies the minor floor to the stored row.
SELECT t.eq((SELECT reverted_at IS NULL FROM private_sec.age_cohort_flips WHERE user_id = t.id('stalec')), true, 'setup: the flip is open');
DELETE FROM public.notifications WHERE user_id = t.id('stalec');
SELECT pg_temp.correct('stalec', (current_date - interval '16 years')::date);
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('stalec')), 'teen_16_17', 'corrected to 16: the cohort is the stricter one again');
SELECT t.eq((SELECT age_category FROM public.profiles WHERE id = t.id('stalec')), 'teen', 'with the category');
SELECT t.eq(private_sec.is_minor(t.id('stalec')), true, 'a minor');
SELECT t.eq((SELECT profile_visibility FROM public.privacy_preferences WHERE user_id = t.id('stalec')), 'members', 'the public profile they chose as an adult is clamped back to members');
SELECT t.eq((SELECT require_follow_approval FROM public.privacy_preferences WHERE user_id = t.id('stalec')), true, 'follow approval is back on');
SELECT t.eq(pg_temp.as_count('anon', format('SELECT 1 FROM public.profiles WHERE id = %L', t.id('stalec'))), 0, 'a visitor no longer sees them');
SELECT t.eq(public.reel_audience(t.id('reel-c1')), 'members', 'the reel they posted as an adult is members only again (16-17)');
SELECT t.eq((SELECT count(*)::int FROM public.age_change_events WHERE user_id = t.id('stalec') AND from_cohort = 'adult' AND to_cohort = 'teen_16_17' AND outcome = 'applied'), 1, 'the history says so');
SELECT t.eq((SELECT reverted_at IS NOT NULL FROM private_sec.age_cohort_flips WHERE user_id = t.id('stalec')), true, 'and the audit row is closed');
SELECT t.eq((private_sec.age_adult_cohorts() ->> 'aged')::int, 0, 'the sweep leaves a minor alone');
SELECT t.eq(pg_temp.eng('anon'), '0,0,2,2', 'and what was said on their content is closed again by the cohort rule (a minor''s)');
SELECT t.eq(pg_temp.age_seen('stranger', 'stalec'), 0, 'their age is the minor''s again: not given to a stranger');
-- Corrected back to an adult birthday: the existing review rule keeps the stricter cohort until a moderator decides.
SELECT pg_temp.correct('stalec', (current_date - interval '19 years')::date);
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('stalec')), 'teen_16_17', 'corrected back to an adult age: the cohort stays stricter');
SELECT t.eq((SELECT age_review_required FROM public.profiles WHERE id = t.id('stalec')), true, 'with a review pending (the existing rule)');
SELECT t.eq((private_sec.age_adult_cohorts() ->> 'aged')::int, 0, 'and the sweep does not decide it for the moderator');
-- The moderator approves: clear_age_review sets the cohort from the birthday; the next flip would be a new one.
UPDATE public.profiles SET age_review_required = false WHERE id = t.id('stalec');
SELECT t.eq((private_sec.age_adult_cohorts() ->> 'aged')::int, 1, 'once the review is cleared the sweep ages them again');
SELECT t.eq((SELECT count(*)::int FROM private_sec.age_cohort_flips WHERE user_id = t.id('stalec')), 2, 'a second audit row');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE user_id = t.id('stalec') AND title = 'Your account now has adult settings'), 1, 'and they are told once for this flip');
-- A correction that leaves an adult an adult changes nothing.
SELECT pg_temp.correct('turned', (current_date - interval '25 years')::date);
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('turned')), 'adult', 'adult to another adult age: still adult');
SELECT t.eq((SELECT reverted_at IS NULL FROM private_sec.age_cohort_flips WHERE user_id = t.id('turned')), true, 'and the flip stays open');
-- A closed audit row holds nothing: corrected to a minor, then made an adult by a moderator (not by the sweep).
SELECT t.eq(pg_temp.age_seen('stranger', 'turned'), 0, 'setup: turned''s age is held after the flip (still open)');
SELECT pg_temp.correct('turned', (current_date - interval '16 years')::date);
SELECT t.eq((SELECT reverted_at IS NOT NULL FROM private_sec.age_cohort_flips WHERE user_id = t.id('turned')), true, 'corrected to 16: the audit row is closed');
SELECT set_config('openrun.age_sync', 'on', true);
UPDATE public.profiles SET age_cohort = 'adult', age_category = 'adult' WHERE id = t.id('turned');
SELECT set_config('openrun.age_sync', 'off', true);
SELECT t.eq(pg_temp.age_seen('stranger', 'turned'), 1, 'an adult by a later decision is read as an ordinary adult: a closed audit row holds nothing');

-- ---- 10. a person who keeps failing cannot hold up everyone behind them ------------------------------------------------
-- hf1 and hf2 have a reel the sweep cannot update and ids BELOW the healthy person's: in id order they would sit at the front
-- of a cap-1 run for ever. The healthy person's name is picked so that its id sorts after both.
SELECT t.person('hfone', 19), t.person('hftwo', 19);
DO $pick$
DECLARE n int; hid uuid;
BEGIN
  SELECT x INTO n FROM generate_series(1, 400) x WHERE t.id('hg' || chr(96 + (x % 26) + 1) || chr(96 + ((x / 26) % 26) + 1)) > greatest(t.id('hfone'), t.id('hftwo')) LIMIT 1;
  PERFORM t.person('hg' || chr(96 + (n % 26) + 1) || chr(96 + ((n / 26) % 26) + 1), 19);
  CREATE TEMP TABLE hg_name AS SELECT 'hg' || chr(96 + (n % 26) + 1) || chr(96 + ((n / 26) % 26) + 1) AS h;
END $pick$;
ALTER TABLE public.highlight_reels DISABLE TRIGGER enforce_reel_media_ownership_trg;
INSERT INTO public.highlight_reels (id, user_id, video_path, status, is_draft)
VALUES (t.id('reel-hf1'), t.id('hfone'), 'elsewhere/1.mp4', 'completed', false),
       (t.id('reel-hf2'), t.id('hftwo'), 'elsewhere/2.mp4', 'completed', false);
ALTER TABLE public.highlight_reels ENABLE TRIGGER enforce_reel_media_ownership_trg;
SELECT pg_temp.stale('hfone', 'teen_16_17'), pg_temp.stale('hftwo', 'teen_16_17'), pg_temp.stale((SELECT h FROM hg_name), 'teen_16_17');
SELECT t.ok(t.id('hfone') < t.id((SELECT h FROM hg_name)) AND t.id('hftwo') < t.id((SELECT h FROM hg_name)), 'setup: both failing people sort before the healthy one');
CREATE TEMP TABLE run1 AS SELECT private_sec.age_adult_cohorts(1) AS r;
SELECT t.eq((SELECT (r ->> 'failed')::int FROM run1), 1, 'cap 1, first run: the first stuck person fails');
CREATE TEMP TABLE run2 AS SELECT private_sec.age_adult_cohorts(1) AS r;
SELECT t.eq((SELECT (r ->> 'failed')::int FROM run2), 1, 'second run: the other stuck person fails (the first went to the back)');
CREATE TEMP TABLE run3 AS SELECT private_sec.age_adult_cohorts(1) AS r;
SELECT t.eq((SELECT (r ->> 'aged')::int FROM run3), 1, 'third run: the healthy person ages although two stuck people have lower ids');
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id((SELECT h FROM hg_name))), 'adult', 'and is an adult');
SELECT t.eq((SELECT (r ->> 'failing_people')::int FROM run3), 2, 'the result says two people are still failing (so a person is told to look)');
SELECT t.eq((SELECT count(*)::int FROM private_sec.age_cohort_attempts WHERE failures = 1), 2, 'each failed once');
CREATE TEMP TABLE run4 AS SELECT private_sec.age_adult_cohorts(2) AS r;
SELECT t.eq((SELECT (r ->> 'failed')::int FROM run4), 2, 'both are tried again');
SELECT t.eq((SELECT count(*)::int FROM private_sec.age_cohort_attempts WHERE failures = 2), 2, 'and counted');
SELECT t.eq((SELECT age_cohort FROM public.profiles WHERE id = t.id('hfone')), 'teen_16_17', 'they stay on the stricter cohort');
ALTER TABLE public.highlight_reels DISABLE TRIGGER enforce_reel_media_ownership_trg;
UPDATE public.highlight_reels SET video_path = t.id('hfone')::text || '/1.mp4' WHERE id = t.id('reel-hf1');
UPDATE public.highlight_reels SET video_path = t.id('hftwo')::text || '/2.mp4' WHERE id = t.id('reel-hf2');
ALTER TABLE public.highlight_reels ENABLE TRIGGER enforce_reel_media_ownership_trg;
SELECT t.eq((private_sec.age_adult_cohorts() ->> 'aged')::int, 2, 'once their rows are put right both age');
SELECT t.eq((SELECT count(*)::int FROM private_sec.age_cohort_attempts), 0, 'and the failure list is empty');
SELECT t.ok((SELECT prosrc FROM pg_proc WHERE oid = 'private_sec.age_adult_cohorts(integer)'::regprocedure) NOT LIKE '%SQLERRM%',
  'the failure warning logs the SQLSTATE and never the message text of whatever trigger failed');
SELECT t.ok(NOT has_table_privilege(r, 'private_sec.age_cohort_attempts', 'SELECT'), 'the failure list is closed to ' || r)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT t.ok(NOT has_function_privilege(r, 'private_sec.age_hold_cohort(uuid)', 'EXECUTE'), 'the hold lookup is not callable by ' || r)
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;

ROLLBACK;
