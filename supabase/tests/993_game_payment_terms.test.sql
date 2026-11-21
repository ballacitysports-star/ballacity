-- 20261128120000_game_payment_terms (docs/paid-path-gates.md section 6 (c); owner instruction 2026-11-21): the payment
-- terms a prospective player may read before approval or payment, and no handles for a caller the claim rules refuse.
-- This file checks, in order: the shape (who may call what, what the function returns), each kind of viewer on each kind
-- of game (what they are told, and that no handle and no free text is ever in it), that the host's handles and general
-- instructions stay where they were, that get_game_host_payment_methods only tightened (a full viewer-by-game
-- comparison against its previous definition: entitled callers get exactly what they got, only a caller the claim rules
-- refuse lost the handles), and that nothing the function says depends on anyone but the caller.
--
-- People: host, pa (28, a stranger), pb (29), other (33, on rosters), kid (14), teen (16, with guardian ga), ga (41), young
-- (a host later shown to be 14), nodob (no birthday), blk (the host blocked them), blkr (blocked the host), susp (a
-- suspended account), under (20), inrange (33), over (45), payer (made a claim while the game was open), host2 (a host
-- who is suspended), pri (invited to a private game), out (not invited).
BEGIN;

SELECT t.person('host', 40), t.person('pa', 28), t.person('pb', 29), t.person('other', 33), t.person('kid', 14),
       t.person('teen', 16), t.person('ga', 41), t.person('young', 30), t.person('blk', 30), t.person('blkr', 30),
       t.person('susp', 30), t.person('under', 20), t.person('inrange', 33), t.person('over', 45),
       t.person('payer', 30), t.person('hosttwo', 40), t.person('pri', 30),
       t.person('out', 30);
SELECT t.guardian('ga', 'teen');
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('nodob'), 'nodob@example.test', now(), jsonb_build_object('display_name', 'Nodob', 'account_type', 'player'));

-- The host's methods. Every one carries text that must never reach a prospective player: a handle, a label, a link,
-- a contact, instructions. Zelle is not accepted for the first game; the Apple Cash one is switched off.
INSERT INTO public.host_payment_methods (id, host_id, payment_type, label, username, payment_url, contact_info, instructions, is_enabled, created_at)
VALUES (t.id('m-venmo'),  t.id('host'), 'venmo',     'LABELVENMO',  'HANDLEVENMO',  'https://venmo.com/u/LINKVENMO',  NULL,             'DMVENMO',  true,  now() - interval '5 days'),
       (t.id('m-cash'),   t.id('host'), 'cashapp',   'LABELCASH',   '$HANDLECASH',  NULL,                             NULL,             'DMCASH',   true,  now() - interval '4 days'),
       (t.id('m-zelle'),  t.id('host'), 'zelle',     'LABELZELLE',  NULL,           NULL,                             'CONTACTZELLE',   'DMZELLE',  true,  now() - interval '3 days'),
       (t.id('m-apple'),  t.id('host'), 'applecash', 'LABELAPPLE',  NULL,           NULL,                             'CONTACTAPPLE',   NULL,       false, now() - interval '2 days'),
       (t.id('m-custom'), t.id('host'), 'custom',    'LABELCUSTOM', 'HANDLECUSTOM', NULL,                             NULL,             'DMCUSTOM', true,  now() - interval '1 days'),
       (t.id('m-venmo2'), t.id('host'), 'venmo',    'LABELVENMOTWO', 'HANDLEVENMOTWO', NULL,                          NULL,             NULL,       true,  now()),
       (t.id('m-h2'),     t.id('hosttwo'), 'venmo',  'LABELHOSTTWO', 'HANDLEHOSTTWO', NULL,                          NULL,             NULL,       true,  now()),
       (t.id('m-young'),  t.id('young'), 'venmo',    'LABELYOUNG',  'HANDLEYOUNG',  NULL,                             NULL,             NULL,       true,  now());

INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price, is_private)
VALUES ('t-open',   t.id('host'),    'Open',        'Basketball', now() + interval '3 days', 'Gym', 10, 99, false),
       ('t-all',    t.id('host'),    'All methods', 'Basketball', now() + interval '3 days', 'Gym', 10, 8,  false),
       ('t-appr',   t.id('host'),    'Approval',    'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('t-full',   t.id('host'),    'Full',        'Basketball', now() + interval '3 days', 'Gym', 2,  10, false),
       ('t-age',    t.id('host'),    'Thirties',    'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('t-canc',   t.id('host'),    'Cancelled',   'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('t-done',   t.id('host'),    'Done',        'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('t-closed', t.id('host'),    'Closed',      'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('t-priv',   t.id('host'),    'Private',     'Basketball', now() + interval '3 days', 'Gym', 10, 10, true),
       ('t-hidden', t.id('host'),    'Hidden',      'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('t-plant',  t.id('host'),    'Planted row', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('t-modhid', t.id('host'),    'Moderator hidden', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('t-none',   t.id('host'),    'No settings', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('t-free',   t.id('host'),    'Free',        'Basketball', now() + interval '3 days', 'Gym', 10, 0,  false),
       ('t-h2',     t.id('hosttwo'), 'Suspended host', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('t-young',  t.id('young'),   'Young host',  'Basketball', now() + interval '3 days', 'Gym', 10, 10, false);
-- t-open: the entry fee (12.50) is not the price (99), a deadline, two accepted methods and free text with a handle.
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, payment_deadline, accepted_method_ids, payment_instructions)
VALUES ('t-open', t.id('host'), 12.50, false, now() + interval '2 days', ARRAY[t.id('m-venmo'), t.id('m-cash')], 'FREETEXTHANDLE send it to HANDLEVENMO');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, payment_instructions)
SELECT id, t.id('host'), 10, id = 't-appr', 'FREETEXTHANDLE'
  FROM public.hosted_games WHERE id IN ('t-appr', 't-full', 't-age', 't-canc', 't-done', 't-closed', 't-priv', 't-hidden', 't-modhid', 't-plant');
-- A row for the same game written by somebody who is not its payee (the host column is not the game's host): never believed.
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, created_at)
VALUES ('t-plant', t.id('pb'), 1, false, now() + interval '1 hour');
-- t-all: no accepted-method list at all (every enabled method), and a deadline already past.
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, payment_deadline, accepted_method_ids)
VALUES ('t-all', t.id('host'), 8, false, now() - interval '1 day', '{}');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('t-free', t.id('host'), 0, false), ('t-h2', t.id('hosttwo'), 10, false), ('t-young', t.id('young'), 10, false);
INSERT INTO public.game_participants (game_id, user_id)
VALUES ('t-canc', t.id('other')), ('t-full', t.id('other')), ('t-full', t.id('host')), ('t-age', t.id('pb')),
       ('t-open', t.id('other'));
UPDATE public.hosted_games SET cancelled_at = now() WHERE id = 't-canc';
UPDATE public.hosted_games SET completed_at = now() WHERE id = 't-done';
UPDATE public.hosted_games SET joins_closed = true WHERE id = 't-closed';
UPDATE public.hosted_games SET min_age = 30, max_age = 39 WHERE id = 't-age';
-- hidden_at follows owner_hidden_at / moderator_hidden_at (a trigger keeps it equal to the first that is set).
UPDATE public.hosted_games SET owner_hidden_at = now() WHERE id = 't-hidden';
UPDATE public.hosted_games SET moderator_hidden_at = now() WHERE id = 't-modhid';
INSERT INTO public.game_invites (game_id, invitee_id, host_id, status) VALUES ('t-priv', t.id('pri'), t.id('host'), 'pending');
-- young was hosted as an adult; a reviewed birthday correction then shows they are 14.
SELECT set_config('openrun.birthday_review', 'on', true);
UPDATE public.profile_birthdays SET birthday = (current_date - interval '14 years 1 month')::date WHERE user_id = t.id('young');
SELECT set_config('openrun.birthday_review', '', true);
UPDATE public.profiles SET suspended_at = now() WHERE id IN (t.id('susp'), t.id('hosttwo'));
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('blk')), (t.id('blkr'), t.id('host'));

-- ---- helpers ------------------------------------------------------------------------------------------------------
-- The row the caller is told, as jsonb (NULL when the answer is empty).
CREATE FUNCTION pg_temp.terms(_who text, _game text) RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE r jsonb;
BEGIN
  PERFORM t.as_user(t.id(_who));
  SELECT to_jsonb(x) INTO r FROM public.get_game_payment_terms(_game) x;
  PERFORM t.reset();
  RETURN r;
END $$;
CREATE FUNCTION pg_temp.term_rows(_who text, _game text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(_who));
  SELECT count(*)::int INTO n FROM public.get_game_payment_terms(_game);
  PERFORM t.reset();
  RETURN n;
END $$;
-- How many handles the caller is shown for a game.
CREATE FUNCTION pg_temp.handles(_who text, _payee text, _game text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(_who));
  SELECT count(*)::int INTO n FROM public.get_game_host_payment_methods(t.id(_payee), _game);
  PERFORM t.reset();
  RETURN n;
END $$;
-- A join request written by the player, then (optionally) approved by the host.
CREATE FUNCTION pg_temp.request(_who text, _game text, _approve boolean) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.as_user(t.id(_who));
  INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
  VALUES (t.id('req-' || _who || _game), _game, t.id(_who), t.id('host'), 'k-' || _who || _game);
  IF _approve THEN
    PERFORM t.as_user(t.id('host'));
    UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = t.id('req-' || _who || _game);
  END IF;
  PERFORM t.reset();
END $$;
-- The words a prospective player must never be told: every handle, label, link, contact and instruction above, and
-- the host's general payment instructions.
CREATE FUNCTION pg_temp.secret_in(_row jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT _row IS NOT NULL AND _row::text ~* '(HANDLE|LABEL|LINK|CONTACT|DM[A-Z]|FREETEXT|venmo\.com|zelle@)'
$$;
-- A viewer's whole answer for a game as one string, for comparisons.
CREATE FUNCTION pg_temp.shown(_who text, _game text) RETURNS text LANGUAGE sql AS $$
  SELECT coalesce(pg_temp.terms(_who, _game)::text, '-')
$$;

-- ---- 1. the shape: who may call what, and what comes back ----------------------------------------------------------
SELECT t.ok(has_function_privilege('authenticated', 'public.get_game_payment_terms(text)', 'EXECUTE'),
  'a signed-in account may call it');
SELECT t.ok(NOT has_function_privilege('anon', 'public.get_game_payment_terms(text)', 'EXECUTE'),
  'a visitor may not (the terms are for a signed-in player)');
SELECT t.ok(NOT has_function_privilege('service_role', 'public.get_game_payment_terms(text)', 'EXECUTE'),
  'nor the service role: it answers about auth.uid()');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                         WHERE p.oid = 'public.get_game_payment_terms(text)'::regprocedure AND a.grantee = 0),
  'and it is not granted to PUBLIC');
