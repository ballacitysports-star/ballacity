-- Task #69: PayPal checkout checks every payment rule before any money moves.
--
-- The server records a PayPal payment, and then the roster place, with the service role after PayPal has moved the
-- money. So before it creates an order and again right before it captures one, it asks
-- public.paypal_payment_precondition(game) as the player: NULL when the player may pay now, else a code. This file
-- checks each code, that the answer is only ever about the caller, that the API roles that must not ask cannot, and
-- that every refusal the server's own writes would meet is a refusal here first (section 5). The triggers are not
-- changed (section 6).
BEGIN;

SELECT t.person('host', 40), t.person('pa', 28), t.person('pb', 29), t.person('kid', 14), t.person('teen', 16),
       t.person('ga', 41), t.person('young', 30), t.person('other', 33);
SELECT t.guardian('ga', 'teen');

-- g-open: open paid game. g-appr: the host approves each player. g-noset: no payment settings row.
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price, is_private)
VALUES ('g-open',  t.id('host'), 'Open',      'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('g-appr',  t.id('host'), 'Approval',  'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('g-noset', t.id('host'), 'No set',    'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('g-priv',  t.id('host'), 'Private',   'Basketball', now() + interval '3 days', 'Gym', 10, 10, true),
       ('g-canc',  t.id('host'), 'Cancelled', 'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('g-done',  t.id('host'), 'Done',      'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('g-past',  t.id('host'), 'Past',      'Basketball', now() - interval '1 day',  'Gym', 10, 10, false),
       ('g-closed',t.id('host'), 'Closed',    'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('g-full',  t.id('host'), 'Full',      'Basketball', now() + interval '3 days', 'Gym', 1,  10, false),
       ('g-age',   t.id('host'), 'Thirties',  'Basketball', now() + interval '3 days', 'Gym', 10, 10, false),
       ('g-young', t.id('young'),'Young host','Basketball', now() + interval '3 days', 'Gym', 10, 10, false);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
SELECT id, host_id, 10, id = 'g-appr' FROM public.hosted_games
 WHERE id IN ('g-open', 'g-appr', 'g-priv', 'g-canc', 'g-done', 'g-past', 'g-closed', 'g-full', 'g-age', 'g-young');
UPDATE public.hosted_games SET cancelled_at = now() WHERE id = 'g-canc';
UPDATE public.hosted_games SET completed_at = now() WHERE id = 'g-done';
UPDATE public.hosted_games SET joins_closed = true WHERE id = 'g-closed';
UPDATE public.hosted_games SET min_age = 30, max_age = 39 WHERE id = 'g-age';
INSERT INTO public.game_participants (game_id, user_id) VALUES ('g-full', t.id('other'));
-- young hosted as an adult; a reviewed birthday correction then shows they are 14, so they may not take payments.
SELECT set_config('openrun.birthday_review', 'on', true);
UPDATE public.profile_birthdays SET birthday = (current_date - interval '14 years 1 month')::date
 WHERE user_id = t.id('young');
SELECT set_config('openrun.birthday_review', '', true);

CREATE TEMP TABLE q AS SELECT 'SELECT public.paypal_payment_precondition(''g-open'') AS code' AS sql;
GRANT SELECT ON q TO PUBLIC;

-- A function the server would call as the player. Each answer is read as that player.
CREATE FUNCTION pg_temp.code(_who text, _game text) RETURNS text LANGUAGE plpgsql AS $$
DECLARE c text;
BEGIN
  PERFORM t.as_user(t.id(_who));
  c := public.paypal_payment_precondition(_game);
  PERFORM t.reset();
  RETURN c;
END $$;

-- A join request written the way the app writes one: by the player, then answered by the host.
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

-- ---- 1. who may ask -------------------------------------------------------------------------------------------
SELECT t.ok(has_function_privilege('authenticated', 'public.paypal_payment_precondition(text)', 'EXECUTE'),
  'a signed-in player can ask');
SELECT t.ok(NOT has_function_privilege('anon', 'public.paypal_payment_precondition(text)', 'EXECUTE'),
  'a signed-out visitor cannot');
SELECT t.ok(NOT has_function_privilege('service_role', 'public.paypal_payment_precondition(text)', 'EXECUTE'),
  'the service role cannot (it has no player to answer for)');
SELECT t.ok(NOT has_function_privilege('anon', 'private_sec.paypal_payment_block(text)', 'EXECUTE')
        AND NOT has_function_privilege('service_role', 'private_sec.paypal_payment_block(text)', 'EXECUTE'),
  'nor can they call the rules behind it');
SELECT t.ok(NOT EXISTS (SELECT 1 FROM pg_proc p, aclexplode(p.proacl) a
                         WHERE p.oid IN ('public.paypal_payment_precondition(text)'::regprocedure,
                                         'private_sec.paypal_payment_block(text)'::regprocedure)
                           AND a.grantee = 0),
  'neither is granted to PUBLIC');
SELECT t.as_anon();
SELECT t.throws((SELECT sql FROM q), 'permission denied', 'a signed-out visitor is refused');
SELECT t.as_service();
SELECT t.throws((SELECT sql FROM q), 'permission denied', 'the service role is refused');
SELECT t.reset();
SELECT t.eq(public.paypal_payment_precondition('g-open'), 'SIGN_IN_REQUIRED', 'with nobody signed in: never NULL');

-- ---- 2. it answers only for the caller ------------------------------------------------------------------------
SELECT t.eq((SELECT array_agg(format_type(x, NULL)) FROM pg_proc p, unnest(p.proargtypes) x
              WHERE p.oid = 'public.paypal_payment_precondition(text)'::regprocedure), ARRAY['text'],
  'it takes a game and nothing else: no user can be named');
SELECT t.eq((SELECT array_agg(format_type(x, NULL)) FROM pg_proc p, unnest(p.proargtypes) x
              WHERE p.oid = 'private_sec.paypal_payment_block(text)'::regprocedure), ARRAY['text'],
  'nor can one be named to the rules behind it');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('pb'));
SELECT t.eq(pg_temp.code('pa', 'g-open'), NULL::text, 'pa may pay for the open game');
SELECT t.eq(pg_temp.code('pb', 'g-open'), 'BLOCKED_BY_HOST', 'pb, whom the host blocked, may not');
SELECT t.eq(pg_temp.code('pa', 'g-open'), NULL::text, 'and asking as pb told pa nothing about pb (pa still NULL)');
DELETE FROM public.user_blocks WHERE blocker_id = t.id('host');

-- ---- 3. one code per rule -------------------------------------------------------------------------------------
SELECT t.eq(pg_temp.code('pa', 'nope'), 'GAME_NOT_FOUND', 'no such game');
SELECT t.eq(pg_temp.code('pa', 'g-priv'), 'GAME_NOT_FOUND', 'a private game the player cannot see: the same answer');
SELECT t.as_user(t.id('pa'));
SELECT t.eq(private_sec.paypal_payment_block('g-priv'), NULL::text,
  'setup: the rules alone would let pa pay, so the answer above is the visibility check');
SELECT t.reset();
UPDATE public.hosted_games SET hidden_at = now() WHERE id = 'g-open';
SELECT t.eq(pg_temp.code('pa', 'g-open'), 'GAME_NOT_FOUND', 'a hidden game the player has no part in');
UPDATE public.hosted_games SET hidden_at = NULL WHERE id = 'g-open';
SELECT t.eq(pg_temp.code('pa', 'g-canc'), 'GAME_CANCELLED', 'a cancelled game');
SELECT t.eq(pg_temp.code('pa', 'g-done'), 'GAME_COMPLETED', 'a completed game');
SELECT t.eq(pg_temp.code('pa', 'g-past'), 'GAME_COMPLETED', 'a game over by the clock');
SELECT t.eq(pg_temp.code('host', 'g-open'), 'OWN_GAME', 'the host of the game');
SELECT t.eq(pg_temp.code('pa', 'g-young'), 'PAYMENT_DESTINATION_INVALID', 'a payee who may not take payments');
SELECT t.eq(pg_temp.code('kid', 'g-open'), 'PAYMENTS_NOT_AVAILABLE', 'a 14-year-old may not coordinate payments');
SELECT t.eq(pg_temp.code('pb', 'g-open'), NULL::text, 'setup: pb may pay once unblocked');
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('pb'));
SELECT t.eq(pg_temp.code('pb', 'g-open'), 'BLOCKED_BY_HOST', 'a player the host blocked');
DELETE FROM public.user_blocks WHERE blocker_id = t.id('host');

-- Host approval.
SELECT t.eq(pg_temp.code('pa', 'g-appr'), 'HOST_APPROVAL_REQUIRED', 'approval required, no request');
SELECT pg_temp.request('pa', 'g-appr', false);
SELECT t.eq(pg_temp.code('pa', 'g-appr'), 'HOST_APPROVAL_REQUIRED', 'approval required, request pending');
SELECT t.as_user(t.id('host'));
UPDATE public.join_requests SET status = 'approved', reviewed_at = now() WHERE id = t.id('req-pag-appr');
SELECT t.reset();
SELECT t.eq(pg_temp.code('pa', 'g-appr'), NULL::text, 'approval required, request approved');
SELECT t.eq(pg_temp.code('pa', 'g-noset'), 'HOST_APPROVAL_REQUIRED',
  'no settings row and not on the roster: request-to-join, as the roster placement treats it');
INSERT INTO public.game_participants (game_id, user_id) VALUES ('g-noset', t.id('pa'));
SELECT t.eq(pg_temp.code('pa', 'g-noset'), NULL::text, 'no settings row, already on the roster: may pay');

-- The guardian rule (20261111100000), asked through game_payment_guardian_ready.
SELECT t.eq(pg_temp.code('teen', 'g-open'), 'GUARDIAN_APPROVAL_REQUIRED', 'a 16-year-old with a guardian, no approval');
SELECT pg_temp.request('teen', 'g-open', false);
SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req-teeng-open')), 'ga approves');
SELECT t.reset();
SELECT t.eq(pg_temp.code('teen', 'g-open'), NULL::text, 'with the guardian''s approval the 16-year-old may pay');
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('teen');
SELECT t.eq(pg_temp.code('teen', 'g-open'), 'GAME_PARTICIPATION_BLOCKED',
  'a guardian who turned off game participation');
UPDATE public.child_controls SET game_participation = true WHERE child_user_id = t.id('teen');

-- No declared age (review): enforce_child_game_participation refuses a player who has not given a date of birth when
-- they join by themselves, and the server's roster write skips that. So it is asked here.
INSERT INTO auth.users (id, email, email_confirmed_at, raw_user_meta_data)
VALUES (t.id('nodob'), 'nodob@example.test', now(),
        jsonb_build_object('display_name', 'Nodob', 'account_type', 'player'));
SELECT t.ok(NOT public.age_verified(t.id('nodob')), 'setup: an account with no date of birth');
SELECT t.eq(pg_temp.code('nodob', 'g-open'), 'AGE_VERIFICATION_REQUIRED', 'an account with no declared age');

-- Age range.
SELECT t.eq(pg_temp.code('pa', 'g-age'), 'AGE_REQUIREMENT_NOT_MET', 'a 28-year-old, a game for 30-39');
SELECT t.eq(pg_temp.code('other', 'g-age'), NULL::text, 'a 33-year-old may pay');
SELECT pg_temp.request('pa', 'g-age', true);
SELECT t.eq(pg_temp.code('pa', 'g-age'), NULL::text, 'the host approved the 28-year-old');

-- Joining closed, and a full roster.
SELECT t.eq(pg_temp.code('pa', 'g-closed'), 'GAME_JOINS_CLOSED', 'joining closed, not approved');
SELECT pg_temp.request('pa', 'g-closed', true);
SELECT t.eq(pg_temp.code('pa', 'g-closed'), NULL::text, 'joining closed, approved: keeps their place in line');
UPDATE public.hosted_games SET signup_cutoff_min = 5 * 24 * 60 WHERE id = 'g-open';
SELECT t.eq(pg_temp.code('pb', 'g-open'), 'GAME_JOINS_CLOSED', 'past the signup cutoff, not approved');
UPDATE public.hosted_games SET signup_cutoff_min = 0 WHERE id = 'g-open';
SELECT t.eq(pg_temp.code('pa', 'g-full'), 'GAME_FULL', 'no free seat');
SELECT t.eq(pg_temp.code('other', 'g-full'), NULL::text, 'the player already in the seat may still pay');

-- Already paid.
INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type, transaction_reference, paid_amount,
                                        paid_at, notes, status, reviewed_at)
VALUES ('g-open', t.id('host'), t.id('pb'), 'paypal', 'CAPTURE-PB', 10, now(), 'Paid with PayPal checkout',
        'verified', now());
SELECT t.eq(pg_temp.code('pb', 'g-open'), 'ALREADY_PAID', 'a verified payment for this game already');
SELECT t.eq(pg_temp.code('pb', 'g-closed'), 'GAME_JOINS_CLOSED', 'which counts only for its own game');

-- ---- 4. the answers are the same through PostgREST's role, not just the test's ------------------------------------
SELECT t.as_user(t.id('pa'));
SELECT t.eq((SELECT public.paypal_payment_precondition('g-open')), NULL::text, 'as authenticated: NULL for pa');
SELECT t.reset();

-- ---- 5. every refusal the server's own writes would meet is refused here first -----------------------------------
-- What capture does after the money has moved, as the service role: record a verified payment, then the roster place.
CREATE FUNCTION pg_temp.pay_stmt(_who text, _game text, _host text DEFAULT 'host') RETURNS text LANGUAGE sql AS $$
  SELECT format($q$INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type,
                     transaction_reference, paid_amount, paid_at, notes, status, reviewed_at)
                   VALUES (%L, %L, %L, 'paypal', 'CAPTURE-X', 10, now(), 'Paid with PayPal checkout', 'verified',
                           now())$q$, _game, t.id(_host), t.id(_who))
