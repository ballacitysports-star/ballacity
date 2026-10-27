-- When a seat opens, the player who has waited longest is told once. The game
-- page promises it; before, only an expired unpaid hold ever did.
BEGIN;

SELECT t.person('host', 35), t.person('pone', 25), t.person('ptwo', 26), t.person('pthree', 27),
       t.person('wone', 28), t.person('wtwo', 29), t.person('wthree', 30);

INSERT INTO public.hosted_games (id, host_id, sport, title, date, max_players) VALUES
  ('full',    t.id('host'), 'basketball', 'Full run',    now() + interval '2 days', 3),
  ('closed',  t.id('host'), 'basketball', 'Closed run',  now() + interval '2 days', 1),
  ('started', t.id('host'), 'basketball', 'Underway',    now() - interval '10 minutes', 1),
  ('hold',    t.id('host'), 'basketball', 'Hold sweep',  now() + interval '2 days', 1);
INSERT INTO public.game_payment_settings (game_id, host_id, entry_fee, requires_approval)
SELECT id, t.id('host'), 0, false FROM public.hosted_games;

-- Rosters are full; waiting players queue up in order.
INSERT INTO public.game_participants (game_id, user_id, position) VALUES
  ('full', t.id('pone'), 'Guard'), ('full', t.id('ptwo'), 'Center'), ('full', t.id('pthree'), 'Guard'),
  ('closed', t.id('pone'), NULL), ('started', t.id('pone'), NULL), ('hold', t.id('pone'), NULL);
UPDATE public.hosted_games SET joins_closed = true WHERE id = 'closed';
INSERT INTO public.game_position_waitlist (game_id, position, user_id, created_at) VALUES
  ('full', 'Center', t.id('wone'),   now() - interval '3 hours'),
  ('full', 'Guard',  t.id('wtwo'),   now() - interval '2 hours'),
  ('full', 'Guard',  t.id('wthree'), now() - interval '1 hour'),
  ('closed',  'Guard', t.id('wone'), now() - interval '1 hour'),
  ('started', 'Guard', t.id('wone'), now() - interval '1 hour'),
  ('hold',    'Guard', t.id('wone'), now() - interval '1 hour');

CREATE FUNCTION pg_temp.told(_who text, _game text) RETURNS int LANGUAGE sql AS $$
  SELECT count(*)::int FROM public.notifications
   WHERE user_id = t.id(_who) AND type = 'waitlist_spot_open' AND link = '/games/' || _game
$$;

-- A guard leaves: the longest-waiting Guard is told, not the earlier Center.
SELECT t.as_user(t.id('pone'));
DELETE FROM public.game_participants WHERE game_id = 'full' AND user_id = t.id('pone');
SELECT t.reset();
SELECT t.eq(pg_temp.told('wtwo', 'full'), 1, 'the longest-waiting player for the opened position is told');
SELECT t.eq(pg_temp.told('wone', 'full'), 0, 'a longer wait for another position does not jump the queue');
SELECT t.eq(pg_temp.told('wthree', 'full'), 0, 'and nobody else is told');

-- Another seat opens right after: it goes to a different player.
SELECT t.as_user(t.id('pthree'));
DELETE FROM public.game_participants WHERE game_id = 'full' AND user_id = t.id('pthree');
SELECT t.reset();
SELECT t.eq(pg_temp.told('wtwo', 'full'), 1, 'the first player is not told twice');
SELECT t.eq(pg_temp.told('wthree', 'full') + pg_temp.told('wone', 'full'), 1, 'the next seat goes to the next in line');

-- The host removing someone opens a seat too.
SELECT t.as_user(t.id('host'));
DELETE FROM public.game_participants WHERE game_id = 'full' AND user_id = t.id('ptwo');
SELECT t.reset();
SELECT t.eq(pg_temp.told('wthree', 'full') + pg_temp.told('wone', 'full'), 2, 'a host removal tells the waitlist as well');

-- No seat to offer: joining is closed, the game has started, or the sweep is releasing a hold.
SELECT t.as_user(t.id('pone'));
DELETE FROM public.game_participants WHERE game_id IN ('closed', 'started') AND user_id = t.id('pone');
SELECT t.reset();
SELECT t.eq(pg_temp.told('wone', 'closed'), 0, 'nobody is told about a seat in a game that closed joining');
SELECT t.eq(pg_temp.told('wone', 'started'), 0, 'nor about a seat in a game that has started');

SELECT set_config('ballacity.system_release', 'on', true);
DELETE FROM public.game_participants WHERE game_id = 'hold' AND user_id = t.id('pone');
SELECT set_config('ballacity.system_release', 'off', true);
SELECT t.eq(pg_temp.told('wone', 'hold'), 0, 'a released hold is announced by the sweep, not twice');

ROLLBACK;