SELECT t.ok((SELECT p.prosecdef AND p.provolatile = 's' AND p.proconfig = ARRAY['search_path=""'] AND NOT p.proretset IS DISTINCT FROM true
               FROM pg_proc p WHERE p.oid = 'public.get_game_payment_terms(text)'::regprocedure),
  'SECURITY DEFINER, STABLE (read-only), search_path pinned, set-returning');
SELECT t.eq((SELECT array_to_string(p.proargnames, ',') FROM pg_proc p WHERE p.oid = 'public.get_game_payment_terms(text)'::regprocedure),
  '_game_id,entry_fee,currency,payment_deadline,accepted_methods,requires_approval',
  'it returns exactly: fee, currency, deadline, accepted method types, approval needed');
SELECT t.eq((SELECT p.proconfig FROM pg_proc p WHERE p.oid = 'public.get_game_host_payment_methods(uuid, text)'::regprocedure),
  ARRAY['search_path=""'], 'the methods function keeps its pinned search_path');
SELECT t.ok(has_function_privilege('authenticated', 'public.get_game_host_payment_methods(uuid, text)', 'EXECUTE')
        AND NOT has_function_privilege('anon', 'public.get_game_host_payment_methods(uuid, text)', 'EXECUTE'),
  'and its grants: signed-in accounts, not visitors');