$$;
CREATE FUNCTION pg_temp.seat_stmt(_who text, _game text) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.game_participants (game_id, user_id) VALUES (%L, %L)', _game, t.id(_who))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.pay_stmt(text, text, text), pg_temp.seat_stmt(text, text) TO service_role;
DELETE FROM public.join_requests WHERE id = t.id('req-pag-appr');

SELECT t.as_service();
SELECT t.throws(pg_temp.pay_stmt('pa', 'g-appr'), 'Host approval required',
  'HOST_APPROVAL_REQUIRED: the payment record would be refused');
SELECT t.throws(pg_temp.pay_stmt('kid', 'g-open'), 'PAYMENTS_NOT_AVAILABLE',
  'PAYMENTS_NOT_AVAILABLE: the payment record would be refused');
SELECT t.throws(pg_temp.pay_stmt('pa', 'g-young', 'young'), 'PAYMENTS_NOT_AVAILABLE',
  'PAYMENT_DESTINATION_INVALID (payee may not take payments): the payment record would be refused');
SELECT t.throws(pg_temp.pay_stmt('pa', 'g-open', 'young'), 'PAYMENT_DESTINATION_INVALID',
  'and a payment to anyone but the payee would be refused');
SELECT t.throws(pg_temp.seat_stmt('pa', 'g-canc'), 'GAME_CANCELLED', 'GAME_CANCELLED: the roster place would be refused');
SELECT t.throws(pg_temp.seat_stmt('pa', 'g-done'), 'GAME_COMPLETED', 'GAME_COMPLETED: the roster place would be refused');
SELECT t.throws(pg_temp.seat_stmt('pb', 'g-closed'), 'GAME_JOINS_CLOSED',
  'GAME_JOINS_CLOSED: the roster place would be refused');
