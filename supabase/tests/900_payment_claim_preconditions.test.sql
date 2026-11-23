-- docs/paid-path-gates.md section 6 (20261119200000_payment_claim_preconditions): a player's own manual payment claim
-- meets the game rules PayPal checkout asks before any money moves. Each refusal code (section 2), each exemption: a
-- player on the roster, a player the host approved, the host's own "marked paid" row, the server's PayPal record
-- (section 3), INSERT only (section 4), the claim and PayPal give the same answer and PayPal's answers are unchanged
-- (section 5), and no host handles for a caller who may not pay (section 6).
BEGIN;

SELECT t.person('host', 40), t.person('pa', 28), t.person('pb', 29), t.person('other', 33), t.person('kid', 14),
       t.person('teen', 16), t.person('ga', 41), t.person('young', 30);
SELECT t.guardian('ga', 'teen');
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('nodob'), 'nodob@example.test', now(), jsonb_build_object('display_name', 'Nodob', 'account_type', 'player'));
INSERT INTO public.host_payment_methods (host_id, payment_type, username)
VALUES (t.id('host'), 'venmo', 'host-handle'), (t.id('young'), 'venmo', 'young-handle');

-- All open paid games (no host approval queue), except c-appr. Roster places are given before a game is closed, aged
-- or filled, the way they would have been taken while it was open.
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price, is_private)
VALUES ('c-open',  t.id('host'),  'Open',       'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('c-canc',  t.id('host'),  'Cancelled',  'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('c-done',  t.id('host'),  'Done',       'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('c-past',  t.id('host'),  'Past',       'Basketball', now() - interval '1 day',  'Gym', 10, 10, false),
       ('c-closed',t.id('host'),  'Closed',     'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('c-cut',   t.id('host'),  'Cutoff',     'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('c-full',  t.id('host'),  'Full',       'Basketball', now() + interval '3 days', 'Gym', 2,  10, false),
       ('c-age',   t.id('host'),  'Thirties',   'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('c-appr',  t.id('host'),  'Approval',   'Basketball', now() + interval '3 days', 'Gym', 1,  10, false),
       ('c-young', t.id('young'), 'Young host', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, false);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
SELECT id, host_id, 10, id = 'c-appr' FROM public.hosted_games WHERE id LIKE 'c-%';
INSERT INTO public.game_participants (game_id, user_id)
VALUES ('c-canc', t.id('other')), ('c-past', t.id('other')), ('c-closed', t.id('other')), ('c-cut', t.id('other')),
       ('c-full', t.id('other')), ('c-full', t.id('host')), ('c-age', t.id('pb')), ('c-appr', t.id('other'));
UPDATE public.hosted_games SET cancelled_at = now() WHERE id = 'c-canc';
UPDATE public.hosted_games SET completed_at = now() WHERE id = 'c-done';
UPDATE public.hosted_games SET joins_closed = true WHERE id = 'c-closed';
UPDATE public.hosted_games SET signup_cutoff_min = 5 * 24 * 60 WHERE id = 'c-cut';
UPDATE public.hosted_games SET min_age = 30, max_age = 39 WHERE id = 'c-age';
-- young hosted as an adult; a reviewed birthday correction then shows they are 14, so they may not take payments.
SELECT set_config('openrun.birthday_review', 'on', true);
UPDATE public.profile_birthdays SET birthday = (current_date - interval '14 years 1 month')::date
 WHERE user_id = t.id('young');
SELECT set_config('openrun.birthday_review', '', true);

-- A player's own pending claim, as the pay page writes it.
CREATE FUNCTION pg_temp.claim_stmt(_who text, _game text) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type, notes) '
                'VALUES (%L, (SELECT host_id FROM public.hosted_games WHERE id = %L), %L, ''venmo'', ''Sent on Venmo'')',
                _game, _game, t.id(_who))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.claim_stmt(text, text) TO authenticated, service_role;
-- The code the database refuses a claim with (the text before the first ':'), or NULL when it records it. The claim is
-- never kept.
CREATE FUNCTION pg_temp.claim(_who text, _game text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  PERFORM t.as_user(t.id(_who));
  BEGIN
    EXECUTE pg_temp.claim_stmt(_who, _game);
    RAISE EXCEPTION 'CLAIM_RECORDED';
  EXCEPTION WHEN OTHERS THEN
    c := NULLIF(split_part(SQLERRM, ':', 1), 'CLAIM_RECORDED');
  END;
  PERFORM t.reset();
  RETURN c;
END $$;
-- What PayPal checkout is told, as the player.
CREATE FUNCTION pg_temp.paypal(_who text, _game text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  PERFORM t.as_user(t.id(_who));
  c := public.paypal_payment_precondition(_game);
  PERFORM t.reset();
  RETURN c;
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
-- How many of a payee's handles the caller is shown for a game.
CREATE FUNCTION pg_temp.handles(_who text, _payee text, _game text) RETURNS int LANGUAGE plpgsql AS $$
DECLARE n int;
BEGIN
  PERFORM t.as_user(t.id(_who));
  SELECT count(*)::int INTO n FROM public.get_game_host_payment_methods(t.id(_payee), _game);
  PERFORM t.reset();
  RETURN n;
END $$;

-- ---- 1. the shape: who may call what, and when the trigger fires ------------------------------------------------
SELECT t.ok(NOT has_function_privilege(r, 'private_sec.payment_claim_block(text, uuid)', 'EXECUTE'),
  'the rules name a player, so ' || r || ' cannot call them')
  FROM unnest(ARRAY['anon', 'authenticated', 'service_role']) r;
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                         WHERE p.oid IN ('private_sec.payment_claim_block(text, uuid)'::regprocedure,
                                         'public.enforce_payment_claim_preconditions()'::regprocedure)
                           AND a.grantee = 0),
  'neither the rules nor the trigger function is granted to PUBLIC');
SELECT t.ok(NOT has_function_privilege('authenticated', 'public.enforce_payment_claim_preconditions()', 'EXECUTE'),
  'nor is the trigger function granted to signed-in accounts');
SELECT t.eq((SELECT p.proconfig FROM pg_proc p WHERE p.oid = x.oid), ARRAY['search_path=""'], 'search_path pinned: ' || x.oid::regprocedure::text)
  FROM unnest(ARRAY['private_sec.payment_claim_block(text, uuid)'::regprocedure,
                    'public.enforce_payment_claim_preconditions()'::regprocedure,
                    'private_sec.paypal_payment_block(text)'::regprocedure,
                    'public.get_game_host_payment_methods(uuid, text)'::regprocedure]) AS x(oid);
-- tgtype 7 = ROW | BEFORE | INSERT: not UPDATE, not DELETE.
SELECT t.eq((SELECT tgtype::int FROM pg_trigger WHERE tgrelid = 'public.payment_submissions'::regclass
                AND tgname = 'zz_payment_claim_preconditions'), 7, 'the trigger runs before INSERT only, once per row');
SELECT t.eq((SELECT tgname::text FROM pg_trigger WHERE tgrelid = 'public.payment_submissions'::regclass
                AND NOT tgisinternal AND (tgtype & 6) = 6 ORDER BY tgname DESC LIMIT 1),
  'zz_payment_claim_preconditions',
  'it fires after every other BEFORE INSERT trigger, so their refusals keep their own messages');

-- ---- 2. one code per rule, for a player's own claim -------------------------------------------------------------
SELECT t.eq(pg_temp.claim('pa', 'c-open'), NULL::text, 'setup: an adult claims a place in an open game');
SELECT t.eq(pg_temp.claim('pa', 'c-canc'), 'GAME_CANCELLED', 'a cancelled game');
SELECT t.eq(pg_temp.claim('pa', 'c-done'), 'GAME_COMPLETED', 'a game marked completed');
SELECT t.eq(pg_temp.claim('pa', 'c-past'), 'GAME_COMPLETED', 'a game over by the clock');
SELECT t.eq(pg_temp.claim('pa', 'c-closed'), 'GAME_JOINS_CLOSED', 'the host closed joining');
SELECT t.eq(pg_temp.claim('pa', 'c-cut'), 'GAME_JOINS_CLOSED', 'past the signup cutoff');
SELECT t.eq(pg_temp.claim('pa', 'c-full'), 'GAME_FULL', 'no free seat (the owner''s decision: a refusal, not a warning)');
SELECT t.eq(pg_temp.claim('pa', 'c-age'), 'AGE_REQUIREMENT_NOT_MET', 'a 28-year-old, a game for 30-39');
SELECT t.eq(pg_temp.claim('other', 'c-age'), NULL::text, 'a 33-year-old in the same game may claim');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('pa'));
SELECT t.eq(pg_temp.claim('pa', 'c-open'), 'BLOCKED_BY_HOST', 'a player the host blocked');
SELECT t.eq(pg_temp.claim('pb', 'c-open'), NULL::text, 'a block is about that one player');
DELETE FROM public.user_blocks WHERE blocker_id = t.id('host');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('pa'), t.id('host'));
SELECT t.eq(pg_temp.claim('pa', 'c-open'), NULL::text, 'the player blocking the host is not a host block (one direction)');
DELETE FROM public.user_blocks WHERE blocker_id = t.id('pa');
-- A 16-year-old with a guardian: the guardian approved this game, then turned off game participation.
SELECT pg_temp.request('teen', 'c-open', false);
SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-teenc-open')), 'setup: ga approves');
SELECT t.reset();
SELECT t.eq(pg_temp.claim('teen', 'c-open'), NULL::text, 'setup: the 16-year-old may claim with the guardian''s approval');
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('teen');
SELECT t.eq(pg_temp.claim('teen', 'c-open'), 'GAME_PARTICIPATION_BLOCKED', 'a guardian who turned off game participation');
UPDATE public.child_controls SET game_participation = true WHERE child_user_id = t.id('teen');
-- The message carries the code and a sentence, as the other payment triggers' do (the app maps the code).
SELECT t.as_user(t.id('pa'));
SELECT t.throws(pg_temp.claim_stmt('pa', 'c-full'), 'GAME_FULL: this game is full', 'the refusal names its code first');
SELECT t.reset();
-- The earlier triggers still answer first with their own codes.
SELECT t.eq(pg_temp.claim('kid', 'c-full'), 'PAYMENTS_NOT_AVAILABLE', 'a 14-year-old: the cohort rule answers, as before');
SELECT t.eq(pg_temp.claim('nodob', 'c-full'), 'AGE_VERIFICATION_REQUIRED', 'no date of birth: as before');
SELECT t.eq(pg_temp.claim('pa', 'c-appr'), 'Host approval required before payment can be submitted for this game.',
  'an approval game, no approval: as before');