SELECT t.eq((SELECT count(*)::int FROM public.game_payment_settings WHERE game_id = 't-open'), 1, 'setup: the settings row exists');
-- A signed-out caller is told nothing.
SELECT t.as_anon();
SELECT t.throws('SELECT * FROM public.get_game_payment_terms(''t-open'')', 'permission denied', 'a visitor is refused outright');
SELECT t.reset();
-- row level security is untouched: a stranger still cannot read the row itself.
SELECT t.as_user(t.id('pa'));
SELECT t.eq(t.count('SELECT 1 FROM public.game_payment_settings WHERE game_id = ''t-open'''), 0,
  'row level security on game_payment_settings is unchanged: a stranger reads no row');
SELECT t.reset();

-- ---- 2. a stranger on an open game ----------------------------------------------------------------------------------
SELECT t.eq(pg_temp.term_rows('pa', 't-open'), 1, 'a stranger on an open paid game is told the terms');
SELECT t.eq((pg_temp.terms('pa', 't-open') ->> 'entry_fee')::numeric, 12.50, 'the entry fee is the settings fee, not the game price');
SELECT t.eq(pg_temp.terms('pa', 't-open') ->> 'currency', 'USD', 'in US dollars');
SELECT t.ok((pg_temp.terms('pa', 't-open') ->> 'payment_deadline')::timestamptz > now() + interval '1 day 23 hours'
        AND (pg_temp.terms('pa', 't-open') ->> 'payment_deadline')::timestamptz < now() + interval '2 days 1 hour',
  'the payment deadline');
SELECT t.eq(pg_temp.terms('pa', 't-open') -> 'accepted_methods', '["venmo", "cashapp"]'::jsonb,
  'the accepted method TYPES (venmo twice is one), in the order the host added them; zelle is not accepted here');
SELECT t.eq((pg_temp.terms('pa', 't-open') ->> 'requires_approval')::boolean, false, 'and that no approval is needed first');
SELECT t.ok(NOT pg_temp.secret_in(pg_temp.terms('pa', 't-open')),
  'no handle, label, link, contact or instruction, and none of the host''s free text, is in it');
SELECT t.eq((SELECT array_agg(k ORDER BY k) FROM jsonb_object_keys(pg_temp.terms('pa', 't-open')) k),
  ARRAY['accepted_methods', 'currency', 'entry_fee', 'payment_deadline', 'requires_approval'], 'exactly five keys');
-- No accepted-method list means every enabled method; a switched-off one and a custom label are not told.
SELECT t.eq(pg_temp.terms('pa', 't-all') -> 'accepted_methods', '["venmo", "cashapp", "zelle", "custom"]'::jsonb,
  'with no list: every enabled method type once (Apple Cash is switched off); a custom method is only "custom"');
SELECT t.ok(NOT pg_temp.secret_in(pg_temp.terms('pa', 't-all')), 'and still no text from the host');
SELECT t.ok((pg_temp.terms('pa', 't-all') ->> 'payment_deadline')::timestamptz < now(), 'a deadline already past is told as it is');
-- The caller still reads the same handles through the methods function, and nobody reads them through this one.
SELECT t.eq(pg_temp.handles('pa', 'host', 't-open'), 2, 'the handles stay behind get_game_host_payment_methods (the two accepted)');

-- ---- 3. a game that needs the host's approval: before and after ------------------------------------------------------
SELECT t.eq(pg_temp.term_rows('pa', 't-appr'), 1, 'an approval game tells a stranger the terms before approval');
SELECT t.eq((pg_temp.terms('pa', 't-appr') ->> 'requires_approval')::boolean, true, 'and that the host approves first');
SELECT t.ok(NOT pg_temp.secret_in(pg_temp.terms('pa', 't-appr')), 'with no handle and no free text');
SELECT pg_temp.request('pa', 't-appr', false);
SELECT t.eq(pg_temp.shown('pa', 't-appr'), pg_temp.shown('pb', 't-appr'), 'a pending request changes nothing about the terms');
SELECT t.as_user(t.id('host'));
UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = t.id('req-pat-appr');
SELECT t.reset();
SELECT t.eq(pg_temp.term_rows('pa', 't-appr'), 1, 'after approval the terms are still told');
SELECT t.eq(pg_temp.handles('pa', 'host', 't-appr'), 5, 'and the approved player reads the host''s handles (5 enabled methods), as before');