SELECT t.throws(pg_temp.seat_stmt('pa', 'g-full'), 'GAME_FULL', 'GAME_FULL: the roster place would be refused');
SELECT t.throws(pg_temp.seat_stmt('pb', 'g-age'), 'age requirement',
  'AGE_REQUIREMENT_NOT_MET: the roster place would be refused');
SELECT t.reset();
UPDATE public.child_controls SET game_participation = false WHERE child_user_id = t.id('teen');
SELECT t.as_service();
SELECT t.throws(pg_temp.seat_stmt('teen', 'g-closed'), 'CHILD_GAME_PARTICIPATION_BLOCKED',
  'GAME_PARTICIPATION_BLOCKED: the roster place would be refused');
SELECT t.reset();
UPDATE public.child_controls SET game_participation = true WHERE child_user_id = t.id('teen');
-- AGE_VERIFICATION_REQUIRED: the player could not take the place themselves; the service role's write would skip it.
SELECT t.as_user(t.id('nodob'));
SELECT t.throws(pg_temp.seat_stmt('nodob', 'g-open'), 'AGE_VERIFICATION_REQUIRED',
  'AGE_VERIFICATION_REQUIRED: the player joining themselves is refused');
SELECT t.reset();
-- And where the answer is NULL, both writes go through.
SELECT t.eq(pg_temp.code('other', 'g-open'), NULL::text, 'setup: other may pay for the open game');
SELECT t.as_service();
SELECT t.lives(pg_temp.pay_stmt('other', 'g-open'), 'NULL: the payment is recorded');
SELECT t.lives(pg_temp.seat_stmt('other', 'g-open'), 'NULL: and the place is given');
SELECT t.reset();