-- ---- 3. who is not refused -------------------------------------------------------------------------------------
-- On the roster already: the place is theirs, so only the game itself, the guardian switch and a block still count.
SELECT t.eq(pg_temp.claim('other', 'c-full'), NULL::text, 'on the roster: a full game');
SELECT t.eq(pg_temp.claim('other', 'c-closed'), NULL::text, 'on the roster: joining closed');
SELECT t.eq(pg_temp.claim('other', 'c-cut'), NULL::text, 'on the roster: past the cutoff');
SELECT t.eq(pg_temp.claim('other', 'c-past'), NULL::text, 'on the roster: over by the clock');
SELECT t.eq(pg_temp.claim('pb', 'c-age'), NULL::text, 'on the roster: outside the age range (29, a game for 30-39)');
SELECT t.eq(pg_temp.claim('other', 'c-canc'), 'GAME_CANCELLED', 'on the roster, a cancelled game: still refused');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('other'));
SELECT t.eq(pg_temp.claim('other', 'c-full'), 'BLOCKED_BY_HOST', 'on the roster, blocked by the host: still refused');
DELETE FROM public.user_blocks WHERE blocker_id = t.id('host');
-- Approved by the host: keeps their place in line through closed joining, the cutoff and the age range.
SELECT pg_temp.request('pa', 'c-closed', true), pg_temp.request('pa', 'c-cut', true), pg_temp.request('pa', 'c-age', true),
       pg_temp.request('pa', 'c-full', true), pg_temp.request('pa', 'c-past', true);
