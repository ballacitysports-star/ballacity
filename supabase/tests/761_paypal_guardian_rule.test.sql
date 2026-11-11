-- Audit F03 follow-up: PayPal checkout follows the guardian rule.
--
-- The server records a PayPal payment with the service role, which the payment trigger lets through (by then the money
-- has moved). So before any money moves, the server asks public.game_payment_guardian_ready as the player. It must give
-- exactly the payment trigger's answer: true when no guardian approval is needed or a valid one is on an open request
-- for the game, and false otherwise.
--
-- teen (16) has a guardian, ga. solo (17) has none. adult (28).
BEGIN;

SELECT t.person('host', 40), t.person('ga', 41), t.person('teen', 16), t.person('solo', 17), t.person('adult', 28);
SELECT t.guardian('ga', 'teen');

INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('pp', t.id('host'), 'PayPal run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10),
       ('pp2', t.id('host'), 'PayPal run 2', 'Basketball', now() + interval '4 days', 'Gym', 10, 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('pp', t.id('host'), 10, false), ('pp2', t.id('host'), 10, false);

CREATE TEMP TABLE ready_q AS
SELECT 'SELECT public.game_payment_guardian_ready(''pp'') AS ok' AS sql;
GRANT SELECT ON ready_q TO authenticated, anon;
CREATE TEMP TABLE pay_stmt AS
SELECT format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'pp', %L)$q$,
              t.id('teen'), t.id('host')) AS sql;
GRANT SELECT ON pay_stmt TO authenticated;

-- ---- 1. who may call it -----------------------------------------------------------------------------------------
SELECT t.ok(has_function_privilege('authenticated', 'public.game_payment_guardian_ready(text)', 'EXECUTE'),
  'a signed-in player can ask');
SELECT t.ok(NOT has_function_privilege('anon', 'public.game_payment_guardian_ready(text)', 'EXECUTE'),
  'a signed-out visitor cannot');
SELECT t.ok(NOT has_function_privilege('authenticated', 'private_sec.guardian_payment_approval_missing(uuid, text)',
                                       'EXECUTE'),
  'the rule itself is not callable through the API');
SELECT t.eq(public.game_payment_guardian_ready('pp'), false, 'with nobody signed in it is never true');

-- ---- 2. a child with a guardian: true only with a valid approval on an open request -----------------------------
SELECT t.as_user(t.id('teen'));
SELECT t.eq(public.game_payment_guardian_ready('pp'), false, 'no request yet: the child may not pay');
SELECT t.lives(format($q$INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
                        VALUES (%L, 'pp', %L, %L, 'k-pp')$q$, t.id('req'), t.id('teen'), t.id('host')),
  'the child asks to join');
SELECT t.eq(public.game_payment_guardian_ready('pp'), false, 'a request waiting on the guardian: still no');
SELECT t.throws((SELECT sql FROM pay_stmt), 'GUARDIAN_APPROVAL_REQUIRED',
  'and the payment trigger agrees: the child cannot record a payment');

SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req')), 'ga approves');
SELECT t.as_user(t.id('teen'));
SELECT t.eq(public.game_payment_guardian_ready('pp'), true, 'with the approval the child may pay');
SELECT t.eq(public.game_payment_guardian_ready('pp2'), false, 'an approval counts only for its own game');
SELECT t.lives((SELECT sql FROM pay_stmt), 'and the payment trigger agrees');
SELECT t.reset();
DELETE FROM public.payment_submissions WHERE game_id = 'pp';

-- The host turns the request down: the stamp stays, but the request is no longer open.
SELECT t.as_user(t.id('host'));
SELECT t.lives(format($q$UPDATE public.join_requests SET status = 'rejected', reviewed_at = now() WHERE id = %L$q$,
                      t.id('req')), 'the host says no');
SELECT t.as_user(t.id('teen'));
SELECT t.eq(public.game_payment_guardian_ready('pp'), false, 'a rejected request: the child may not pay');
SELECT t.throws((SELECT sql FROM pay_stmt), 'GUARDIAN_APPROVAL_REQUIRED', 'and the payment trigger agrees');
SELECT t.reset();

-- The child asks again: the old answer does not carry over (20261110120000, row 8).
UPDATE public.join_requests SET last_rejected_at = now() - interval '1 hour' WHERE id = t.id('req');
SELECT t.as_user(t.id('teen'));
SELECT t.lives(format($q$UPDATE public.join_requests SET status = 'pending' WHERE id = %L AND status = 'rejected'$q$,
                      t.id('req')), 'the child asks again');
SELECT t.eq(public.game_payment_guardian_ready('pp'), false, 'a new ask needs a fresh guardian answer first');

SELECT t.as_user(t.id('ga'));
SELECT t.lives(format('SELECT public.guardian_approve_join_request(%L, true)', t.id('req')), 'ga approves again');
SELECT t.as_user(t.id('teen'));
SELECT t.eq(public.game_payment_guardian_ready('pp'), true, 'the fresh approval counts');
SELECT t.reset();

-- The guardian loses authority: their approval stops counting.
UPDATE public.profiles SET suspended_at = now() WHERE id = t.id('ga');
SELECT t.as_user(t.id('teen'));
SELECT t.eq(public.game_payment_guardian_ready('pp'), false, 'ga suspended: the child may not pay');
SELECT t.throws((SELECT sql FROM pay_stmt), 'GUARDIAN_APPROVAL_REQUIRED', 'and the payment trigger agrees');
SELECT t.reset();
UPDATE public.profiles SET suspended_at = NULL WHERE id = t.id('ga');
SELECT t.as_user(t.id('teen'));
SELECT t.eq(public.game_payment_guardian_ready('pp'), false, 'lifting the suspension does not bring the approval back');
SELECT t.reset();

-- ---- 3. nobody else is affected ------------------------------------------------------------------------------
SELECT t.as_user(t.id('solo'));
SELECT t.eq(public.game_payment_guardian_ready('pp'), true, 'a 17-year-old with no guardian link may pay, as before');
SELECT t.as_user(t.id('adult'));
SELECT t.eq(public.game_payment_guardian_ready('pp'), true, 'an adult may pay, as before');
SELECT t.as_anon();
SELECT t.throws((SELECT sql FROM ready_q), 'permission denied', 'a signed-out visitor is refused');
SELECT t.reset();

-- ---- 4. the server's own write is still recorded ------------------------------------------------------------------
-- By the time the server writes a PayPal payment the money has moved, so the trigger lets it through. The server's
-- check before the order and before the capture is what keeps an unapproved child from getting this far.
SELECT t.as_service();
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (game_id, host_id, player_id, payment_type,
                                                                  transaction_reference, paid_amount, paid_at, notes,
                                                                  status, reviewed_at)
                        VALUES ('pp2', %L, %L, 'paypal', 'CAPTURE-1', 10, now(), 'Paid with PayPal checkout',
                                'verified', now())$q$, t.id('host'), t.id('teen')),
  'a payment the server recorded after a capture is kept');
SELECT t.reset();

ROLLBACK;
