-- Who can read a reel that is linked to a game, straight from the table through the API.
--
-- The restrictive policy "Reels of games that are not public are readable only by their circle"
-- hides a reel from strangers (anonymous or signed in) when its game is not public to everyone:
-- youth, mixed-age, unknown-age, inverted-range, private, hidden, cancelled or organisation-hidden,
-- or no longer exists. The reel's owner, an admin, and the game's host and players still read it.
-- A reel with no game, and a reel of a public adult game, are read as before. The policy can only
-- narrow: this file also pins that the existing reel visibility rules still apply on top of it.
BEGIN;

SELECT t.person('owner', 30), t.person('host', 35), t.person('player', 29), t.person('stranger', 28),
       t.person('adminone', 45);
INSERT INTO public.user_roles (user_id, role) VALUES (t.id('adminone'), 'admin');

-- The age trigger refuses an inverted range; the policy must not depend on it, so switch it off
-- for the fixtures only (rolled back with the rest).
ALTER TABLE public.hosted_games DISABLE TRIGGER validate_hosted_game_age_range;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age) VALUES
  ('rg-public',   t.id('host'), 'basketball', 'adults 21-40',   now() + interval '3 days', 21, 40),
  ('rg-open18',   t.id('host'), 'basketball', 'adults 18+',     now() + interval '3 days', 18, NULL),
  ('rg-youth',    t.id('host'), 'basketball', 'up to 17',       now() + interval '3 days', NULL, 17),
  ('rg-mixed',    t.id('host'), 'basketball', '16 to 30',       now() + interval '3 days', 16, 30),
  ('rg-noage',    t.id('host'), 'basketball', 'no age limit',   now() + interval '3 days', NULL, NULL),
  ('rg-maxonly',  t.id('host'), 'basketball', 'max only',       now() + interval '3 days', NULL, 40),
  ('rg-inverted', t.id('host'), 'basketball', 'inverted',       now() + interval '3 days', 40, 30);
ALTER TABLE public.hosted_games ENABLE TRIGGER validate_hosted_game_age_range;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, is_private)
  VALUES ('rg-private', t.id('host'), 'basketball', 'private', now() + interval '3 days', 21, 40, true);
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, hidden_at)
  VALUES ('rg-hidden', t.id('host'), 'basketball', 'hidden', now() + interval '3 days', 21, 40, now());
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, cancelled_at)
  VALUES ('rg-cancelled', t.id('host'), 'basketball', 'cancelled', now() + interval '3 days', 21, 40, now());
INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, org_hidden_at)
  VALUES ('rg-orghidden', t.id('host'), 'basketball', 'org hidden', now() + interval '3 days', 21, 40, now());

-- The player is on the roster of the youth and private games (the join age gate is not what is
-- under test here).
ALTER TABLE public.game_participants DISABLE TRIGGER enforce_game_age_requirement;
INSERT INTO public.game_participants (game_id, user_id) VALUES
  ('rg-youth', t.id('player')), ('rg-private', t.id('player'));
ALTER TABLE public.game_participants ENABLE TRIGGER enforce_game_age_requirement;

-- One completed adult reel per case, all by the same owner; the game each links to is the case.
SELECT t.reel('owner', 'none'),    t.reel('owner', 'public'),   t.reel('owner', 'open18'),
       t.reel('owner', 'youth'),   t.reel('owner', 'mixed'),    t.reel('owner', 'noage'),
       t.reel('owner', 'maxonly'), t.reel('owner', 'inverted'), t.reel('owner', 'private'),
       t.reel('owner', 'hidden'),  t.reel('owner', 'cancelled'), t.reel('owner', 'orghidden'),
       t.reel('owner', 'missing');
UPDATE public.highlight_reels SET game_id = 'rg-' || substring(video_path FROM '/([a-z0-9]+)\.mp4$'),
       game_title = 'Secret game title'
 WHERE user_id = t.id('owner') AND video_path NOT LIKE '%/none.mp4' AND video_path NOT LIKE '%/missing.mp4';
UPDATE public.highlight_reels SET game_id = 'rg-does-not-exist', game_title = 'Secret game title'
 WHERE id = t.id('reel-missing');

-- ---- the helper ---------------------------------------------------------------------------
SELECT t.eq(has_function_privilege('anon', 'private_sec.reel_game_readable(text,uuid)', 'EXECUTE'), true,
            'grant: anon can execute the helper (the policy runs as anon)');
SELECT t.eq(has_function_privilege('authenticated', 'private_sec.reel_game_readable(text,uuid)', 'EXECUTE'), true,
            'grant: authenticated can execute the helper');
