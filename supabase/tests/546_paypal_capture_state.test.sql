-- F04: a PayPal checkout payment is verified only from a capture PayPal reports as COMPLETED, once per capture/order,
-- and only BallaCity (not an API caller) records checkout payments. Manual PayPal proofs are unaffected.
BEGIN;
SELECT t.person('host', 35), t.person('payer', 30), t.person('other', 31);
INSERT INTO public.hosted_games (id, host_id, sport, title, date) VALUES ('pp-g', t.id('host'), 'basketball', 'Paid run', now() + interval '2 days');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('pp-g', t.id('host'), 10);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'game_payment_settings' AND column_name = 'requires_approval') THEN
    EXECUTE 'UPDATE public.game_payment_settings SET requires_approval = false WHERE game_id = ''pp-g''';
  END IF;
END $$;
INSERT INTO public.paypal_orders (order_id, game_id, player_id, host_id, amount_cents, currency, status)
VALUES ('ORD-1', 'pp-g', t.id('payer'), t.id('host'), 1000, 'USD', 'capturing'),
       ('ORD-2', 'pp-g', t.id('other'), t.id('host'), 1000, 'USD', 'capturing');

-- the order says the capture is PENDING (the audit case: order COMPLETED, capture PENDING)
UPDATE public.paypal_orders SET capture_id = 'CAP-1', capture_status = 'PENDING', capture_amount_cents = 1000, capture_currency = 'USD',
       paypal_order_status = 'COMPLETED', status = 'capture_pending' WHERE order_id = 'ORD-1';
SELECT t.as_service();
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, transaction_reference, paid_amount, status, paypal_order_id)
                          VALUES (%L, 'pp-g', %L, 'paypal', 'CAP-1', 10, 'verified', 'ORD-1')$q$, t.id('payer'), t.id('host')),
  'PAYPAL_CAPTURE_NOT_COMPLETED', 'F04: a pending capture cannot become a verified payment, even from the server');
SELECT t.reset();
SELECT t.throws($q$UPDATE public.paypal_orders SET status = 'captured' WHERE order_id = 'ORD-1'$q$,
  'paypal_orders_captured_is_completed', 'F04: an order cannot be marked captured while its capture is pending');

-- settled: COMPLETED
UPDATE public.paypal_orders SET capture_status = 'COMPLETED', capture_payee_merchant_id = 'MERCHANT-1', status = 'capturing' WHERE order_id = 'ORD-1';
SELECT t.as_service();
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, transaction_reference, paid_amount, status, paypal_order_id)
                          VALUES (%L, 'pp-g', %L, 'paypal', 'CAP-OTHER', 10, 'verified', 'ORD-1')$q$, t.id('payer'), t.id('host')),
  'PAYPAL_CAPTURE_NOT_COMPLETED', 'F04: the payment must name the order''s capture');
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, transaction_reference, paid_amount, status, paypal_order_id)
                          VALUES (%L, 'pp-g', %L, 'paypal', 'CAP-1', 9.99, 'verified', 'ORD-1')$q$, t.id('payer'), t.id('host')),
  'PAYPAL_CAPTURE_NOT_COMPLETED', 'F04: and the captured amount');
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, transaction_reference, paid_amount, status, paypal_order_id)
                          VALUES (%L, 'pp-g', %L, 'paypal', 'CAP-1', 10, 'verified', 'ORD-1')$q$, t.id('other'), t.id('host')),
  'PAYPAL_CAPTURE_NOT_COMPLETED', 'F04: and the player who paid');
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (id, player_id, game_id, host_id, payment_type, transaction_reference, paid_amount, status, paypal_order_id)
                         VALUES (%L, %L, 'pp-g', %L, 'paypal', 'CAP-1', 10, 'verified', 'ORD-1')$q$, t.id('sub1'), t.id('payer'), t.id('host')),
  'F04: a COMPLETED, matching capture is recorded as a verified payment');
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, transaction_reference, paid_amount, status, paypal_order_id)
                          VALUES (%L, 'pp-g', %L, 'paypal', 'CAP-1', 10, 'verified', 'ORD-1')$q$, t.id('payer'), t.id('host')),
  'duplicate key', 'F04: a duplicate callback or retry cannot record the same capture twice');
SELECT t.reset();
SELECT t.lives($q$UPDATE public.paypal_orders SET status = 'captured' WHERE order_id = 'ORD-1'$q$, 'F04: and the order is captured');
SELECT t.throws($q$UPDATE public.paypal_orders SET capture_id = 'CAP-1', capture_status = 'COMPLETED' WHERE order_id = 'ORD-2'$q$,
  'paypal_orders_capture_id_key', 'F04: one capture belongs to one order');