-- ---- 4. the host, a rostered player, a payer ---------------------------------------------------------------------
SELECT t.eq(pg_temp.term_rows('host', 't-open'), 1, 'the host is told their own terms');
SELECT t.ok(NOT pg_temp.secret_in(pg_temp.terms('host', 't-open')), 'and the function still hands the host no text of theirs');
SELECT t.eq(pg_temp.handles('host', 'host', 't-open'), 2, 'the host reads their handles, as before');
SELECT t.eq(pg_temp.term_rows('other', 't-open'), 1, 'a rostered player on an open game is told the terms');
SELECT t.eq(pg_temp.handles('other', 'host', 't-open'), 2, 'and keeps the handles');
-- A payer who made a claim while the game was open.
SELECT t.as_user(t.id('payer'));
INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type, notes)
VALUES ('t-open', t.id('host'), t.id('payer'), 'venmo', 'Sent on Venmo');
SELECT t.reset();
SELECT t.eq(pg_temp.term_rows('payer', 't-open'), 1, 'a payer is told the terms');

-- ---- 5. who is told nothing ---------------------------------------------------------------------------------------
SELECT t.eq(pg_temp.term_rows('blk', 't-open'), 0, 'a player the host blocked: nothing');
SELECT t.eq(pg_temp.term_rows('blkr', 't-open'), 0, 'a player who blocked the host: nothing (either direction)');
SELECT t.eq(pg_temp.term_rows('pa', 't-open'), 1, 'a block is about that one pair');
SELECT t.eq(pg_temp.term_rows('susp', 't-open'), 0, 'a suspended account: nothing');
SELECT t.eq(pg_temp.term_rows('pa', 't-h2'), 0, 'a suspended host''s game: nothing');
SELECT t.eq(pg_temp.term_rows('kid', 't-open'), 0, 'a 14-year-old: nothing');
SELECT t.eq(pg_temp.term_rows('nodob', 't-open'), 0, 'an account with no birthday: nothing');
SELECT t.eq(pg_temp.term_rows('pa', 't-young'), 0, 'a minor host: nothing');
SELECT t.eq(pg_temp.term_rows('pa', 't-full'), 0, 'a full game: nothing for a stranger');
SELECT t.eq(pg_temp.term_rows('other', 't-full'), 1, 'but a player on its roster is still told');
SELECT t.eq(pg_temp.term_rows('pa', 't-age'), 0, 'a 28-year-old, a game for 30-39: nothing');
SELECT t.eq(pg_temp.term_rows('under', 't-age'), 0, 'a 20-year-old: nothing');
SELECT t.eq(pg_temp.term_rows('over', 't-age'), 0, 'a 45-year-old: nothing');
SELECT t.eq(pg_temp.term_rows('inrange', 't-age'), 1, 'a 33-year-old in the range is told');
SELECT t.eq(pg_temp.term_rows('pb', 't-age'), 1, 'and one already on the roster');
SELECT pg_temp.request('pa', 't-age', true);
SELECT t.eq(pg_temp.term_rows('pa', 't-age'), 1, 'a player the host approved is told even outside the range (the claim rule lets them in)');
SELECT t.eq(pg_temp.term_rows('pa', 't-canc'), 0, 'a cancelled game: nothing');
SELECT t.eq(pg_temp.term_rows('pa', 't-done'), 0, 'a finished game: nothing');
SELECT t.eq(pg_temp.term_rows('pa', 't-closed'), 0, 'joining closed: nothing for a stranger');
SELECT pg_temp.request('pb', 't-closed', true);
SELECT t.eq(pg_temp.term_rows('pb', 't-closed'), 1, 'but a player the host approved is told');
SELECT t.eq((pg_temp.terms('pa', 't-plant') ->> 'entry_fee')::numeric, 10, 'a settings row for the game that is not the payee''s is never believed (the payee''s fee, not the planted one)');
SELECT t.eq(pg_temp.term_rows('pa', 't-none'), 0, 'a game with no payment settings: nothing (the same empty answer)');
SELECT t.eq(pg_temp.term_rows('pa', 't-free'), 0, 'a free game: nothing');
SELECT t.eq(pg_temp.term_rows('pa', 'no-such-game'), 0, 'a game that does not exist: nothing');
SELECT t.eq(pg_temp.term_rows('pa', NULL), 0, 'no game: nothing');
SELECT t.eq(pg_temp.shown('pa', 't-none'), pg_temp.shown('pa', 'no-such-game'),
  'a refused caller cannot tell a game with no settings from a game that is not there');
