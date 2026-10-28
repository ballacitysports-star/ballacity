-- A host's block holds in the database: the blocked person cannot ask to join
-- or join the blocker's games, whatever the game page shows. It is the host's
-- block only, and it is one-directional.
BEGIN;

SELECT t.person('host', 40), t.person('blocked', 25), t.person('other', 26), t.person('stranger', 27);

INSERT INTO public.hosted_games (id, host_id, title, sport, date, location, max_players)
VALUES ('open-run', t.id('host'), 'Open run', 'Basketball', now() + interval '3 days', 'Gym', 10),
       ('approval-run', t.id('host'), 'Approval run', 'Basketball', now() + interval '3 days', 'Gym', 10),
       ('other-run', t.id('other'), 'Someone else''s run', 'Basketball', now() + interval '3 days', 'Gym', 10);

-- Open run is instant-join; approval run needs the host's yes.
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
VALUES ('open-run', t.id('host'), 0, false),
       ('approval-run', t.id('host'), 0, true),
       ('other-run', t.id('other'), 0, false);

INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('host'), t.id('blocked'));

-- The blocked player, acting for themselves.
SELECT t.as_user(t.id('blocked'));
SELECT t.throws(
  format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key)
            VALUES ('approval-run', %L, %L, 'k1')$q$, t.id('blocked'), t.id('host')),
  'BLOCKED_BY_HOST',
  'a blocked player cannot ask to join the host''s game');
SELECT t.throws(
  format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key)
            VALUES ('approval-run', %L, %L, 'k2')$q$, t.id('blocked'), t.id('stranger')),
  'BLOCKED_BY_HOST',
  'naming someone else as the host on the request does not get round it');
SELECT t.throws(
  format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('open-run', %L)$q$, t.id('blocked')),
  'BLOCKED_BY_HOST',
  'a blocked player cannot take a spot on a game that needs no approval');
-- Someone else's games are untouched.
SELECT t.lives(
  format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('other-run', %L)$q$, t.id('blocked')),
  'the block is about this host only');

-- Everyone else can still join the host's games.
SELECT t.as_user(t.id('stranger'));
SELECT t.lives(
  format($q$INSERT INTO public.game_participants (game_id, user_id) VALUES ('open-run', %L)$q$, t.id('stranger')),
  'an unblocked player can still join');
SELECT t.lives(
  format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key)
            VALUES ('approval-run', %L, %L, 'k3')$q$, t.id('stranger'), t.id('host')),
  'and ask to join');

SELECT t.reset();

-- One direction only: a player who blocked the host can still ask to join.
INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES (t.id('other'), t.id('host'));
SELECT t.as_user(t.id('other'));
SELECT t.lives(
  format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key)
            VALUES ('approval-run', %L, %L, 'k4')$q$, t.id('other'), t.id('host')),
  'a player who blocked the host can still ask to join their game');
SELECT t.reset();

-- Unblocking lifts it.
DELETE FROM public.user_blocks WHERE blocker_id = t.id('host') AND blocked_id = t.id('blocked');
SELECT t.as_user(t.id('blocked'));
SELECT t.lives(
  format($q$INSERT INTO public.join_requests (game_id, player_id, host_id, idempotency_key)
            VALUES ('approval-run', %L, %L, 'k5')$q$, t.id('blocked'), t.id('host')),
  'once unblocked they can ask again');
SELECT t.reset();

ROLLBACK;
