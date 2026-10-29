-- What an anonymous visitor can read of hosted_games, by who the game is for.
--
-- The restrictive policy "Anonymous visitors see only listable games" lets anon read a game
-- only when its age range is adult-only (min_age >= 18, and max_age NULL for the open-ended
-- 18+/21+ presets or >= min_age) and it is not cancelled and not hidden by its organisation.
-- A game with no minimum (including "no limit"), a maximum-only range, a youth or mixed
-- range, or an inverted range is hidden from anon. Everyone signed in reads what they read before: this
-- file pins that too, so tightening the anonymous boundary cannot quietly block a host, a
-- participant, a guardian or another member.
BEGIN;

SELECT t.person('host', 35), t.person('adultplayer', 30), t.person('stranger', 28),
       t.person('guardian', 41), t.person('kid', 10);
SELECT t.guardian('guardian', 'kid');

-- The age trigger refuses an inverted range, which is the point of the check below: the
-- policy must not depend on it. Switch it off for the fixtures only (rolled back with the rest).
ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;

INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age) VALUES
  ('ym-adultrange',  t.id('host'), 'basketball', 'adults 21-40',      now() + interval '3 days', 21,   40),
  ('ym-adult18to99', t.id('host'), 'basketball', 'adults 18-99',      now() + interval '3 days', 18,   99),
  ('ym-adulteq',     t.id('host'), 'basketball', 'exactly 18-18',     now() + interval '3 days', 18,   18),
  ('ym-open18',      t.id('host'), 'basketball', '18+ open-ended',    now() + interval '3 days', 18,   NULL),
  ('ym-open21',      t.id('host'), 'basketball', '21+ open-ended',    now() + interval '3 days', 21,   NULL),
  ('ym-nolimit',     t.id('host'), 'basketball', 'no age limit',      now() + interval '3 days', NULL, NULL),
  ('ym-max18',       t.id('host'), 'basketball', 'up to 18',          now() + interval '3 days', NULL, 18),
  ('ym-youth17',     t.id('host'), 'basketball', 'up to 17',          now() + interval '3 days', NULL, 17),
  ('ym-youth8to12',  t.id('host'), 'basketball', '8 to 12',           now() + interval '3 days', 8,    12),
  ('ym-teenmin',     t.id('host'), 'basketball', 'from 14',           now() + interval '3 days', 14,   NULL),
  ('ym-min17',       t.id('host'), 'basketball', 'from 17',           now() + interval '3 days', 17,   NULL),
  ('ym-mixed',       t.id('host'), 'basketball', '16 to 30',          now() + interval '3 days', 16,   30),
  ('ym-inverted',    t.id('host'), 'basketball', 'inverted 40 to 30', now() + interval '3 days', 40,   30),
  ('ym-inverted2',   t.id('host'), 'basketball', 'inverted 30 to 12', now() + interval '3 days', 30,   12);
ALTER TABLE public.hosted_games ENABLE TRIGGER validate_hosted_game_age_range;

-- Valid adult ranges (21 to 40) excluded for another reason, and a past one.
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, is_private)
VALUES ('ym-private', t.id('host'), 'basketball', 'private adults', now() + interval '3 days', 21, 40, true);
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, hidden_at)
VALUES ('ym-hidden', t.id('host'), 'basketball', 'hidden adults', now() + interval '3 days', 21, 40, now());
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, cancelled_at)
VALUES ('ym-cancelled', t.id('host'), 'basketball', 'cancelled adults', now() + interval '3 days', 21, 40, now());
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, org_hidden_at)
VALUES ('ym-orghidden', t.id('host'), 'basketball', 'org-hidden adults', now() + interval '3 days', 21, 40, now());
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age)
VALUES ('ym-past', t.id('host'), 'basketball', 'past adults', now() - interval '10 days', 21, 40);

