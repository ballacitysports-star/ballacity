-- Payment settings and the payment destination belong to the game's host (and nobody else).
BEGIN;
SELECT t.person('host', 35), t.person('player', 29), t.person('stranger', 41), t.person('otherhost', 36), t.person('accomplice', 33);
INSERT INTO public.hosted_games (id, host_id, sport, title, date, price) VALUES
  ('g-pay', t.id('host'), 'basketball', 'Paid run', now()+interval '3 days', 10),
  ('g-other', t.id('otherhost'), 'basketball', 'Other run', now()+interval '3 days', 0);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('g-pay', t.id('host'), 10, true);
INSERT INTO public.host_payment_methods (host_id, payment_type, username) VALUES (t.id('host'), 'venmo', 'host-handle'), (t.id('stranger'), 'venmo', 'stranger-handle');

-- ---- writes
SELECT t.as_user(t.id('stranger'));
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('g-pay', %L, 0, false)$q$, t.id('stranger')),
  'row-level security', 'a stranger cannot create payment settings for another host''s game');
SELECT t.reset();
SELECT t.as_user(t.id('otherhost'));
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('g-pay', %L, 0)$q$, t.id('otherhost')),
  'row-level security', 'a different host cannot either');
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('g-other', %L, 5)$q$, t.id('otherhost')), 'a host can write settings for their own game');
SELECT t.throws($q$UPDATE public.game_payment_settings SET game_id = 'g-pay' WHERE game_id = 'g-other'$q$, 'row-level security', 'a host cannot re-point their settings row at another host''s game');
SELECT t.reset();
SELECT t.as_user(t.id('host'));
SELECT t.lives($q$UPDATE public.game_payment_settings SET entry_fee = 12 WHERE game_id = 'g-pay'$q$, 'the host can edit their settings');
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('g-pay', %L, 12, true) ON CONFLICT (game_id, host_id) DO UPDATE SET entry_fee = EXCLUDED.entry_fee$q$, t.id('host')), 'and upsert it (what the app does)');
SELECT t.reset();
SELECT t.as_anon();
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('g-pay', %L, 0)$q$, t.id('stranger')), 'permission denied', 'anonymous visitors cannot write settings');
SELECT t.reset();

-- ---- a row that already exists for someone else's game (written before the fix) is never believed
UPDATE public.game_payment_settings SET refund_policy = 'host-policy' WHERE game_id = 'g-pay' AND host_id = t.id('host');
SET LOCAL session_replication_role = replica;
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval, refund_policy, created_at)
  VALUES ('g-pay', t.id('stranger'), 0, false, 'stranger-policy', now() + interval '1 hour');
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status, reviewed_at) VALUES ('g-pay', t.id('player'), t.id('host'), 'k1', 'approved', now());
SET LOCAL session_replication_role = origin;

SELECT t.as_user(t.id('player'));
SELECT t.eq((SELECT host_id FROM public.game_payment_settings WHERE game_id = 'g-pay' ORDER BY created_at DESC LIMIT 1), t.id('host'), 'a linked player''s "latest row" is the host''s, not the stranger''s newer one');
SELECT t.eq((SELECT count(*)::int FROM public.game_payment_settings WHERE game_id = 'g-pay'), 1, 'and the stranger''s row is not visible at all');
SELECT t.eq((SELECT count(*)::int FROM public.get_game_host_payment_methods(t.id('host'), 'g-pay')), 1, 'the host''s payment methods are returned for the game');
SELECT t.eq((SELECT count(*)::int FROM public.get_game_host_payment_methods(t.id('stranger'), 'g-pay')), 0, 'the stranger''s are not, even though a settings row names them');
SELECT t.eq((SELECT refund_policy FROM public.get_game_refund_terms('g-pay')), 'host-policy', 'refund terms come from the host''s row');
-- the payment destination (SEC-8: the database names the payee; the host_id the client sends is ignored)
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (id, player_id, game_id, host_id) VALUES (%L, %L, 'g-pay', %L)$q$, t.id('ps-s'), t.id('player'), t.id('stranger')),
  'a payment naming the stranger is accepted');
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (id, player_id, game_id, host_id) VALUES (%L, %L, 'g-pay', %L)$q$, t.id('ps-a'), t.id('player'), t.id('accomplice')),
  'as is one naming any other account');
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (id, player_id, game_id, host_id) VALUES (%L, %L, 'g-pay', %L)$q$, t.id('ps-h'), t.id('player'), t.id('host')),
  'and one naming the host');
SELECT t.reset();
SELECT t.eq((SELECT count(*)::int FROM public.payment_submissions WHERE id IN (t.id('ps-s'), t.id('ps-a'), t.id('ps-h')) AND host_id = t.id('host')), 3,
  'but every one of them is made out to the host, never to the stranger or anyone else');
-- the join gate does not believe the stranger's "no approval, no fee" row
SELECT t.as_user(t.id('accomplice'));
SELECT t.throws(format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('g-pay', %L)$q$, t.id('accomplice')),
  'GAME_APPROVAL_REQUIRED', 'the join gate still requires the host''s approval');
-- SEC-5 (20261108110000): the database names the host from the game, so a wrong host_id is corrected rather than refused (a refusal
-- told the caller whether an account hosts the game).
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key) VALUES ('g-pay', %L, %L, 'k9')$q$, t.id('accomplice'), t.id('stranger')),
  'a join request naming the stranger as the host is accepted...');
SELECT t.reset();
SELECT t.eq((SELECT host_id FROM public.join_requests WHERE game_id = 'g-pay' AND player_id = t.id('accomplice')), t.id('host'),
  '...but it is stored against the real host: a join request cannot name the stranger as the host');
-- the stranger cannot touch the submission they were never the payee of
SELECT t.as_user(t.id('stranger'));
SELECT t.eq(t.count($q$SELECT 1 FROM public.payment_submissions$q$), 0, 'the stranger sees no submissions');
SELECT t.reset();
-- the existing data is preserved (the ignored row is still there for review)
SELECT t.eq((SELECT count(*)::int FROM public.game_payment_settings WHERE game_id = 'g-pay'), 2, 'the earlier row was not deleted');
ROLLBACK;