SELECT t.eq(pg_temp.shown('pa', 't-full'), pg_temp.shown('pa', 't-none'), 'nor a refused game from one with no settings');

-- ---- 6. a private game, and a hidden one ----------------------------------------------------------------------------
SELECT t.eq(pg_temp.term_rows('out', 't-priv'), 0, 'a private game the caller cannot see: nothing, as if it did not exist');
SELECT t.eq(pg_temp.shown('out', 't-priv'), pg_temp.shown('out', 'no-such-game'), 'the same answer as a game that is not there');
SELECT t.eq(pg_temp.term_rows('pa', 't-priv'), 0, 'a stranger to a private game: nothing');
SELECT t.eq(pg_temp.term_rows('pri', 't-priv'), 1, 'an invitee, who may see the game: told');
SELECT t.eq(pg_temp.term_rows('host', 't-priv'), 1, 'and its host');
SELECT t.eq(pg_temp.term_rows('pa', 't-hidden'), 0, 'a hidden public game: nothing for a stranger');
SELECT pg_temp.request('pb', 't-hidden', false);
SELECT t.eq(pg_temp.term_rows('pb', 't-hidden'), 1, 'a requester of a game its host hid still sees it, so is told');
SELECT t.eq(pg_temp.term_rows('pa', 't-modhid'), 0, 'a game a moderator hid: nothing for a stranger');
SELECT pg_temp.request('pb', 't-modhid', false);
SELECT t.eq(pg_temp.term_rows('pb', 't-modhid'), 0, 'nor for a requester (a moderator''s hide holds)');
SELECT t.eq(pg_temp.term_rows('host', 't-modhid'), 1, 'the host still reads their own');

-- ---- 7. a guardian-held minor, with and without the approval -----------------------------------------------------
SELECT t.eq(pg_temp.term_rows('teen', 't-open'), 0, 'a 16-year-old with a guardian, before the guardian approves: nothing');
SELECT pg_temp.request('teen', 't-open', false);
SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-teent-open')), 'setup: ga approves');
SELECT t.reset();
SELECT t.eq(pg_temp.term_rows('teen', 't-open'), 1, 'with the guardian''s approval: told');
SELECT t.ok(NOT pg_temp.secret_in(pg_temp.terms('teen', 't-open')), 'and no handle');
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('teen');
SELECT t.eq(pg_temp.term_rows('teen', 't-open'), 0, 'the guardian turns off game participation: nothing');
SELECT t.eq(pg_temp.handles('teen', 'host', 't-open'), 0, 'and no handles either (the claim would be refused)');
UPDATE public.child_controls SET game_participation = true WHERE child_user_id = t.id('teen');
SELECT t.eq(pg_temp.handles('teen', 'host', 't-open'), 2, 'switched back on: the handles are back');
SELECT t.eq(pg_temp.term_rows('ga', 't-open'), 1, 'a guardian (an adult) is told like any adult');
-- An approved requester is tightened exactly where the claim is refused (the switch is a game rule, approval does not lift it).
SELECT t.as_user(t.id('host'));
UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = t.id('req-teent-open');
SELECT t.reset();
SELECT t.eq(pg_temp.handles('teen', 'host', 't-open'), 2, 'the host approves the teen too: handles, as before');
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('teen');
SELECT t.eq(pg_temp.handles('teen', 'host', 't-open'), 0, 'an approved requester whose guardian switch is off: no handles (the claim would be refused)');
SELECT t.eq(pg_temp.term_rows('teen', 't-open'), 0, 'and no terms');
UPDATE public.child_controls SET game_participation = true WHERE child_user_id = t.id('teen');
SELECT t.eq(pg_temp.handles('teen', 'host', 't-open'), 2, 'the switch back on: the handles are back');