-- ---- 6. the triggers are unchanged -----------------------------------------------------------------------------
-- The migration defines two new functions and widens one CHECK; it replaces no trigger function. These are the
-- definitions paypal_payment_block was checked against. It repeats parts of them, so if one of these is changed on
-- purpose, change paypal_payment_block to match and then add the new hash here. Two have a second known definition,
-- from 20261111120000 (minor-safety gates, #405), which may be applied before or after this migration: it refuses a
-- player or payee with no date of birth, which paypal_payment_block already answers (AGE_VERIFICATION_REQUIRED,
-- PAYMENT_DESTINATION_INVALID). enforce_child_game_participation has a third, from 20261111160000 (guarded minors on
-- open games, #71): a minor with a guardian needs a valid guardian approval for a place in any game, which for a paid
-- game paypal_payment_block already asks (GUARDIAN_APPROVAL_REQUIRED, through game_payment_guardian_ready).
SELECT t.ok(md5(pg_get_functiondef(p.oid)) = ANY (w.hashes), 'unchanged: ' || w.fn)
  FROM (VALUES ('enforce_approval_before_payment',  ARRAY['3ffff8c3b95ae10ce43cdc4197cc886a']),
               ('enforce_game_payment_cohort',      ARRAY['aadeafedb16085a27b6e67f46fc4abfa', '1dc979d906a05301645d9a67f42262c5']),
               ('enforce_payment_destination',      ARRAY['9966e4bbbab1c529c669a5f0d0b4a6f8']),
               ('enforce_guardian_before_payment',  ARRAY['e75b6f828c5626f77418f279a2abcdc0']),
               ('payment_submissions_state_guard',  ARRAY['16e42f30df68ac4be5298e1370883c72']),
               ('enforce_game_join_gate',           ARRAY['9d4924a2d53915fca8fa245e15281a25']),
               ('enforce_game_age_requirement',     ARRAY['a978b62c4004040d8388fe5a87803788']),
               ('enforce_child_game_participation', ARRAY['81eec75a132cc28db4fc4926980e283b', '918954dc17f017a0133454fddecea1c4',
                                                    '98f6998a6034f5b0263b0793648d8ef7']),
               ('enforce_host_block',               ARRAY['6b1d17279ccbb3238ceecd2bde49ba2d'])) AS w(fn, hashes)
  JOIN pg_proc p ON p.proname = w.fn AND p.pronamespace = 'public'::regnamespace
 ORDER BY w.fn;
-- And they behave as before for a manual payment claim (a signed-in player writing a pending claim).
CREATE FUNCTION pg_temp.claim_stmt(_who text, _game text) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.payment_submissions (game_id, host_id, player_id) VALUES (%L, %L, %L)',
                _game, t.id('host'), t.id(_who))
$$;
GRANT EXECUTE ON FUNCTION pg_temp.claim_stmt(text, text) TO authenticated;
SELECT t.as_user(t.id('pb'));
SELECT t.lives(pg_temp.claim_stmt('pb', 'g-noset'),
  'a manual claim on a game with no settings row still needs no approval (PayPal is stricter: section 3)');
SELECT t.throws(pg_temp.claim_stmt('pb', 'g-appr'), 'Host approval required',
  'a manual claim on an approval game still needs it');
SELECT t.reset();

-- ---- 7. the order statuses capture uses -------------------------------------------------------------------------
INSERT INTO public.paypal_orders (order_id, game_id, player_id, host_id, amount_cents, status)
VALUES ('O-1', 'g-open', t.id('pa'), t.id('host'), 1000, 'created');
SELECT t.lives(format('UPDATE public.paypal_orders SET status = %L WHERE order_id = ''O-1''', s), 'status allowed: ' || s)
  FROM unnest(ARRAY['capturing', 'captured', 'refunded_unrecorded', 'captured_unrecorded']) s;
SELECT t.throws($q$UPDATE public.paypal_orders SET status = 'paid' WHERE order_id = 'O-1'$q$, 'paypal_orders_status_check',
  'any other status is still refused');
SELECT t.as_user(t.id('pa'));
SELECT t.eq(t.changed($q$UPDATE public.paypal_orders SET status = 'captured' WHERE order_id = 'O-1'$q$), 0,
  'a player still cannot change their own order');
SELECT t.reset();

-- ---- 8. money already moving for this game (review: charged twice) -----------------------------------------------
-- The capture holds its own order in 'capturing' and only then asks, so an order in 'capturing' with no capture yet
-- is not counted (the index below keeps a second one out). Money that moved and is not recorded is.
DELETE FROM public.paypal_orders;
SELECT t.eq(pg_temp.code('pa', 'g-open'), NULL::text, 'setup: pa may pay for the open game');
INSERT INTO public.paypal_orders (order_id, game_id, player_id, host_id, amount_cents, status)
VALUES ('O-2', 'g-open', t.id('pa'), t.id('host'), 1000, 'capturing');
SELECT t.eq(pg_temp.code('pa', 'g-open'), NULL::text,
  'an order held for its own capture, nothing captured yet: the capture''s own check still passes');
UPDATE public.paypal_orders SET capture_id = 'CAP-2' WHERE order_id = 'O-2';
SELECT t.eq(pg_temp.code('pa', 'g-open'), 'PAYMENT_IN_PROGRESS', 'captured, still being recorded (or PayPal pending)');
UPDATE public.paypal_orders SET status = 'captured' WHERE order_id = 'O-2';
SELECT t.eq(pg_temp.code('pa', 'g-open'), 'PAYMENT_IN_PROGRESS', 'captured with no payment record');
UPDATE public.paypal_orders SET status = 'captured_unrecorded' WHERE order_id = 'O-2';
SELECT t.eq(pg_temp.code('pa', 'g-open'), 'PAYMENT_IN_PROGRESS', 'captured, unrecorded, and the refund failed');
SELECT t.eq(pg_temp.code('pb', 'g-open'), 'ALREADY_PAID', 'another player''s order says nothing about them');
SELECT t.eq(pg_temp.code('pa', 'g-closed'), NULL::text, 'and it counts only for its own game');
UPDATE public.paypal_orders SET status = 'refunded_unrecorded' WHERE order_id = 'O-2';
SELECT t.eq(pg_temp.code('pa', 'g-open'), NULL::text, 'refunded: may pay again');
UPDATE public.paypal_orders SET status = 'captured' WHERE order_id = 'O-2';
INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type, transaction_reference, paid_amount,
                                        paid_at, notes, status, reviewed_at)
