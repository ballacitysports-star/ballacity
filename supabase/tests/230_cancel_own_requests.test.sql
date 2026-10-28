-- A player can take back their own pending join request and their own pending
-- payment proof on a paid game, and no one else's.
BEGIN;

SELECT t.person('host', 40), t.person('player', 25), t.person('other', 26);
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('paid-game', t.id('host'), 'Paid run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('paid-game', t.id('host'), 10, true);

SELECT t.as_user(t.id('player'));
INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
VALUES (t.id('req'), 'paid-game', t.id('player'), t.id('host'), 'k1');
SELECT t.reset();
-- A paid game with no approval step: the player's payment proof is the pending thing.
INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('open-paid', t.id('host'), 'Open paid run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('open-paid', t.id('host'), 10, false);
SELECT t.as_user(t.id('player'));
INSERT INTO public.payment_submissions (id, player_id, game_id, host_id, status)
VALUES (t.id('sub'), t.id('player'), 'open-paid', t.id('host'), 'pending');
SELECT t.reset();

SELECT t.as_user(t.id('other'));
SELECT t.eq(t.changed(format($q$DELETE FROM public.join_requests WHERE id = %L$q$, t.id('req'))), 0, 'another player cannot cancel someone else''s request');
SELECT t.eq(t.changed(format($q$DELETE FROM public.payment_submissions WHERE id = %L$q$, t.id('sub'))), 0, 'or their payment proof');

SELECT t.as_user(t.id('player'));
SELECT t.eq(t.changed(format($q$DELETE FROM public.payment_submissions WHERE id = %L AND status = 'pending'$q$, t.id('sub'))), 1, 'the player can withdraw their own pending payment proof');
SELECT t.eq(t.changed(format($q$DELETE FROM public.join_requests WHERE id = %L AND status = 'pending'$q$, t.id('req'))), 1, 'and cancel their own pending request on a paid game');
SELECT t.reset();

ROLLBACK;
