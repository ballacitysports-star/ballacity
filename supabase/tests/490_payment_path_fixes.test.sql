-- PAY-1: payee notifications, refunds to the payee, free minor-hosted settings, submissions follow the current payee, payment handles need a reason.
BEGIN;
SELECT t.person('adult', 35), t.person('payer', 29), t.person('teenhost', 17), t.person('guardian', 40), t.person('stranger', 44),
       t.person('kid', 15), t.person('gk', 41), t.person('loner', 16);
SELECT t.guardian('guardian', 'teenhost'), t.guardian('gk', 'kid');
UPDATE public.privacy_preferences SET profile_visibility = 'private' WHERE user_id = t.id('teenhost');

-- a paid game hosted by a minor, with the guardian as payment manager
SELECT t.as_user(t.id('guardian'));
SELECT set_config('t.pay', public.grant_minor_hosting_approval(t.id('teenhost'), 168, true)::text, false);
SELECT t.as_user(t.id('teenhost'));
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, price, min_age, max_age, hosting_approval_id) VALUES ('p-ok', %L, 'basketball', 'paid youth run', now()+interval '3 days', 10, 13, 17, %L)$q$, t.id('teenhost'), current_setting('t.pay')::uuid), 'setup: a paid minor-hosted game with a guardian payment manager');
SELECT t.reset();
SELECT t.eq(private_sec.game_payee('p-ok'), t.id('guardian'), 'the payee is the guardian');
-- SEC-8: only a payment made after an approved request (or a verified one) is a payment relation.
SET LOCAL session_replication_role = replica;
INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key, status, reviewed_at) VALUES ('p-ok', t.id('payer'), t.id('teenhost'), 'kpayer', 'approved', now() - interval '1 minute');
SET LOCAL session_replication_role = origin;
INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (t.id('payer'), 'p-ok', t.id('guardian'));

-- 1. a payer can notify the adult who holds their payment; the relation is one-way and needs an actual payment
SELECT t.ok(public.can_notify(t.id('payer'), t.id('guardian')), 'the payer can notify the payment manager');
SELECT t.ok(NOT public.can_notify(t.id('guardian'), t.id('payer')), 'the relation is one-way: the payment manager gains no channel to the payer');
SELECT t.ok(NOT public.can_notify(t.id('stranger'), t.id('guardian')), 'a stranger cannot');
-- review round 4: a join request is not a payment relation, and never opens a channel from an unrelated adult payee to a minor
UPDATE public.child_controls SET messaging = 'guardian_only' WHERE child_user_id = t.id('kid');
SELECT t.as_user(t.id('kid'));
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key) VALUES ('p-ok', %L, %L, 'k1')$q$, t.id('teenhost'), t.id('kid')), 'setup: a guardian-controlled teen asks to join');
SELECT t.as_user(t.id('loner'));
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key) VALUES ('p-ok', %L, %L, 'l1')$q$, t.id('teenhost'), t.id('loner')), 'setup: an unlinked teen asks to join');
SELECT t.reset();
SELECT t.ok(NOT public.can_notify(t.id('guardian'), t.id('kid')), 'the payee (another family''s guardian) cannot notify a requesting teen whose guardian allows only guardian messages');
SELECT t.ok(NOT public.can_notify(t.id('guardian'), t.id('loner')), 'nor an unlinked teen (no unsolicited adult messages)');

-- 4. submissions follow the current payee
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.count($$SELECT 1 FROM public.payment_submissions WHERE game_id = 'p-ok'$$), 1, 'the payee reads the submission');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'revoked' WHERE child_user_id = t.id('teenhost');
SELECT t.eq(private_sec.game_payee('p-ok'), NULL::uuid, 'after the guardian link is revoked there is no payee');
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.count($$SELECT 1 FROM public.payment_submissions WHERE game_id = 'p-ok'$$), 0, 'the former payee no longer reads the submission');
SELECT t.eq(t.changed($$UPDATE public.payment_submissions SET status = 'verified' WHERE game_id = 'p-ok'$$), 0, 'nor can verify it');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'active' WHERE child_user_id = t.id('teenhost');

-- 2. refunds owed are announced to the adult who received the money, even after the guardian link is revoked
SET LOCAL session_replication_role = replica;
UPDATE public.payment_submissions SET status = 'verified', paid_amount = 10 WHERE game_id = 'p-ok';
SET LOCAL session_replication_role = origin;
UPDATE public.guardian_links SET status = 'revoked' WHERE child_user_id = t.id('teenhost');
SELECT t.as_user(t.id('teenhost'));
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('p-ok', %L, 0, false)$q$, t.id('teenhost')), 'row-level security',
  'final #5: once the payee is gone, the minor host cannot turn a paid listing into a free, open one');