SELECT t.eq(pg_temp.claim('pa', 'c-closed'), NULL::text, 'approved: joining closed');
SELECT t.eq(pg_temp.claim('pa', 'c-cut'), NULL::text, 'approved: past the cutoff');
SELECT t.eq(pg_temp.claim('pa', 'c-age'), NULL::text, 'approved: outside the age range');
SELECT t.eq(pg_temp.claim('pa', 'c-full'), 'GAME_FULL', 'approved, but no free seat: refused (the roster would refuse it too)');
SELECT t.eq(pg_temp.claim('pa', 'c-past'), 'GAME_COMPLETED', 'approved, but over by the clock: refused');
-- The host recording a payment they received ("Marked paid by host"): the host is the writer, not the player. Row level
-- security has no insert policy for a host today (only "Players create own submissions"), so this is written with it
-- out of the way and the host as auth.uid(): it checks the trigger's own condition.
SELECT set_config('request.jwt.claim.sub', t.id('host')::text, true);
SELECT t.eq(auth.uid(), t.id('host'), 'setup: the host is the writer');
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (game_id, host_id, player_id, notes, paid_at, status, reviewed_at)
                       VALUES ('c-full', %L, %L, 'Marked paid by host', now(), 'verified', now())$q$, t.id('host'), t.id('pb')),
  'the host marking a player paid on a full game is not checked');
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (game_id, host_id, player_id, notes, paid_at, status, reviewed_at)
                       VALUES ('c-closed', %L, %L, 'Marked paid by host', now(), 'verified', now())$q$, t.id('host'), t.id('pb')),
  'nor on a game with joining closed');