-- API callers never record or relabel checkout payments
SELECT t.as_user(t.id('payer'));
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, transaction_reference, paypal_order_id)
                          VALUES (%L, 'pp-g', %L, 'paypal', 'CAP-X', 'ORD-2')$q$, t.id('payer'), t.id('host')),
  'PAYMENT_FIELD_FORBIDDEN', 'F04: a player cannot mark a claim as a PayPal checkout payment');
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (id, player_id, game_id, host_id, payment_type, transaction_reference)
                         VALUES (%L, %L, 'pp-g', %L, 'paypal', 'manual-ref')$q$, t.id('manual'), t.id('payer'), t.id('host')),
  'F04: a manual PayPal proof (no checkout order) still works');
SELECT t.throws(format($q$UPDATE public.payment_submissions SET paypal_order_id = 'ORD-2' WHERE id = %L$q$, t.id('manual')),
  'PAYMENT_FIELD_FORBIDDEN', 'F04: nor relabel one afterwards');
SELECT t.reset();
-- independent pre-review (2026-11-05): the order itself must be in a successful capture, with a payee on record
INSERT INTO public.paypal_orders (order_id, game_id, player_id, host_id, amount_cents, currency, status, capture_id, capture_status,
                                  capture_amount_cents, capture_currency, capture_payee_merchant_id, paypal_order_status)
VALUES ('ORD-R', 'pp-g', t.id('other'), t.id('host'), 1000, 'USD', 'refunded', 'CAP-R', 'COMPLETED', 1000, 'USD', 'WRONG-MERCHANT', 'COMPLETED'),
       ('ORD-N', 'pp-g', t.id('other'), t.id('host'), 1000, 'USD', 'capturing', 'CAP-N', 'COMPLETED', 1000, 'USD', NULL, 'COMPLETED');
SELECT t.as_service();
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, transaction_reference, paid_amount, status, paypal_order_id)
                          VALUES (%L, 'pp-g', %L, 'paypal', 'CAP-R', 10, 'verified', 'ORD-R')$q$, t.id('other'), t.id('host')),
  'PAYPAL_CAPTURE_NOT_COMPLETED', 'pre-review F04: a refunded order (wrong payee) never verifies a payment, even from the server');
SELECT t.reset();
-- (a refunded order is final, so the failed case is its own order)
INSERT INTO public.paypal_orders (order_id, game_id, player_id, host_id, amount_cents, currency, status, capture_id, capture_status,
                                  capture_amount_cents, capture_currency, capture_payee_merchant_id, paypal_order_status)
VALUES ('ORD-F', 'pp-g', t.id('other'), t.id('host'), 1000, 'USD', 'failed', 'CAP-F', 'COMPLETED', 1000, 'USD', 'MERCHANT-1', 'COMPLETED');
SELECT t.as_service();
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, transaction_reference, paid_amount, status, paypal_order_id)
                          VALUES (%L, 'pp-g', %L, 'paypal', 'CAP-F', 10, 'verified', 'ORD-F')$q$, t.id('other'), t.id('host')),
  'PAYPAL_CAPTURE_NOT_COMPLETED', 'pre-review F04: nor a failed one');
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, transaction_reference, paid_amount, status, paypal_order_id)
                          VALUES (%L, 'pp-g', %L, 'paypal', 'CAP-N', 10, 'verified', 'ORD-N')$q$, t.id('other'), t.id('host')),
  'PAYPAL_CAPTURE_NOT_COMPLETED', 'pre-review F04: nor a capture with no payee on record');
-- bookkeeping on an already verified payment is not held to the order's later status
SELECT t.lives(format('UPDATE public.payment_submissions SET notes = %L WHERE id = %L', 'checked', t.id('sub1')),
  'pre-review F04: a verified payment can still be annotated');
SELECT t.reset();

-- independent review of d604958c: a delayed PENDING from a superseded settlement never overwrites a completed order
-- (ORD-1 is captured, with a verified payment)
SELECT t.as_service();
SELECT t.throws($q$UPDATE public.paypal_orders SET status = 'capture_pending', capture_status = 'PENDING' WHERE order_id = 'ORD-1'$q$,
  'PAYPAL_ORDER_SETTLED', 'F04 race: a late PENDING cannot move a captured order back to pending');
SELECT t.throws($q$UPDATE public.paypal_orders SET status = 'failed' WHERE order_id = 'ORD-1'$q$,
  'PAYPAL_ORDER_SETTLED', 'F04 race: nor fail it');
SELECT t.throws($q$UPDATE public.paypal_orders SET capture_status = 'PENDING' WHERE order_id = 'ORD-1'$q$,
  'PAYPAL_ORDER_SETTLED', 'F04 race: nor rewrite its capture');