VALUES ('g-open', t.id('host'), t.id('pa'), 'paypal', 'CAP-2', 10, now(), 'Paid with PayPal checkout', 'cancelled',
        now());
SELECT t.eq(pg_temp.code('pa', 'g-open'), NULL::text,
  'captured and recorded, the record no longer verified (cancelled): as for any other payment');
INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type, transaction_reference, paid_amount,
                                        paid_at, notes, status, reviewed_at)
VALUES ('g-open', t.id('host'), t.id('pa'), 'paypal', 'CAP-2', 10, now(), 'Paid with PayPal checkout', 'verified',
        now());
SELECT t.eq(pg_temp.code('pa', 'g-open'), 'ALREADY_PAID', 'captured and recorded as verified');

-- One order per player and game can be mid-capture: a second claim fails, so the server refuses the second capture.
INSERT INTO public.paypal_orders (order_id, game_id, player_id, host_id, amount_cents, status)
VALUES ('O-3', 'g-open', t.id('pa'), t.id('host'), 1000, 'capturing'),
       ('O-4', 'g-open', t.id('pa'), t.id('host'), 1000, 'created'),
       ('O-5', 'g-open', t.id('pb'), t.id('host'), 1000, 'capturing'),
       ('O-6', 'g-closed', t.id('pa'), t.id('host'), 1000, 'capturing');
SELECT t.throws($q$UPDATE public.paypal_orders SET status = 'capturing' WHERE order_id = 'O-4'$q$,
  'paypal_orders_one_capture_per_player_game', 'a second order for the same player and game cannot be claimed');
UPDATE public.paypal_orders SET status = 'captured' WHERE order_id = 'O-3';
SELECT t.lives($q$UPDATE public.paypal_orders SET status = 'capturing' WHERE order_id = 'O-4'$q$,
  'once the first is no longer capturing, the next can be claimed');

ROLLBACK;