SELECT set_config('request.jwt.claim.sub', t.id('pb')::text, true);
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type, notes)
                        VALUES ('c-full', %L, %L, 'venmo', 'Sent')$q$, t.id('host'), t.id('pb')),
  'GAME_FULL', 'the same write with the player as the writer is refused (negative control for the two above)');
SELECT t.reset();
-- The server recording a PayPal capture (service role, no signed-in writer): PayPal asked before the money moved.
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('pb'));
SELECT t.as_service();
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type,
                         transaction_reference, paid_amount, paid_at, notes, status, reviewed_at)
                       VALUES ('c-full', %L, %L, 'paypal', 'CAP-1', 10, now(), 'Paid with PayPal checkout', 'verified',
                               now())$q$, t.id('host'), t.id('pb')),
  'the service role''s PayPal record on a full game, for a blocked player, is not checked');
SELECT t.reset();
DELETE FROM public.user_blocks WHERE blocker_id = t.id('host');

-- ---- 4. INSERT only: claims already written can still be withdrawn, disputed, declined or confirmed ---------------
-- Four claims written while c-open had room; then it fills up and the host closes joining.
SELECT t.as_user(t.id('pa'));
INSERT INTO public.payment_submissions (id, game_id, host_id, player_id, payment_type, notes)
VALUES (t.id('ps-withdraw'), 'c-open', t.id('host'), t.id('pa'), 'venmo', 'Sent'),
       (t.id('ps-dispute'), 'c-open', t.id('host'), t.id('pa'), 'venmo', 'Sent');