-- An adult is on the roster of the adult game and of the youth game. The age requirement on
-- joining would stop that insert, and this file is about who can READ rows, so skip it for the
-- fixture only (rolled back with the rest).
ALTER TABLE public.game_participants DISABLE TRIGGER enforce_game_age_requirement;
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('ym-youth17', t.id('adultplayer')), ('ym-adultrange', t.id('adultplayer'));
ALTER TABLE public.game_participants ENABLE TRIGGER enforce_game_age_requirement;

-- ---- the rule itself ------------------------------------------------------------------
SELECT t.eq(public.game_age_range_is_adult_only(21, 40), true, 'rule: 21 to 40 is adult-only');
SELECT t.eq(public.game_age_range_is_adult_only(18, 18), true, 'rule: 18 to 18 is adult-only');
SELECT t.eq(public.game_age_range_is_adult_only(18, 99), true, 'rule: 18 to 99 is adult-only');
SELECT t.eq(public.game_age_range_is_adult_only(NULL, NULL), false, 'rule: no age limit at all is not adult-only');
SELECT t.eq(public.game_age_range_is_adult_only(18, NULL),   true,  'rule: open-ended 18+ is adult-only');
SELECT t.eq(public.game_age_range_is_adult_only(21, NULL),   true,  'rule: open-ended 21+ is adult-only');
SELECT t.eq(public.game_age_range_is_adult_only(NULL, 40), false, 'rule: a missing minimum is not adult-only');
SELECT t.eq(public.game_age_range_is_adult_only(NULL, 18), false, 'rule: a maximum alone is not adult-only');
SELECT t.eq(public.game_age_range_is_adult_only(17, 40), false, 'rule: a minimum of 17 is not adult-only');
SELECT t.eq(public.game_age_range_is_adult_only(16, 30), false, 'rule: 16 to 30 admits minors');
SELECT t.eq(public.game_age_range_is_adult_only(8, 12), false, 'rule: 8 to 12 is not adult-only');
SELECT t.eq(public.game_age_range_is_adult_only(40, 30), false, 'rule: an inverted range is not trusted');
SELECT t.eq(public.game_age_range_is_adult_only(30, 12), false, 'rule: an inverted youth range is not adult-only');

-- ---- the helper is least-privilege ---------------------------------------------------------
SELECT t.eq(has_function_privilege('anon', 'public.game_age_range_is_adult_only(integer,integer)', 'EXECUTE'), true, 'grant: anon can execute the helper (the policy needs it)');
SELECT t.eq(has_function_privilege('authenticated', 'public.game_age_range_is_adult_only(integer,integer)', 'EXECUTE'), false, 'grant: authenticated cannot execute the helper');
SELECT t.eq(has_function_privilege('service_role', 'public.game_age_range_is_adult_only(integer,integer)', 'EXECUTE'), false, 'grant: service_role cannot execute the helper');
SELECT t.eq((SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc
             WHERE oid = 'public.game_age_range_is_adult_only(integer,integer)'::regprocedure),
            true, 'helper: search_path is pinned empty');