SELECT t.eq((SELECT 'search_path=""' = ANY (proconfig) FROM pg_proc
             WHERE oid = 'private_sec.reel_game_readable(text,uuid)'::regprocedure),
            true, 'helper: search_path is pinned empty');
SELECT t.eq((SELECT prosecdef FROM pg_proc WHERE oid = 'private_sec.reel_game_readable(text,uuid)'::regprocedure),
            true, 'helper: security definer, so it can look at games the viewer cannot read');
SELECT t.eq((SELECT count(*)::int FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'highlight_reels'
               AND policyname = 'Reels of games that are not public are readable only by their circle'
               AND permissive = 'RESTRICTIVE' AND cmd = 'SELECT' AND roles = '{anon,authenticated}'),
            1, 'policy: one restrictive SELECT policy, for anon and authenticated');
SELECT t.eq((SELECT count(*)::int FROM pg_policies
             WHERE schemaname = 'public' AND tablename = 'highlight_reels'
               AND policyname = 'Anyone can view visible completed reels' AND permissive = 'PERMISSIVE'),
            1, 'policy: the existing permissive public-reels policy is untouched');

-- ---- an anonymous visitor ------------------------------------------------------------------
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-none'')'),    1, 'anon: sees a reel with no game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-public'')'),  1, 'anon: sees a reel of a public adult game (21 to 40)');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-open18'')'),  1, 'anon: sees a reel of an open-ended 18+ game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-youth'')'),   0, 'anon: does not see a reel of a youth game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-mixed'')'),   0, 'anon: does not see a reel of a 16 to 30 game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-noage'')'),   0, 'anon: does not see a reel of a game with no age limit');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-maxonly'')'), 0, 'anon: does not see a reel of a maximum-only game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-inverted'')'),0, 'anon: does not see a reel of an inverted-range game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-private'')'), 0, 'anon: does not see a reel of a private game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-hidden'')'),  0, 'anon: does not see a reel of a hidden game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-cancelled'')'),0,'anon: does not see a reel of a cancelled game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-orghidden'')'),0,'anon: does not see a reel of an organisation-hidden game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-missing'')'), 0, 'anon: does not see a reel whose game no longer exists');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE user_id = t.id(''owner'')'),  3, 'anon: exactly the three public-game or gameless reels');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE user_id = t.id(''owner'') AND game_title IS NOT NULL AND game_id = ''rg-youth'''), 0,
            'anon: cannot reach a restricted reel''s game title with a filter either');
SELECT t.reset();

-- ---- a signed-in stranger: the same as anon for these reels -------------------------------------
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE user_id = t.id(''owner'')'), 3, 'stranger: exactly the three public-game or gameless reels');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-youth'')'), 0, 'stranger: does not see a reel of a youth game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-private'')'), 0, 'stranger: does not see a reel of a private game');
SELECT t.reset();

-- ---- the people the game belongs to --------------------------------------------------------------
SELECT t.as_user(t.id('owner'));
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE user_id = t.id(''owner'')'), 13, 'owner: still reads all of their own reels');
SELECT t.reset();

SELECT t.as_user(t.id('host'));
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-youth'')'),   1, 'host: reads a reel of their youth game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-private'')'), 1, 'host: reads a reel of their private game');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-missing'')'), 0, 'host: a reel whose game is gone stays with its owner');
SELECT t.reset();

SELECT t.as_user(t.id('player'));
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-youth'')'),   1, 'player: reads a reel of a youth game they play in');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-private'')'), 1, 'player: reads a reel of a private game they play in');
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-mixed'')'),   0, 'player: does not read a reel of a restricted game they are not in');
SELECT t.reset();

SELECT t.as_user(t.id('adminone'));
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE user_id = t.id(''owner'')'), 13, 'admin: still reads every reel');
SELECT t.reset();

-- ---- the existing rules still apply on top ------------------------------------------------------
UPDATE public.highlight_reels SET hidden_at = now() WHERE id = t.id('reel-public');
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-public'')'), 0, 'anon: a hidden reel of a public game is still hidden');
SELECT t.reset();
UPDATE public.highlight_reels SET hidden_at = NULL WHERE id = t.id('reel-public');

-- ---- turning a game restricted hides its reels at once ------------------------------------------
UPDATE public.hosted_games SET is_private = true WHERE id = 'rg-public';
SELECT t.as_anon();
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE id = t.id(''reel-public'')'), 0, 'anon: once the game is private its reel is hidden');
SELECT t.reset();

-- ---- the service role bypasses row level security (server code applies the rule itself) -----------
SELECT t.as_service();
SELECT t.eq(t.count('SELECT 1 FROM public.highlight_reels WHERE user_id = t.id(''owner'')'), 13, 'service role: sees every reel');
SELECT t.reset();

ROLLBACK;