SELECT t.as_user(t.id('pb'));
INSERT INTO public.payment_submissions (id, game_id, host_id, player_id, payment_type, notes)
VALUES (t.id('ps-reject'), 'c-open', t.id('host'), t.id('pb'), 'venmo', 'Sent'),
       (t.id('ps-verify'), 'c-open', t.id('host'), t.id('pb'), 'venmo', 'Sent');
SELECT t.reset();
UPDATE public.hosted_games SET max_players = 1, joins_closed = true WHERE id = 'c-open';
INSERT INTO public.game_participants (game_id, user_id) VALUES ('c-open', t.id('host'));
SELECT t.eq(pg_temp.claim('pa', 'c-open'), 'GAME_JOINS_CLOSED', 'setup: a new claim on c-open is refused now');
SELECT t.as_user(t.id('pa'));
SELECT t.eq(t.changed(format('DELETE FROM public.payment_submissions WHERE id = %L', t.id('ps-withdraw'))), 1,
  'the player can still withdraw a claim written before');
SELECT t.eq(t.changed(format($q$UPDATE public.payment_submissions SET status = 'disputed', dispute_reason = 'x' WHERE id = %L$q$,
                             t.id('ps-dispute'))), 1, 'and dispute one');
SELECT t.as_user(t.id('host'));
SELECT t.eq(t.changed(format($q$UPDATE public.payment_submissions SET status = 'rejected' WHERE id = %L$q$, t.id('ps-reject'))), 1,
  'the host can still decline one');
SELECT t.eq(t.changed(format($q$UPDATE public.payment_submissions SET status = 'verified' WHERE id = %L$q$, t.id('ps-verify'))), 1,
  'and confirm one');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.payment_submissions WHERE game_id = 'c-open'
               AND id IN (t.id('ps-dispute'), t.id('ps-reject'), t.id('ps-verify'))), 3, 'the rows written before are all still there');
UPDATE public.hosted_games SET max_players = 10, joins_closed = false WHERE id = 'c-open';
DELETE FROM public.game_participants WHERE game_id = 'c-open' AND user_id = t.id('host');
DELETE FROM public.payment_submissions WHERE game_id = 'c-open';

-- ---- 5. the claim and PayPal give one answer; PayPal's answers are unchanged ----------------------------------------
-- For adults who pass the other payment triggers, every game rule PayPal refuses with, the claim refuses with too, and
-- where PayPal says yes the claim is recorded.
DELETE FROM public.join_requests WHERE player_id = t.id('pa');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('pb'));
SELECT t.eq(pg_temp.claim(w, g), pg_temp.paypal(w, g), 'same answer: ' || w || ' on ' || g)
  FROM unnest(ARRAY['pa', 'pb', 'other']) w,
       unnest(ARRAY['c-open', 'c-canc', 'c-done', 'c-past', 'c-closed', 'c-cut', 'c-full', 'c-age']) g;
DELETE FROM public.user_blocks WHERE blocker_id = t.id('host');
-- PayPal's order is unchanged: its own checks still answer where they did, ahead of the shared place rules.
SELECT t.eq(pg_temp.paypal('host', 'c-full'), 'OWN_GAME', 'PayPal: own game, even when full');
SELECT t.eq(pg_temp.paypal('pa', 'c-young'), 'PAYMENT_DESTINATION_INVALID', 'PayPal: a payee who may not take payments');
SELECT t.eq(pg_temp.paypal('nodob', 'c-full'), 'AGE_VERIFICATION_REQUIRED', 'PayPal: no birthday comes before a full game');
SELECT t.eq(pg_temp.paypal('kid', 'c-full'), 'PAYMENTS_NOT_AVAILABLE', 'PayPal: the cohort comes before a full game');
SELECT t.eq(pg_temp.paypal('pa', 'c-appr'), 'HOST_APPROVAL_REQUIRED', 'PayPal: approval comes before a full game');
SELECT t.eq(pg_temp.paypal('teen', 'c-full'), 'GUARDIAN_APPROVAL_REQUIRED', 'PayPal: the guardian rule comes before a full game');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('pb'));
SELECT t.eq(pg_temp.paypal('pb', 'c-age'), 'BLOCKED_BY_HOST', 'PayPal: a block counts for a player on the roster');
INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type, transaction_reference, paid_amount,
                                        paid_at, notes, status, reviewed_at)