-- ---- 8. get_game_host_payment_methods only tightened -------------------------------------------------------------------
-- The previous definition (20261119200000), kept here as a function of its own, so the two can be compared on every
-- viewer and every game in this file.
CREATE FUNCTION pg_temp.old_methods(_host_id uuid, _game_id text)
 RETURNS TABLE(id uuid) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO ''
AS $function$
DECLARE
  _settings public.game_payment_settings%ROWTYPE;
  _me uuid := auth.uid();
BEGIN
  IF _me IS NULL THEN RETURN; END IF;
  IF _host_id IS DISTINCT FROM private_sec.game_payee(_game_id) THEN RETURN; END IF;
  IF _me IS DISTINCT FROM _host_id AND NOT public.game_payments_allowed(_me) THEN RETURN; END IF;
  IF _me IS DISTINCT FROM _host_id AND public.age_cohort_of(_host_id) IS DISTINCT FROM 'adult' THEN RETURN; END IF;
  IF NOT private_sec.can_read_game_payment_settings(_game_id, _host_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.hosted_games g
        WHERE g.id = _game_id
          AND ((g.is_private = false AND g.hidden_at IS NULL)
               OR g.host_id = _me
               OR ((g.is_private = true OR g.moderator_hidden_at IS NULL)
                   AND (public.is_game_participant(g.id, _me)
                        OR EXISTS (SELECT 1 FROM public.join_requests jr
                                    WHERE jr.game_id = g.id AND jr.player_id = _me))))) THEN
    RETURN;
  END IF;
  SELECT * INTO _settings FROM public.game_payment_settings gps
   WHERE gps.game_id = _game_id AND gps.host_id = _host_id ORDER BY gps.created_at DESC LIMIT 1;
  IF _settings.id IS NULL THEN RETURN; END IF;
  RETURN QUERY
    SELECT hpm.id FROM public.host_payment_methods hpm
     WHERE hpm.host_id = _host_id AND hpm.is_enabled = true
       AND (COALESCE(array_length(_settings.accepted_method_ids, 1), 0) = 0 OR hpm.id = ANY(_settings.accepted_method_ids));
END;
$function$;
-- The payer's claim is in; now the game is cancelled under them (they have no place).
UPDATE public.hosted_games SET cancelled_at = now() WHERE id = 't-open';
-- Every viewer against every game: the new answer is the old one, except for a caller the claim rules refuse who is
-- not the payee, not on the roster and has no claim of their own (who gets nothing).
CREATE TABLE pg_temp.cmp (who text, game text, old_n int, new_n int, refused text, entitled boolean);
GRANT ALL ON TABLE pg_temp.cmp TO PUBLIC;
DO $cmp$
DECLARE w text; gm record; o int; n int; refused text; ent boolean;
BEGIN
  FOR w IN SELECT unnest(ARRAY['host', 'pa', 'pb', 'other', 'kid', 'teen', 'ga', 'nodob', 'blk', 'blkr', 'susp', 'under',
                               'inrange', 'over', 'payer', 'pri', 'out'])
  LOOP
    FOR gm IN SELECT id, host_id FROM public.hosted_games WHERE id LIKE 't-%' LOOP
      PERFORM t.as_user(t.id(w));
      SELECT count(*)::int INTO o FROM pg_temp.old_methods(gm.host_id, gm.id);
      SELECT count(*)::int INTO n FROM public.get_game_host_payment_methods(gm.host_id, gm.id);
      PERFORM t.reset();
      refused := private_sec.payment_claim_block(gm.id, t.id(w));
      ent := t.id(w) = gm.host_id
             OR EXISTS (SELECT 1 FROM public.game_participants gp WHERE gp.game_id = gm.id AND gp.user_id = t.id(w))
             OR EXISTS (SELECT 1 FROM public.payment_submissions ps WHERE ps.game_id = gm.id AND ps.player_id = t.id(w));
      INSERT INTO pg_temp.cmp VALUES (w, gm.id, o, n, refused, ent);
    END LOOP;
  END LOOP;