SELECT t.reset();
SELECT t.eq(private_sec.game_settings_holder('p-ok'), NULL::uuid, 'final #5: and no settings row of theirs would count for a paid listing');
UPDATE public.hosted_games SET cancelled_at = now() WHERE id = 'p-ok';
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE type = 'payment_refund_owed' AND user_id = t.id('guardian')), 1, 'the refund owed goes to the adult who was paid, even after the link was revoked');
SELECT t.eq((SELECT count(*)::int FROM public.notifications WHERE type = 'payment_refund_owed' AND user_id = t.id('teenhost')), 0, 'never to the minor host');
SELECT t.as_user(t.id('guardian'));
SELECT t.eq(t.count($$SELECT 1 FROM public.payment_submissions WHERE game_id = 'p-ok' AND refund_status = 'owed'$$), 1, 'that adult can still see the refund they owe');
SELECT t.lives(format('SELECT public.mark_refund_sent(%L)', (SELECT id FROM public.payment_submissions WHERE game_id = 'p-ok')), 'and mark it sent');
SELECT t.eq(t.count($$SELECT 1 FROM public.payment_submissions WHERE game_id = 'p-ok'$$), 0, 'after which the former payee sees nothing again');
SELECT t.reset();
UPDATE public.guardian_links SET status = 'active' WHERE child_user_id = t.id('teenhost');

-- 3. a minor host can save settings for a FREE game; a paid one still needs the payee
SELECT t.as_user(t.id('guardian'));
SELECT set_config('t.free', public.grant_minor_hosting_approval(t.id('teenhost'))::text, false);
SELECT t.as_user(t.id('teenhost'));
SELECT t.lives(format($q$INSERT INTO public.hosted_games (id, host_id, sport, title, date, min_age, max_age, hosting_approval_id) VALUES ('free1', %L, 'basketball', 'free youth run', now()+interval '3 days', 13, 17, %L)$q$, t.id('teenhost'), current_setting('t.free')::uuid), 'setup: a free minor-hosted game (guardian-approved, no payment manager)');
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('free1', %L, 0, false)$q$, t.id('teenhost')), 'the minor host saves free-game settings');
SELECT t.throws(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('free1', %L, 10)$q$, t.id('teenhost')), 'MINOR_CANNOT_COLLECT', 'but not a paid setting');
SELECT t.eq(t.count($$SELECT 1 FROM public.game_payment_settings WHERE game_id = 'free1'$$), 1, 'the minor host can read the free settings back');
SELECT t.lives(format($q$INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval) VALUES ('free1', %L, 0, false)
                        ON CONFLICT (game_id, host_id) DO UPDATE SET requires_approval = EXCLUDED.requires_approval$q$, t.id('teenhost')), 'the app''s upsert (save again) works');
SELECT t.throws($q$UPDATE public.game_payment_settings SET entry_fee = 10 WHERE game_id = 'free1'$q$, '', 'raising the fee on the free row is refused');
SELECT t.reset();
SELECT t.eq((SELECT entry_fee FROM public.game_payment_settings WHERE game_id = 'free1')::numeric, 0::numeric, 'and the fee stays 0');
SELECT t.eq(private_sec.game_settings_holder('free1'), t.id('teenhost'), 'the join gate uses the host''s free settings when the game has no payee');
SELECT t.eq(private_sec.game_payee('free1'), NULL::uuid, 'while payment destinations still have no payee');

-- 4b. payment handles need a reason to see them
INSERT INTO public.host_payment_methods (host_id, payment_type, username) VALUES (t.id('adult'), 'venmo', 'adult-handle');
SET LOCAL session_replication_role = replica;
INSERT INTO public.hosted_games (id, host_id, sport, title, date, is_private, location) VALUES ('priv1', t.id('adult'), 'basketball', 'Private run', now()+interval '3 days', true, 'Gym');
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee) VALUES ('priv1', t.id('adult'), 10);
INSERT INTO public.game_participants (game_id, user_id) VALUES ('priv1', t.id('payer'));
SET LOCAL session_replication_role = origin;
SELECT t.as_user(t.id('stranger'));
SELECT t.eq((SELECT count(*)::int FROM public.get_game_host_payment_methods(t.id('adult'), 'priv1')), 0, 'a stranger gets no handles for a private game');
SELECT t.lives(format($q$INSERT INTO public.join_requests (game_id, host_id, player_id, idempotency_key) VALUES ('priv1', %L, %L, 's1')$q$, t.id('adult'), t.id('stranger')), 'setup: the stranger files a join request themselves');
SELECT t.eq((SELECT count(*)::int FROM public.get_game_host_payment_methods(t.id('adult'), 'priv1')), 0, 'a self-made pending request does not count as involvement');
SELECT t.as_user(t.id('payer'));
SELECT t.eq((SELECT count(*)::int FROM public.get_game_host_payment_methods(t.id('adult'), 'priv1')), 1, 'a participant does');
SELECT t.reset();
ROLLBACK;