SELECT t.eq((SELECT status FROM public.paypal_orders WHERE order_id = 'ORD-1'), 'captured', 'F04 race: the order stays captured');
-- the claim: each claimant writes a fresh token, and writes its outcome only while it still holds it
INSERT INTO public.paypal_orders (order_id, game_id, player_id, host_id, amount_cents, currency, status, capture_claim, capture_claimed_at)
VALUES ('ORD-C', 'pp-g', t.id('other'), t.id('host'), 1000, 'USD', 'capturing', '00000000-0000-0000-0000-00000000c0c0', now() - interval '1 hour');
UPDATE public.paypal_orders SET capture_claim = '00000000-0000-0000-0000-00000000aaaa', capture_claimed_at = now()
 WHERE order_id = 'ORD-C' AND status = 'capturing' AND capture_claim = '00000000-0000-0000-0000-00000000c0c0';
UPDATE public.paypal_orders SET capture_claim = '00000000-0000-0000-0000-00000000bbbb', capture_claimed_at = now()
 WHERE order_id = 'ORD-C' AND status = 'capturing' AND capture_claim = '00000000-0000-0000-0000-00000000c0c0';
SELECT t.eq((SELECT capture_claim::text FROM public.paypal_orders WHERE order_id = 'ORD-C'), '00000000-0000-0000-0000-00000000aaaa',
  'F04 race: of two settlements that read the same claim, only the first takes the order');
UPDATE public.paypal_orders SET status = 'capture_pending', capture_status = 'PENDING'
 WHERE order_id = 'ORD-C' AND status = 'capturing' AND capture_claim = '00000000-0000-0000-0000-00000000c0c0';
SELECT t.eq((SELECT status FROM public.paypal_orders WHERE order_id = 'ORD-C'), 'capturing',
  'F04 race: the superseded caller''s outcome write changes nothing');
SELECT t.lives($q$UPDATE public.paypal_orders SET status = 'refunded' WHERE order_id = 'ORD-1'$q$,
  'F04 race: a captured order can still be refunded');
SELECT t.reset();

-- independent review of 8b8cc27b: a refund is final, and a settled order keeps who paid, for what and how much
SELECT t.throws($q$UPDATE public.paypal_orders SET status = 'captured' WHERE order_id = 'ORD-1'$q$,
  'PAYPAL_ORDER_SETTLED', 'F04: a refunded order cannot be marked captured again');
SELECT t.throws($q$UPDATE public.paypal_orders SET amount_cents = 1 WHERE order_id = 'ORD-1'$q$,
  'PAYPAL_ORDER_SETTLED', 'F04: a settled order keeps its amount');
SELECT t.throws(format($q$UPDATE public.paypal_orders SET player_id = %L WHERE order_id = 'ORD-1'$q$, t.id('other')),
  'PAYPAL_ORDER_SETTLED', 'F04: and its player');
SELECT t.lives($q$UPDATE public.paypal_orders SET status = 'refunded' WHERE order_id = 'ORD-1'$q$,
  'F04: writing the same refunded status again is harmless');
-- an order still 'capturing' whose payment is already recorded (between the insert and the captured write)
SELECT t.person('third', 33);
INSERT INTO public.paypal_orders (order_id, game_id, player_id, host_id, amount_cents, currency, status,
                                  capture_id, capture_status, capture_amount_cents, capture_currency, capture_payee_merchant_id)
VALUES ('ORD-V', 'pp-g', t.id('third'), t.id('host'), 1000, 'USD', 'capturing', 'CAP-V', 'COMPLETED', 1000, 'USD', 'MERCHANT-1');
SELECT t.as_service();
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id, payment_type, transaction_reference, paid_amount, status, paypal_order_id)
                         VALUES (%L, 'pp-g', %L, 'paypal', 'CAP-V', 10, 'verified', 'ORD-V')$q$, t.id('third'), t.id('host')),
  'F04: the capture is recorded as a verified payment');
SELECT t.throws($q$UPDATE public.paypal_orders SET status = 'failed' WHERE order_id = 'ORD-V'$q$,
  'PAYPAL_ORDER_SETTLED', 'F04: an order with a verified payment cannot then be failed');
SELECT t.throws($q$UPDATE public.paypal_orders SET status = 'capture_pending' WHERE order_id = 'ORD-V'$q$,
  'PAYPAL_ORDER_SETTLED', 'F04: or parked as pending');
SELECT t.lives($q$UPDATE public.paypal_orders SET status = 'captured' WHERE order_id = 'ORD-V'$q$,
  'F04: it becomes captured');
SELECT t.reset();
ROLLBACK;