-- ---- an anonymous visitor ---------------------------------------------------------------
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-adultrange'''), 1, 'anon: sees an adult game (21 to 40)');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-adult18to99'''), 1, 'anon: sees an adult game (18 to 99)');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-adulteq'''), 1, 'anon: sees an 18 to 18 game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-past'''), 1, 'anon: a past adult game is still readable (no time predicate in the existing policy)');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-nolimit'''), 0, 'anon: does not see a game with no age limit (unknown age)');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-open18'''), 1, 'anon: sees an open-ended 18+ game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-open21'''), 1, 'anon: sees an open-ended 21+ game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-max18'''), 0, 'anon: does not see a game with only a maximum of 18');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-youth17'''), 0, 'anon: does not see a youth game (maximum 17)');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-youth8to12'''), 0, 'anon: does not see a game for 8 to 12');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-teenmin'''), 0, 'anon: does not see a game from age 14');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-min17'''), 0, 'anon: does not see a game from age 17');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-mixed'''), 0, 'anon: does not see a 16 to 30 game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-inverted'''), 0, 'anon: does not see an inverted range (40 to 30)');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-inverted2'''), 0, 'anon: does not see an inverted range (30 to 12)');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-private'''), 0, 'anon: does not see a private adult game (existing rule)');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-hidden'''), 0, 'anon: does not see a hidden adult game (existing rule)');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-cancelled'''), 0, 'anon: does not see a cancelled adult game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-orghidden'''), 0, 'anon: does not see an adult game its organisation hid');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id LIKE ''ym-%'''), 6, 'anon: exactly the six listable adult games are readable');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id LIKE ''ym-%'' AND min_age IS NULL'), 0, 'anon: no game without a minimum age is readable');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id LIKE ''ym-%'' AND max_age < 18'), 0, 'anon: querying for youth games returns none');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-youth17'' AND lat IS NULL'), 0, 'anon: nor does naming a youth game with another filter');
SELECT t.reset();

-- ---- everyone signed in reads what they did before -------------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-youth17'''), 1, 'member: still sees a public youth game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-mixed'''), 1, 'member: still sees a 16 to 30 game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-inverted'''), 1, 'member: still sees an inverted-range game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-nolimit'''), 1, 'member: still sees a game with no age limit');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-open18'''), 1, 'member: still sees an open-ended 18+ game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-cancelled'''), 1, 'member: still sees a cancelled public game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-orghidden'''), 1, 'member: still sees an org-hidden public game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-adultrange'''), 1, 'member: still sees an adult game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-private'''), 0, 'member: still does not see a private game they have no part in');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-hidden'''), 0, 'member: still does not see a hidden game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id LIKE ''ym-%'''), 17, 'member: the same seventeen public rows as before');
SELECT t.reset();

SELECT t.as_user(t.id('host'));
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-youth17'''), 1, 'host: sees their own youth game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-nolimit'''), 1, 'host: sees their own no-limit game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-cancelled'''), 1, 'host: sees their own cancelled game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-private'''), 1, 'host: sees their own private game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-hidden'''), 1, 'host: sees their own hidden game');
SELECT t.lives('UPDATE public.hosted_games SET title = ''up to 17 (edited)'' WHERE id = ''ym-youth17''', 'host: can still edit their youth game');
SELECT t.reset();

SELECT t.as_user(t.id('adultplayer'));
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-youth17'''), 1, 'participant: sees the youth game they joined');
SELECT t.reset();

SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-youth17'''), 1, 'guardian: sees a public youth game');
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id = ''ym-mixed'''), 1, 'guardian: sees a 16 to 30 game');
SELECT t.reset();

SELECT t.as_service();
SELECT t.eq(t.count('SELECT 1 FROM public.hosted_games WHERE id LIKE ''ym-%'''), 19, 'service role: sees every row (it bypasses row level security)');
SELECT t.reset();

-- ---- the policy is exactly what we expect ------------------------------------------------------
SELECT t.eq((SELECT count(*)::int FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'hosted_games'
               AND policyname = 'Anonymous visitors see only listable games'
               AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT' AND roles = '{anon}'),
            1, 'policy: one restrictive SELECT policy, for anon only');
SELECT t.eq((SELECT count(*)::int FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'hosted_games' AND cmd = 'SELECT'
               AND permissive = 'PERMISSIVE' AND policyname = 'Public games are viewable by everyone'),
            1, 'policy: the existing permissive public-games policy is untouched');

-- ---- participant data stays closed to visitors (pinning the existing policy) --------------------
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.game_participants'), 0, 'anon: reads no participant rows');
SELECT t.reset();
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.game_participants WHERE game_id = ''ym-youth17'''), 0, 'member: a stranger cannot read a game''s roster');
SELECT t.reset();
SELECT t.as_user(t.id('adultplayer'));
SELECT t.eq(t.count('SELECT 1 FROM public.game_participants WHERE game_id = ''ym-youth17'''), 1, 'participant: sees their own roster entry');
SELECT t.reset();

ROLLBACK;