VALUES ('c-age', t.id('host'), t.id('pb'), 'paypal', 'CAP-PB', 10, now(), 'Paid with PayPal checkout', 'verified', now());
SELECT t.eq(pg_temp.paypal('pb', 'c-age'), 'BLOCKED_BY_HOST', 'PayPal: a block comes before already paid');
DELETE FROM public.user_blocks WHERE blocker_id = t.id('host');
SELECT t.eq(pg_temp.paypal('pb', 'c-age'), 'ALREADY_PAID', 'PayPal: already paid, once unblocked');
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('teen');
SELECT t.eq(pg_temp.paypal('teen', 'c-full'), 'GAME_PARTICIPATION_BLOCKED',
  'PayPal: the guardian switch comes before the guardian approval');
UPDATE public.child_controls SET game_participation = true WHERE child_user_id = t.id('teen');
SELECT t.eq(pg_temp.paypal('teen', 'c-open'), NULL::text, 'PayPal: the 16-year-old with the guardian''s approval may pay');

-- ---- 6. no host handles for a caller who may not pay -------------------------------------------------------------
SELECT t.eq(pg_temp.handles('pa', 'host', 'c-open'), 1, 'an adult player sees the host''s handles');
SELECT t.eq(pg_temp.handles('teen', 'host', 'c-open'), 1, 'so does a 16-year-old whose guardian approved the game');
SELECT t.eq(pg_temp.handles('ga', 'host', 'c-open'), 1, 'and a guardian (an adult)');
SELECT t.eq(pg_temp.handles('host', 'host', 'c-open'), 1, 'and the host, their own');
SELECT t.eq(pg_temp.handles('kid', 'host', 'c-open'), 0, 'a 14-year-old does not');
SELECT t.eq(pg_temp.handles('nodob', 'host', 'c-open'), 0, 'nor an account with no date of birth');
-- A payee who may not take payments still sees their own handles (and nobody else sees them, as before).
SELECT t.ok(NOT public.game_payments_allowed(t.id('young')), 'setup: young may not coordinate payments');
SELECT t.eq(pg_temp.handles('young', 'young', 'c-young'), 1, 'a payee sees their own handles whatever their age');
SELECT t.eq(pg_temp.handles('pa', 'young', 'c-young'), 0, 'nobody else sees a minor payee''s handles, as before');
-- The guardian's "Can join games" switch is a game rule (refused on the claim). Until 20261128120000 the handles still
-- showed; since then a caller the claim rules refuse who is not on the roster gets none (993 compares the two).
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('teen');
SELECT t.eq(pg_temp.handles('teen', 'host', 'c-open'), 0, 'the guardian switch off: no handles (the claim would be refused)');
UPDATE public.child_controls SET game_participation = true WHERE child_user_id = t.id('teen');
SELECT t.eq(pg_temp.handles('teen', 'host', 'c-open'), 1, 'and back on: they show again');
-- A consent-locked 16-year-old (parental consent required up to 17 by the age policy, and not given):
-- game_payments_allowed is false, so no handles.
INSERT INTO public.app_settings (key, value) VALUES ('age_policy', '{"parental_consent_max_age": 17}')
ON CONFLICT (key) DO UPDATE SET value = public.app_settings.value || '{"parental_consent_max_age": 17}';
UPDATE public.parental_consents SET status = 'pending' WHERE child_user_id = t.id('teen');
SELECT t.ok(NOT public.game_payments_allowed(t.id('teen')), 'setup: the 16-year-old is consent-locked');
SELECT t.eq(pg_temp.handles('teen', 'host', 'c-open'), 0, 'a consent-locked account sees no handles');

ROLLBACK;