END
$cmp$;
SELECT t.ok((SELECT count(*) FROM pg_temp.cmp) = 17 * 16, 'the comparison covers every viewer on every game (272 pairs)');
SELECT t.ok((SELECT count(*) FROM pg_temp.cmp WHERE old_n > 0) > 30, 'and many of them held handles before (so the comparison means something)');
SELECT t.ok((SELECT count(*) FROM pg_temp.cmp WHERE new_n > old_n) = 0, 'no viewer was given a handle the old function did not give');
SELECT t.ok((SELECT count(*) FROM pg_temp.cmp WHERE entitled AND new_n <> old_n) = 0,
  'the payee, a rostered player and a payer get exactly what they got (on every game, ended and cancelled included)');
SELECT t.ok((SELECT count(*) FROM pg_temp.cmp WHERE NOT entitled AND refused IS NULL AND new_n <> old_n) = 0,
  'a caller the claim rules would let through gets exactly what they got');
SELECT t.ok((SELECT count(*) FROM pg_temp.cmp WHERE NOT entitled AND refused IS NOT NULL AND old_n > 0 AND new_n = 0) > 5,
  'a caller the claim rules refuse, who held handles, now gets none (the gap this closes)');
SELECT t.ok((SELECT count(*) FROM pg_temp.cmp WHERE NOT entitled AND refused IS NOT NULL AND new_n > 0) = 0,
  'and no caller the claim rules refuse is shown any handle');
SELECT t.ok((SELECT count(*) FROM pg_temp.cmp WHERE new_n < old_n AND NOT (NOT entitled AND refused IS NOT NULL)) = 0,
  'nobody lost handles for any other reason');
-- Named cases, so a failure points at the person:
SELECT t.eq(pg_temp.handles('pa', 'host', 't-full'), 0, 'a stranger on a full game: no handles (before: 2)');
SELECT t.eq(pg_temp.handles('other', 'host', 't-full'), 5, 'a rostered player on the same full game: all 5 enabled methods, unchanged');
SELECT t.eq(pg_temp.handles('pa', 'host', 't-age'), 5, 'a player the host approved, outside the age range, keeps them');
SELECT t.eq(pg_temp.handles('under', 'host', 't-age'), 0, 'a 20-year-old, a game for 30-39: no handles');
SELECT t.eq(pg_temp.handles('blk', 'host', 't-all'), 0, 'a player the host blocked: no handles');
SELECT t.eq(pg_temp.handles('blkr', 'host', 't-all'), 5, 'a player who blocked the host is not refused by the claim rules: unchanged');
SELECT t.eq(pg_temp.handles('payer', 'host', 't-open'), 2, 'a payer keeps the handles although the game is now cancelled');
SELECT t.eq(pg_temp.handles('pa', 'host', 't-open'), 0, 'while a stranger does not (cancelled)');
SELECT t.eq(pg_temp.handles('other', 'host', 't-open'), 2, 'a rostered player keeps them on a cancelled game');
SELECT t.eq(pg_temp.handles('host', 'host', 't-open'), 2, 'the host keeps them');
SELECT t.eq(pg_temp.handles('pa', 'host', 't-all'), 5, 'an ordinary stranger on an open game: all five enabled methods, as before');
-- An approved requester who is not on the roster of a game that is full: the claim is refused (GAME_FULL), so no handles.
SELECT pg_temp.request('pa', 't-full', true);
SELECT t.eq(pg_temp.handles('pa', 'host', 't-full'), 0, 'an approved requester of a full game, not on the roster: no handles (the claim would be refused)');
SELECT t.eq(pg_temp.term_rows('pa', 't-full'), 0, 'and no terms');
SELECT t.eq(pg_temp.handles('other', 'host', 't-full'), 5, 'while the rostered player is unchanged');

-- ---- 9. the answer is about the caller only ------------------------------------------------------------------------
SELECT t.eq(pg_temp.shown('pa', 't-all'), pg_temp.shown('pb', 't-all'), 'two strangers are told the same thing');
SELECT t.ok(pg_get_functiondef('public.get_game_payment_terms(text)'::regprocedure) !~* 'user_id|username|display_name|full_name|email',
  'the function reads no personal field of anyone');
SELECT t.ok(pg_get_functiondef('public.get_game_payment_terms(text)'::regprocedure) !~* 'game_participants (gp )?WHERE|count\(',
  'and counts nobody else (no roster size, no list of players)');

ROLLBACK;
