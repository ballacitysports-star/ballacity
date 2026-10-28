-- A 16-17 year old with a guardian cannot send money for a game before the
-- guardian has approved their request (under-16s cannot pay at all); an adult
-- is not held up by this rule.
BEGIN;

SELECT t.person('host', 40), t.person('guardian', 41), t.person('teen', 16), t.person('adult', 28);
SELECT t.guardian('guardian', 'teen');

INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players, price)
VALUES ('paid-open', t.id('host'), 'Paid run', 'Basketball', now() + interval '3 days', 'Gym', 10, 10);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('paid-open', t.id('host'), 10, false);

-- The teen asks to join (the request itself is not gated).
SELECT t.as_user(t.id('teen'));
INSERT INTO public.join_requests (id, game_id, player_id, host_id, idempotency_key)
VALUES (t.id('req'), 'paid-open', t.id('teen'), t.id('host'), 'k1');
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'paid-open', %L)$q$, t.id('teen'), t.id('host')),
  'GUARDIAN_APPROVAL_REQUIRED', 'a minor cannot submit a payment before their guardian approves');
SELECT t.as_user(t.id('guardian'));
SELECT t.lives(format($q$SELECT public.guardian_approve_join_request(%L, true)$q$, t.id('req')), 'the guardian approves the request');
SELECT t.as_user(t.id('teen'));
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'paid-open', %L)$q$, t.id('teen'), t.id('host')),
  'and then the minor can submit it');
SELECT t.reset();

-- A minor with no request at all is held up too.
SELECT t.person('teen2', 17);
SELECT t.guardian('guardian', 'teen2');
SELECT t.as_user(t.id('teen2'));
SELECT t.throws(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'paid-open', %L)$q$, t.id('teen2'), t.id('host')),
  'GUARDIAN_APPROVAL_REQUIRED', 'a minor with no approved request cannot pay at all');

-- An adult has no guardian and is unaffected.
SELECT t.as_user(t.id('adult'));
SELECT t.lives(format($q$INSERT INTO public.payment_submissions (player_id, game_id, host_id) VALUES (%L, 'paid-open', %L)$q$, t.id('adult'), t.id('host')),
  'an adult can submit a payment as before');
SELECT t.reset();

ROLLBACK;
